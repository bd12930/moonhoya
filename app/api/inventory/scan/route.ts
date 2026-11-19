import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { MAX_PHOTOS_PER_SPECIES } from '../../../../lib/species-photos';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let uploadedKey: string | null = null;

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

    // Master species metadata
    let speciesId = (formData.get('speciesId') as string) || null;
    const botanicalName = ((formData.get('botanicalName') as string) || 'Hoya carnosa').trim();
    const commonName = ((formData.get('commonName') as string) || 'Wax Plant').trim();
    const sunReq = (formData.get('sunReq') as string) || 'INDIRECT_LIGHT';
    const waterFrequency = parseInt((formData.get('waterFrequency') as string) ?? '14') || 14;
    const petSafe = (formData.get('petSafe') as string) === '1' ? 1 : 0;
    const description = (formData.get('description') as string) || '';

    // 2. Resolve the master catalog entry (PlantSpecies) before touching R2,
    //    so the photo cap can be checked up front.
    let isNewMasterItem = false;
    let coverImageUrl: string | null = null;

    if (speciesId) {
      const row = await env.DB.prepare(
        `SELECT id, imageUrl FROM PlantSpecies WHERE id = ?`
      ).bind(speciesId).first<{ id: string; imageUrl: string | null }>();

      if (!row) {
        return NextResponse.json({ error: 'Master catalog entry not found.' }, { status: 404 });
      }
      coverImageUrl = row.imageUrl;
    } else {
      const existingRecord = await env.DB.prepare(
        `SELECT id, imageUrl FROM PlantSpecies WHERE botanicalName = ?`
      ).bind(botanicalName).first<{ id: string; imageUrl: string | null }>();

      if (existingRecord) {
        speciesId = existingRecord.id;
        coverImageUrl = existingRecord.imageUrl;
      } else {
        speciesId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        isNewMasterItem = true;
      }
    }

    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM PlantSpeciesPhoto WHERE speciesId = ?`
    ).bind(speciesId).first<{ count: number }>();
    let photoCount = countRow?.count ?? 0;

    // 3. Photo storage: only when the user opted in and a file was sent
    const wantsNewPhoto = savePhoto && !!file && file.size > 0;

    if (wantsNewPhoto && photoCount >= MAX_PHOTOS_PER_SPECIES) {
      return NextResponse.json(
        {
          error: `This kind already has ${MAX_PHOTOS_PER_SPECIES} photos. Remove one before adding another.`,
          photoCount,
          maxPhotos: MAX_PHOTOS_PER_SPECIES,
        },
        { status: 409 }
      );
    }

    let newPhotoUrl: string | null = null;

    if (wantsNewPhoto && file && env.MOONHOYA_PHOTOS) {
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      uploadedKey = `${category.toLowerCase()}-${Date.now()}-${sanitizedName}`;

      await env.MOONHOYA_PHOTOS.put(uploadedKey, file.stream(), {
        httpMetadata: { contentType: file.type || 'image/webp' },
      });

      // Served by /api/photos/[key] (reads the R2 binding), so no public R2 domain is needed
      newPhotoUrl = `/api/photos/${uploadedKey}`;
    }

    // 4. Create the master entry if this is a new kind
    if (isNewMasterItem) {
      await env.DB.prepare(`
        INSERT INTO PlantSpecies (id, category, commonName, botanicalName, description, sunReq, waterFrequency, petSafe, imageUrl)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).bind(
        speciesId,
        category,
        commonName,
        botanicalName,
        description,
        sunReq,
        waterFrequency,
        petSafe
      ).run();
    }

    // 5. Append the new photo. The cap is enforced inside the INSERT itself,
    //    so two concurrent scans cannot both take the last slot.
    if (newPhotoUrl) {
      const photoId = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const insert = await env.DB.prepare(`
        INSERT INTO PlantSpeciesPhoto (id, speciesId, imageUrl)
        SELECT ?, ?, ?
        WHERE (SELECT COUNT(*) FROM PlantSpeciesPhoto WHERE speciesId = ?) < ?
      `).bind(photoId, speciesId, newPhotoUrl, speciesId, MAX_PHOTOS_PER_SPECIES).run();

      if (!insert.meta.changes) {
        // Lost a race for the last slot: remove the orphaned upload.
        await env.MOONHOYA_PHOTOS?.delete(uploadedKey!);
        uploadedKey = null;
        return NextResponse.json(
          {
            error: `This kind already has ${MAX_PHOTOS_PER_SPECIES} photos. Remove one before adding another.`,
            maxPhotos: MAX_PHOTOS_PER_SPECIES,
          },
          { status: 409 }
        );
      }

      photoCount += 1;
      uploadedKey = null; // now referenced by the DB, keep it

      // First photo becomes the cover if none is set yet
      if (!coverImageUrl) {
        await env.DB.prepare(
          `UPDATE PlantSpecies SET imageUrl = ? WHERE id = ? AND (imageUrl IS NULL OR imageUrl = '')`
        ).bind(newPhotoUrl, speciesId).run();
        coverImageUrl = newPhotoUrl;
      }
    }

    // 6. Build collision-resistant SKU for inventory batch
    const catPrefix = category === 'PLANT' ? 'MH' : category.substring(0, 3).toUpperCase();
    const cleanCode = botanicalName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase();
    const potLabel = potSize > 0 ? `-${potSize}IN` : '';
    const sku = `${catPrefix}-${cleanCode}${potLabel}-${zone.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase()}`;

    // 7. Update or create Inventory Batch
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
      speciesId,
      isNewMasterItem,
      commonName,
      botanicalName,
      photoUrl: coverImageUrl,
      photoCount,
      maxPhotos: MAX_PHOTOS_PER_SPECIES,
      addedPhotoUrl: newPhotoUrl,
      batch: batchResult,
      message: isNewMasterItem
        ? `🌟 Registered new ${category.toLowerCase()}: "${commonName}" & created stock batch (+${qtyToAdd} units)!`
        : `✅ Updated inventory for "${commonName}" (+${qtyToAdd} units in ${zone}).`,
    });
  } catch (err: unknown) {
    // Don't leave an unreferenced R2 object behind if the request failed after upload
    if (uploadedKey) {
      try {
        const { env } = await getCloudflareContext({ async: true });
        await env.MOONHOYA_PHOTOS?.delete(uploadedKey);
      } catch {
        // best-effort cleanup
      }
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
