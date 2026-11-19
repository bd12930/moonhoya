-- Gallery slots (1..5) for each kind's photos, so the scanner can pick which slot a picture goes into.
ALTER TABLE PlantSpeciesPhoto ADD COLUMN slot INTEGER;

-- Backfill existing photos in their current order (oldest = slot 1).
UPDATE PlantSpeciesPhoto SET slot = (
  SELECT COUNT(*) FROM PlantSpeciesPhoto P2
  WHERE P2.speciesId = PlantSpeciesPhoto.speciesId
    AND (
      P2.createdAt < PlantSpeciesPhoto.createdAt
      OR (P2.createdAt = PlantSpeciesPhoto.createdAt AND P2.id <= PlantSpeciesPhoto.id)
    )
) WHERE slot IS NULL;

-- One photo per slot per kind (also makes concurrent writes to the same slot fail safely).
CREATE UNIQUE INDEX IF NOT EXISTS idx_species_photo_slot
  ON PlantSpeciesPhoto (speciesId, slot);
