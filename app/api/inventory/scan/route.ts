import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function POST(request: NextRequest) {
  try {
    // 1. Safely retrieve Cloudflare context bindings (DB and MOONHOYA_PHOTOS)
    const cf = await getCloudflareContext();
    const env = cf.env as { DB: any; MOONHOYA_PHOTOS: any };

    if (!env || !env.DB) {
      return NextResponse.json({ 
        error: 'Cloudflare D1 database binding (DB) is not available in this context.' 
      }, { status: 500 });
    }

    const formData = await request.formData();
    const file = formData.get('photo') as File;
    const potSize = parseInt(formData.get('potSize') as string) || 4;
    const zone = (formData.get('greenhouseZone') as string) || 'Zone A';
    const qtyToAdd = parseInt(formData.get('quantity') as string) || 1;

    if (!file) {
      return NextResponse.json({ error: 'No plant image provided' }, { status: 400 });
    }

    // 2. Upload photo to local simulated R2 bucket (if available)
    const filename = `moonhoya-${Date.now()}-${file.name}`;
    if (env.MOONHOYA_PHOTOS) {
      await env.MOONHOYA_PHOTOS.put(filename, file.stream(), {
        httpMetadata: { contentType: file.type }
      });
    }
    const photoUrl = `https://pub-r2.moonhoya.com/${filename}`;

    // 3. Simulated AI identification result
    const identifiedSpecies = {
      botanicalName: 'Hoya carnosa',
      commonName: 'Wax Plant / Hinayana',
      sunReq: 'INDIRECT_LIGHT',
      waterFrequency: 14,
      petSafe: 1,
      description: 'Popular trailing houseplant with thick waxy leaves and star-shaped flowers.'
    };

    // 4. Check if species exists in D1
    const existingSpecies: any = await env.DB.prepare(
      `SELECT id FROM PlantSpecies WHERE botanicalName = ?`
    ).bind(identifiedSpecies.botanicalName).first();

    let speciesId = existingSpecies?.id;
    let isNewSpecies = false;

    if (!speciesId) {
      speciesId = `species-${Date.now()}`;
      isNewSpecies = true;
      await env.DB.prepare(
        `INSERT INTO PlantSpecies (id, commonName, botanicalName, description, sunReq, waterFrequency, petSafe, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        speciesId,
        identifiedSpecies.commonName,
        identifiedSpecies.botanicalName,
        identifiedSpecies.description,
        identifiedSpecies.sunReq,
        identifiedSpecies.waterFrequency,
        identifiedSpecies.petSafe,
        photoUrl
      ).run();
    }

    // 5. Update or create inventory batch
    const existingBatch: any = await env.DB.prepare(
      `SELECT id, quantity FROM InventoryBatch WHERE speciesId = ? AND potSizeInches = ? AND greenhouseZone = ?`
    ).bind(speciesId, potSize, zone).first();

    let batchResult;
    if (existingBatch) {
      const newQty = existingBatch.quantity + qtyToAdd;
      await env.DB.prepare(
        `UPDATE InventoryBatch SET quantity = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(newQty, existingBatch.id).run();
      batchResult = { id: existingBatch.id, quantity: newQty, updated: true };
    } else {
      const batchId = `batch-${Date.now()}`;
      const sku = `MH-${identifiedSpecies.botanicalName.substring(0, 3).toUpperCase()}-${potSize}IN`;
      await env.DB.prepare(
        `INSERT INTO InventoryBatch (id, sku, speciesId, potSizeInches, quantity, priceCents, greenhouseZone) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(batchId, sku, speciesId, potSize, qtyToAdd, 1800, zone).run();
      batchResult = { id: batchId, sku, quantity: qtyToAdd, updated: false };
    }

    return NextResponse.json({
      success: true,
      app: 'Moonhoya',
      isNewSpecies,
      species: identifiedSpecies.commonName,
      batch: batchResult,
      message: isNewSpecies 
        ? `New Hoya species registered! Added ${qtyToAdd} units.` 
        : `Existing batch updated. Increased stock by ${qtyToAdd} units.`
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}