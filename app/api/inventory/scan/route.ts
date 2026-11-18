import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

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

    // 1. Read input fields
    const category = (formData.get('category') as string) || 'PLANT';
    const potSize = parseInt((formData.get('potSize') as string) ?? '4') || 0;
    const zone = (formData.get('greenhouseZone') as string) || 'Zone A';
    const qtyToAdd = parseInt((formData.get('quantity') as string) ?? '1') || 1;
    const priceCents = parseInt((formData.get('priceCents') as string) ?? '1800') || 1800;

    // Photo & saving options
    const file = formData.get('photo') as File | null;
    const savePhoto = formData.get('savePhoto') === 'true';
    const existingImageUrl = (formData.get('existingImageUrl') as string) || null;

    // Master species metadata
    let speciesId = (formData.get('speciesId') as string) || null;
    const botanicalName = ((formData.get('botanicalName') as string) || 'Hoya carnosa').trim();
    const commonName = ((formData.get('commonName') as string) || 'Wax Plant').trim();
    const sunReq = (formData.get('sunReq') as string) || 'INDIRECT_LIGHT';
    const waterFrequency = parseInt((formData.get('waterFrequency') as string) ?? '14') || 14;
    const petSafe = (formData.get('petSafe') as string) === '1' ? 1 : 0;
    const description = (formData.get('description') as string) || '';

    // 2. Photo storage optimization
    // Only upload to R2 if the user explicitly opted to save the new photo
    let photoUrl: string | null = existingImageUrl;

    if (savePhoto && file && file.size > 0 && env.MOONHOYA_PHOTOS) {
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${category.toLowerCase()}-${Date.now()}-${sanitizedName}`;

      await env.MOONHOYA_PHOTOS.put(filename, file.stream(), {
        httpMetadata: { contentType: file.type || 'image/webp' },
      });

      photoUrl = `https://pub-r2.moonhoya.com/${filename}`;
    }

    // 3. Resolve or create Master Catalog entry (PlantSpecies table)
    let isNewMasterItem = false;

    if (speciesId) {
      // Existing species selected: update imageUrl if a new photo was uploaded
      if (savePhoto && photoUrl && photoUrl !== existingImageUrl) {
        await env.DB.prepare(
          `UPDATE PlantSpecies SET imageUrl = ? WHERE id = ?`
        ).bind(photoUrl, speciesId).run();
      }
    } else {
      // Check if species with this botanicalName / identifier already exists
      const existingRecord = await env.DB.prepare(
        `SELECT id, imageUrl FROM PlantSpecies WHERE botanicalName = ?`
      ).bind(botanicalName).first<{ id: string; imageUrl?: string }>();

      if (existingRecord) {
        speciesId = existingRecord.id;
        if (!photoUrl && existingRecord.imageUrl) {
          photoUrl = existingRecord.imageUrl;
        } else if (savePhoto && photoUrl && photoUrl !== existingRecord.imageUrl) {
          await env.DB.prepare(`UPDATE PlantSpecies SET imageUrl = ? WHERE id = ?`).bind(photoUrl, speciesId).run();
        }
      } else {
        // Register brand new kind in Master Database
        speciesId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        isNewMasterItem = true;

        await env.DB.prepare(`
          INSERT INTO PlantSpecies (id, category, commonName, botanicalName, description, sunReq, waterFrequency, petSafe, imageUrl)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          speciesId,
          category,
          commonName,
          botanicalName,
          description,
          sunReq,
          waterFrequency,
          petSafe,
          photoUrl
        ).run();
      }
    }

    // 4. Build collision-resistant SKU for inventory batch
    const catPrefix = category === 'PLANT' ? 'MH' : category.substring(0, 3).toUpperCase();
    const cleanCode = botanicalName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase();
    const potLabel = potSize > 0 ? `-${potSize}IN` : '';
    const sku = `${catPrefix}-${cleanCode}${potLabel}-${zone.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase()}`;

    // 5. Update or create Inventory Batch
    const existingBatch = await env.DB.prepare(`
      SELECT id, quantity FROM InventoryBatch
      WHERE speciesId = ? AND potSizeInches = ? AND greenhouseZone = ?
    `).bind(speciesId, potSize, zone).first<{ id: string; quantity: number }>();

    let batchResult: { id: string; sku: string; quantity: number; updated: boolean };

    if (existingBatch) {
      const newQty = existingBatch.quantity + qtyToAdd;
      await env.DB.prepare(`
        UPDATE InventoryBatch
        SET quantity = ?, priceCents = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(newQty, priceCents, existingBatch.id).run();

      batchResult = { id: existingBatch.id, sku, quantity: newQty, updated: true };
    } else {
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await env.DB.prepare(`
        INSERT INTO InventoryBatch (id, sku, speciesId, potSizeInches, quantity, priceCents, greenhouseZone)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(batchId, sku, speciesId, potSize, qtyToAdd, priceCents, zone).run();

      batchResult = { id: batchId, sku, quantity: qtyToAdd, updated: false };
    }

    return NextResponse.json({
      success: true,
      app: 'Moonhoya',
      category,
      isNewMasterItem,
      commonName,
      botanicalName,
      photoUrl,
      batch: batchResult,
      message: isNewMasterItem
        ? `🌟 Registered new ${category.toLowerCase()}: "${commonName}" & created stock batch (+${qtyToAdd} units)!`
        : `✅ Updated inventory for "${commonName}" (+${qtyToAdd} units in ${zone}).`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
