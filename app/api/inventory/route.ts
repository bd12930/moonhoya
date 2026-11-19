import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { SESSION_COOKIE } from '@/lib/auth';
import { requireAdmin } from '@/lib/access';

export const dynamic = 'force-dynamic';

export interface BatchItem {
  id: string;
  sku: string;
  speciesId: string;
  potSizeInches: number;
  quantity: number;
  greenhouseZone: string;
  priceCents: number;
  growthStage: string;
  updatedAt: string;
  category: string;
  commonName: string;
  botanicalName: string;
  sunReq: string;
  imageUrl?: string | null;
  /** Full gallery of the master kind (PlantSpeciesPhoto), oldest first. Added by GET. */
  photos?: string[];
  photoCount?: number;
}

/**
 * GET /api/inventory
 * Retrieves inventory batches with master item metadata.
 */
export async function GET(request: NextRequest) {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json({ error: 'D1 Database binding not found' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    let query = `
      SELECT
        B.id,
        B.sku,
        B.speciesId,
        B.potSizeInches,
        B.quantity,
        B.greenhouseZone,
        B.priceCents,
        B.growthStage,
        B.updatedAt,
        COALESCE(S.category, 'PLANT') AS category,
        S.commonName,
        S.botanicalName,
        S.sunReq,
        S.imageUrl
      FROM InventoryBatch B
      JOIN PlantSpecies S ON B.speciesId = S.id
    `;

    const bindings: any[] = [];
    if (category && category !== 'ALL') {
      query += ` WHERE COALESCE(S.category, 'PLANT') = ?`;
      bindings.push(category);
    }

    query += ` ORDER BY B.updatedAt DESC`;

    const stmt = bindings.length > 0
      ? env.DB.prepare(query).bind(...bindings)
      : env.DB.prepare(query);

    const { results } = await stmt.all<BatchItem>();
    const items: BatchItem[] = results ?? [];

    // Attach each kind's full photo gallery (oldest first) for the item detail view
    const { results: photoRows } = await env.DB.prepare(
      `SELECT speciesId, imageUrl FROM PlantSpeciesPhoto ORDER BY createdAt ASC, id ASC`
    ).all<{ speciesId: string; imageUrl: string }>();

    const photosBySpecies = new Map<string, string[]>();
    for (const row of photoRows ?? []) {
      const list = photosBySpecies.get(row.speciesId) ?? [];
      list.push(row.imageUrl);
      photosBySpecies.set(row.speciesId, list);
    }

    const withPhotos = items.map((item) => {
      const photos = photosBySpecies.get(item.speciesId) ?? [];
      return { ...item, photos, photoCount: photos.length };
    });

    return NextResponse.json({ success: true, items: withPhotos });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * PUT /api/inventory
 * Updates an inventory batch's quantity, zone, pot size, price, or growth stage.
 */
export async function PUT(request: NextRequest) {
  try {
    const denied = await requireAdmin(request.cookies.get(SESSION_COOKIE)?.value);
    if ('response' in denied) return denied.response;

    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json({ error: 'D1 Database binding not found' }, { status: 500 });
    }

    const body = await request.json();
    const { id, quantity, greenhouseZone, potSizeInches, priceCents, growthStage, sunReq } = body;

    if (!id) {
      return NextResponse.json({ error: 'Batch id is required' }, { status: 400 });
    }

    // Verify batch exists
    const existing = await env.DB.prepare(
      `SELECT id, speciesId, quantity, greenhouseZone, potSizeInches, priceCents, growthStage FROM InventoryBatch WHERE id = ?`
    ).bind(id).first<any>();

    if (!existing) {
      return NextResponse.json({ error: `Batch with ID "${id}" not found` }, { status: 404 });
    }

    const updatedQty = typeof quantity === 'number' ? quantity : existing.quantity;
    const updatedZone = greenhouseZone !== undefined ? greenhouseZone : existing.greenhouseZone;
    const updatedPotSize = typeof potSizeInches === 'number' ? potSizeInches : existing.potSizeInches;
    const updatedPrice = typeof priceCents === 'number' ? priceCents : existing.priceCents;
    const updatedStage = growthStage !== undefined ? growthStage : existing.growthStage;

    await env.DB.prepare(`
      UPDATE InventoryBatch
      SET
        quantity = ?,
        greenhouseZone = ?,
        potSizeInches = ?,
        priceCents = ?,
        growthStage = ?,
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(updatedQty, updatedZone, updatedPotSize, updatedPrice, updatedStage, id).run();

    // If sunReq is provided, update the species record as well
    if (sunReq && existing.speciesId) {
      await env.DB.prepare(`
        UPDATE PlantSpecies SET sunReq = ? WHERE id = ?
      `).bind(sunReq, existing.speciesId).run();
    }

    return NextResponse.json({
      success: true,
      message: `Updated batch ${id}. Quantity: ${updatedQty}.${sunReq ? ` Light updated to ${sunReq}.` : ''}`,
      item: { id, quantity: updatedQty, greenhouseZone: updatedZone, potSizeInches: updatedPotSize, priceCents: updatedPrice, growthStage: updatedStage, sunReq },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/inventory?id=...
 * Deletes an inventory batch.
 */
export async function DELETE(request: NextRequest) {
  try {
    const denied = await requireAdmin(request.cookies.get(SESSION_COOKIE)?.value);
    if ('response' in denied) return denied.response;

    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json({ error: 'D1 Database binding not found' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Batch id is required for deletion' }, { status: 400 });
    }

    // Also clean up any dependent care tasks if present
    await env.DB.prepare(`DELETE FROM CareTask WHERE batchId = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM InventoryBatch WHERE id = ?`).bind(id).run();

    return NextResponse.json({
      success: true,
      message: `Batch "${id}" deleted from inventory.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
