import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

/**
 * GET /api/species
 * Returns master catalog entries (Plants, Fertilizers, Pots, Equipment, Hardware).
 */
export async function GET(request: NextRequest) {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json({ error: 'Cloudflare D1 database binding not found' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    let query = `
      SELECT
        id,
        COALESCE(category, 'PLANT') AS category,
        commonName,
        botanicalName,
        description,
        sunReq,
        waterFrequency,
        petSafe,
        imageUrl,
        createdAt
      FROM PlantSpecies
    `;

    const bindings: any[] = [];
    if (category) {
      query += ` WHERE category = ?`;
      bindings.push(category);
    }

    query += ` ORDER BY commonName ASC`;

    const stmt = bindings.length > 0
      ? env.DB.prepare(query).bind(...bindings)
      : env.DB.prepare(query);

    const { results } = await stmt.all();

    return NextResponse.json({ success: true, species: results ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/species
 * Adds a new entry to the Master Catalog.
 */
export async function POST(request: NextRequest) {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json({ error: 'D1 binding not found' }, { status: 500 });
    }

    const body = await request.json();
    const {
      commonName,
      botanicalName,
      category = 'PLANT',
      description = '',
      sunReq = 'INDIRECT_LIGHT',
      waterFrequency = 14,
      petSafe = 1,
      imageUrl = null,
    } = body;

    if (!commonName || !botanicalName) {
      return NextResponse.json({ error: 'Common name and botanical name/code are required' }, { status: 400 });
    }

    const id = `species-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await env.DB.prepare(`
      INSERT INTO PlantSpecies (id, category, commonName, botanicalName, description, sunReq, waterFrequency, petSafe, imageUrl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      category,
      commonName.trim(),
      botanicalName.trim(),
      description,
      sunReq,
      waterFrequency,
      petSafe ? 1 : 0,
      imageUrl
    ).run();

    return NextResponse.json({
      success: true,
      species: { id, category, commonName, botanicalName, description, sunReq, waterFrequency, petSafe, imageUrl },
      message: `Added "${commonName}" to master catalog.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/species
 * Updates an entry in the Master Catalog, including light requirements (sunReq).
 */
export async function PUT(request: NextRequest) {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json({ error: 'D1 binding not found' }, { status: 500 });
    }

    const body = await request.json();
    const { id, sunReq, commonName, description, waterFrequency, petSafe, imageUrl, category } = body;

    if (!id) {
      return NextResponse.json({ error: 'Species id is required' }, { status: 400 });
    }

    const existing = await env.DB.prepare(`SELECT * FROM PlantSpecies WHERE id = ?`).bind(id).first<any>();
    if (!existing) {
      return NextResponse.json({ error: `Species with ID "${id}" not found` }, { status: 404 });
    }

    const updatedSunReq = sunReq !== undefined ? sunReq : existing.sunReq;
    const updatedCommon = commonName !== undefined ? commonName.trim() : existing.commonName;
    const updatedDesc = description !== undefined ? description : existing.description;
    const updatedWater = waterFrequency !== undefined ? waterFrequency : existing.waterFrequency;
    const updatedPetSafe = petSafe !== undefined ? (petSafe ? 1 : 0) : existing.petSafe;
    const updatedImg = imageUrl !== undefined ? imageUrl : existing.imageUrl;
    const updatedCat = category !== undefined ? category : existing.category;

    await env.DB.prepare(`
      UPDATE PlantSpecies
      SET
        sunReq = ?,
        commonName = ?,
        description = ?,
        waterFrequency = ?,
        petSafe = ?,
        imageUrl = ?,
        category = ?
      WHERE id = ?
    `).bind(
      updatedSunReq,
      updatedCommon,
      updatedDesc,
      updatedWater,
      updatedPetSafe,
      updatedImg,
      updatedCat,
      id
    ).run();

    return NextResponse.json({
      success: true,
      message: `Updated "${updatedCommon}" (Light: ${updatedSunReq}).`,
      species: {
        id,
        sunReq: updatedSunReq,
        commonName: updatedCommon,
        description: updatedDesc,
        waterFrequency: updatedWater,
        petSafe: updatedPetSafe,
        imageUrl: updatedImg,
        category: updatedCat,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/species?id=...
 * Removes an entry from the master catalog if no batches depend on it.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json({ error: 'D1 binding not found' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Species id is required' }, { status: 400 });
    }

    // Check if batches are associated
    const batchCount = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM InventoryBatch WHERE speciesId = ?`
    ).bind(id).first<{ count: number }>();

    if (batchCount && batchCount.count > 0) {
      return NextResponse.json({
        error: `Cannot delete: ${batchCount.count} inventory batch(es) are linked to this item. Delete or reassign those batches first.`,
      }, { status: 400 });
    }

    await env.DB.prepare(`DELETE FROM PlantSpecies WHERE id = ?`).bind(id).run();

    return NextResponse.json({ success: true, message: 'Master catalog item deleted successfully.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
