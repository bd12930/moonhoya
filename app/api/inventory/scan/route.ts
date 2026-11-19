import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { MAX_PHOTOS_PER_SPECIES } from '../../../../lib/species-photos';

export const dynamic = 'force-dynamic';

interface ScanDetectionInput {
  botanicalName: string;
  commonName: string;
  confidence: number | null;
}

/** Validates the JSON `detections` field sent by the scanner (AI candidates, max 5). */
function parseDetections(raw: FormDataEntryValue | null): ScanDetectionInput[] {
  if (typeof raw !== 'string' || !raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: ScanDetectionInput[] = [];
  for (const item of parsed.slice(0, 5)) {
    if (!item || typeof item !== 'object') continue;
    const { botanicalName, commonName, confidence } = item as Record<string, unknown>;
    if (typeof botanicalName !== 'string' || !botanicalName.trim()) continue;
    if (typeof commonName !== 'string' || !commonName.trim()) continue;
    out.push({
      botanicalName: botanicalName.trim(),
      commonName: commonName.trim(),
      confidence: typeof confidence === 'number' && Number.isFinite(confidence)
        ? Math.min(100, Math.max(0, confidence))
        : null,
    });
  }
  return out;
}

/** Parses the gallery slot (1..MAX_PHOTOS_PER_SPECIES) the user picked. Returns null if not a valid slot. */
function parseSlot(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PHOTOS_PER_SPECIES) return null;
  return n;
}

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
    const rawSlot = formData.get('slot');
    const requestedSlot = parseSlot(rawSlot);

    if (rawSlot && requestedSlot === null) {
      return NextResponse.json(
        { error: `Slot must be a number from 1 to ${MAX_PHOTOS_PER_SPECIES}.` },
        { status: 400 }
      );
    }

    // Master species metadata
    let speciesId = (formData.get('speciesId') as string) || null;
    const botanicalName = ((formData.get('botanicalName') as string) || 'Hoya carnosa').trim();
    const commonName = ((formData.get('commonName') as string) || 'Wax Plant').trim();
    const sunReq = (formData.get('sunReq') as string) || 'INDIRECT_LIGHT';
    const waterFrequency = parseInt((formData.get('waterFrequency') as string) ?? '14') || 14;
    const petSafe = (formData.get('petSafe') as string) === '1' ? 1 : 0;
    const description = (formData.get('description') as string) || '';

    // 2. Resolve the master catalog entry (PlantSpecies) before touching R2,
    //    so the photo slot can be checked up front.
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

    const { results: slotRows } = await env.DB.prepare(
      `SELECT id, slot, imageUrl FROM PlantSpeciesPhoto WHERE speciesId = ?`
    ).bind(speciesId).all<{ id: string; slot: number | null; imageUrl: string }>();
    const photos: { id: string; slot: number | null; imageUrl: string }[] = slotRows ?? [];
    let photoCount = photos.length;

    // 3. Photo storage: only when the user opted in and a file was sent.
    //    The target is the slot the user picked (an occupied slot is replaced),
    //    or the first free slot when no slot was sent.
    const wantsNewPhoto = savePhoto && !!file && file.size > 0;

    let targetSlot: number | null = null;
    let replacedPhoto: { id: string; imageUrl: string } | null = null;

    if (wantsNewPhoto) {
      if (requestedSlot !== null) {
        targetSlot = requestedSlot;
      } else {
        const used = new Set(photos.map((p) => p.slot));
        for (let s = 1; s <= MAX_PHOTOS_PER_SPECIES; s++) {
          if (!used.has(s)) {
            targetSlot = s;
            break;
          }
        }
      }

      if (targetSlot === null) {
        return NextResponse.json(
          {
            error: `This kind already has ${MAX_PHOTOS_PER_SPECIES} photos. Pick a slot to replace.`,
            photoCount,
            maxPhotos: MAX_PHOTOS_PER_SPECIES,
          },
          { status: 409 }
        );
      }

      const occupant = photos.find((p) => p.slot === targetSlot);
      replacedPhoto = occupant ? { id: occupant.id, imageUrl: occupant.imageUrl } : null;
    }

    let newPhotoUrl: string | null = null;

    if (wantsNewPhoto && targetSlot !== null && file && env.MOONHOYA_PHOTOS) {
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

    // 5. Write the photo into its slot. Replacing deletes the old row and inserts the new one
    //    in a single transaction; the unique (speciesId, slot) index guards against races.
    if (newPhotoUrl && targetSlot !== null) {
      const photoId = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const statements = [];
      if (replacedPhoto) {
        statements.push(env.DB.prepare(`DELETE FROM PlantSpeciesPhoto WHERE id = ?`).bind(replacedPhoto.id));
      }
      statements.push(
        env.DB.prepare(
          `INSERT INTO PlantSpeciesPhoto (id, speciesId, imageUrl, slot) VALUES (?, ?, ?, ?)`
        ).bind(photoId, speciesId, newPhotoUrl, targetSlot)
      );

      try {
        await env.DB.batch(statements);
      } catch {
        // Most likely another scan filled this slot first: remove the orphaned upload.
        await env.MOONHOYA_PHOTOS?.delete(uploadedKey!);
        uploadedKey = null;
        return NextResponse.json(
          { error: `Could not save to slot ${targetSlot}. Please try again.` },
          { status: 409 }
        );
      }

      uploadedKey = null; // now referenced by the DB, keep it

      if (replacedPhoto) {
        // The old picture is no longer referenced: remove its R2 object (best-effort)
        const oldKey = replacedPhoto.imageUrl.startsWith('/api/photos/')
          ? replacedPhoto.imageUrl.slice('/api/photos/'.length)
          : null;
        if (oldKey) {
          try {
            await env.MOONHOYA_PHOTOS?.delete(oldKey);
          } catch {
            // ignore: orphan object is harmless
          }
        }
      } else {
        photoCount += 1;
      }

      // Cover mirrors the photo in the lowest slot
      const first = await env.DB.prepare(
        `SELECT imageUrl FROM PlantSpeciesPhoto WHERE speciesId = ? ORDER BY slot ASC LIMIT 1`
      ).bind(speciesId).first<{ imageUrl: string }>();
      coverImageUrl = first?.imageUrl ?? null;
      await env.DB.prepare(`UPDATE PlantSpecies SET imageUrl = ? WHERE id = ?`)
        .bind(coverImageUrl, speciesId)
        .run();
    }

    // 6. Build collision-resistant SKU for inventory batch
    const catPrefix = category === 'PLANT' ? 'MH' : category.substring(0, 3).toUpperCase();
    const cleanCode = botanicalName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase();
    const potLabel = potSize > 0 ? `-${potSize}IN` : '';
    // SKU is shortened (6-char name, 4-char zone), so different kinds/zones can produce the same base.
    // InventoryBatch.sku is UNIQUE, so take the base SKU or the first free numbered variant (-2, -3, ...).
    const baseSku = `${catPrefix}-${cleanCode}${potLabel}-${zone.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase()}`;
    let sku = baseSku;
    for (let n = 2; ; n++) {
      const taken = await env.DB.prepare(`SELECT 1 AS found FROM InventoryBatch WHERE sku = ?`)
        .bind(sku)
        .first<{ found: number }>();
      if (!taken) break;
      sku = `${baseSku}-${n}`;
    }

    // 7. Update or create Inventory Batch
    const existingBatch = await env.DB.prepare(`
      SELECT id, sku, quantity FROM InventoryBatch
      WHERE speciesId = ? AND potSizeInches = ? AND greenhouseZone = ?
    `).bind(speciesId, potSize, zone).first<{ id: string; sku: string; quantity: number }>();

    let batchResult: { id: string; sku: string; quantity: number; updated: boolean };

    if (existingBatch) {
      const newQty = existingBatch.quantity + qtyToAdd;
      await env.DB.prepare(`
        UPDATE InventoryBatch
        SET quantity = ?, priceCents = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(newQty, priceCents, existingBatch.id).run();

      batchResult = { id: existingBatch.id, sku: existingBatch.sku, quantity: newQty, updated: true };
    } else {
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await env.DB.prepare(`
        INSERT INTO InventoryBatch (id, sku, speciesId, potSizeInches, quantity, priceCents, greenhouseZone)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(batchId, sku, speciesId, potSize, qtyToAdd, priceCents, zone).run();

      batchResult = { id: batchId, sku, quantity: qtyToAdd, updated: false };
    }

    // 8. Keep every AI-detected candidate for this photo against the batch
    const detections = parseDetections(formData.get('detections'));
    for (const [index, d] of detections.entries()) {
      await env.DB.prepare(`
        INSERT INTO ScanDetection (id, batchId, rank, botanicalName, commonName, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        `det-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        batchResult.id,
        index + 1,
        d.botanicalName,
        d.commonName,
        d.confidence
      ).run();
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
      addedPhotoSlot: newPhotoUrl ? targetSlot : null,
      replacedPhoto: !!replacedPhoto && !!newPhotoUrl,
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
