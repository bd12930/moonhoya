import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function POST(request: NextRequest) {
  try {
    const { env } = await getCloudflareContext({ async: true });

    if (!env.DB) {
      return NextResponse.json(
        { error: 'Cloudflare D1 database binding (DB) is not available in this context.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('photo') as File | null;
    const potSize = parseInt((formData.get('potSize') as string) ?? '4') || 4;
    const zone = (formData.get('greenhouseZone') as string) || 'Zone A';
    const qtyToAdd = parseInt((formData.get('quantity') as string) ?? '1') || 1;
    // Accept a price in cents from the caller; fall back to $18.00
    const priceCents = parseInt((formData.get('priceCents') as string) ?? '1800') || 1800;

    if (!file) {
      return NextResponse.json({ error: 'No plant image provided' }, { status: 400 });
    }

    // 1. Upload photo to R2 (if binding is available), otherwise leave imageUrl null
    let photoUrl: string | null = null;
    if (env.MOONHOYA_PHOTOS) {
      const filename = `moonhoya-${Date.now()}-${file.name}`;
      await env.MOONHOYA_PHOTOS.put(filename, file.stream(), {
        httpMetadata: { contentType: file.type },
      });
      photoUrl = `https://pub-r2.moonhoya.com/${filename}`;
    }

    // 2. TODO: Replace this stub with a real plant identification API call
    //    e.g. Plant.id, iNaturalist, or a Cloudflare AI Workers vision model.
    //    For now the endpoint accepts explicit overrides via formData so callers
    //    can supply correct data while the AI integration is built out.
    const botanicalName = (formData.get('botanicalName') as string) || 'Hoya carnosa';
    const commonName    = (formData.get('commonName')    as string) || 'Wax Plant';
    const sunReq        = (formData.get('sunReq')        as string) || 'INDIRECT_LIGHT';
    const waterFrequency = parseInt((formData.get('waterFrequency') as string) ?? '14') || 14;
    const petSafe = (formData.get('petSafe') as string) === '1' ? 1 : 0;
    const description = (formData.get('description') as string) || '';

    const identifiedSpecies = { botanicalName, commonName, sunReq, waterFrequency, petSafe, description };

    // 3. Upsert species — use INSERT OR IGNORE to avoid a race condition when
    //    two simultaneous scans discover the same new species at the same time.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO PlantSpecies
         (id, commonName, botanicalName, description, sunReq, waterFrequency, petSafe, imageUrl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `species-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      identifiedSpecies.commonName,
      identifiedSpecies.botanicalName,
      identifiedSpecies.description,
      identifiedSpecies.sunReq,
      identifiedSpecies.waterFrequency,
      identifiedSpecies.petSafe,
      photoUrl,
    ).run();

    // Re-fetch the canonical row (may have been inserted by a concurrent request)
    const speciesRow = await env.DB.prepare(
      `SELECT id FROM PlantSpecies WHERE botanicalName = ?`
    ).bind(identifiedSpecies.botanicalName).first<{ id: string }>();

    if (!speciesRow) {
      return NextResponse.json({ error: 'Failed to resolve species record.' }, { status: 500 });
    }

    const speciesId = speciesRow.id;

    // 4. Build a collision-safe SKU: MH-<genus 3>-<species 3>-<potSize>IN
    //    e.g. "Hoya carnosa" → MH-HOY-CAR-4IN
    const [genus = '', species = ''] = identifiedSpecies.botanicalName.split(' ');
    const skuBase = `MH-${genus.substring(0, 3).toUpperCase()}-${species.substring(0, 3).toUpperCase()}-${potSize}IN`;

    // 5. Update or create inventory batch
    const existingBatch = await env.DB.prepare(
      `SELECT id, quantity FROM InventoryBatch
       WHERE speciesId = ? AND potSizeInches = ? AND greenhouseZone = ?`
    ).bind(speciesId, potSize, zone).first<{ id: string; quantity: number }>();

    let batchResult: { id: string; sku?: string; quantity: number; updated: boolean };
    let isNewBatch: boolean;

    if (existingBatch) {
      const newQty = existingBatch.quantity + qtyToAdd;
      await env.DB.prepare(
        `UPDATE InventoryBatch SET quantity = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(newQty, existingBatch.id).run();
      batchResult = { id: existingBatch.id, quantity: newQty, updated: true };
      isNewBatch = false;
    } else {
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await env.DB.prepare(
        `INSERT INTO InventoryBatch (id, sku, speciesId, potSizeInches, quantity, priceCents, greenhouseZone)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(batchId, skuBase, speciesId, potSize, qtyToAdd, priceCents, zone).run();
      batchResult = { id: batchId, sku: skuBase, quantity: qtyToAdd, updated: false };
      isNewBatch = true;
    }

    return NextResponse.json({
      success: true,
      app: 'Moonhoya',
      isNewBatch,
      species: identifiedSpecies.commonName,
      batch: batchResult,
      message: isNewBatch
        ? `New batch created! Added ${qtyToAdd} units of ${identifiedSpecies.commonName}.`
        : `Existing batch updated. Increased stock by ${qtyToAdd} units.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
