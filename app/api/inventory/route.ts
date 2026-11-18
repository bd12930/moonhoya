import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function GET(_request: NextRequest) {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json({ error: 'D1 Database binding not found' }, { status: 500 });
    }

    const { results } = await env.DB.prepare(`
      SELECT
        B.id, B.sku, B.potSizeInches, B.quantity, B.greenhouseZone, B.priceCents, B.updatedAt,
        S.commonName, S.botanicalName, S.sunReq, S.imageUrl
      FROM InventoryBatch B
      JOIN PlantSpecies S ON B.speciesId = S.id
      ORDER BY B.updatedAt DESC
    `).all();

    return NextResponse.json({ success: true, items: results ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
