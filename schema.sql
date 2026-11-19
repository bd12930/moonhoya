-- Static botanical data and master catalog items for Moonhoya (Plants, Supplies, Pots, Hardware)
CREATE TABLE IF NOT EXISTS PlantSpecies (
  id TEXT PRIMARY KEY,
  category TEXT DEFAULT 'PLANT',   -- 'PLANT', 'FERTILIZER', 'POT', 'EQUIPMENT', 'HARDWARE'
  commonName TEXT NOT NULL,
  botanicalName TEXT NOT NULL UNIQUE,
  description TEXT,
  sunReq TEXT NOT NULL,          -- 'FULL_SUN', 'INDIRECT_LIGHT', 'PARTIAL_SHADE'
  waterFrequency INTEGER NOT NULL, -- Days between watering
  petSafe INTEGER DEFAULT 0,     -- 0 = False, 1 = True
  imageUrl TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Master catalog photo gallery: up to 5 pictures per PlantSpecies entry
-- (cap enforced in /api/inventory/scan). PlantSpecies.imageUrl mirrors the first photo as the cover.
CREATE TABLE IF NOT EXISTS PlantSpeciesPhoto (
  id TEXT PRIMARY KEY,
  speciesId TEXT NOT NULL,
  imageUrl TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (speciesId) REFERENCES PlantSpecies(id)
);

CREATE INDEX IF NOT EXISTS idx_species_photo_lookup
  ON PlantSpeciesPhoto (speciesId, createdAt);

-- Backfill: carry over existing single cover photos into the gallery (idempotent via fixed id)
INSERT OR IGNORE INTO PlantSpeciesPhoto (id, speciesId, imageUrl)
  SELECT 'photo-' || id, id, imageUrl FROM PlantSpecies
  WHERE imageUrl IS NOT NULL AND imageUrl <> '';

-- Live inventory batches tracked by pot size, zone, and precise quantities
CREATE TABLE IF NOT EXISTS InventoryBatch (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  speciesId TEXT NOT NULL,
  potSizeInches INTEGER NOT NULL, -- e.g., 4, 6, 10
  quantity INTEGER NOT NULL,
  priceCents INTEGER NOT NULL,
  growthStage TEXT DEFAULT 'READY_FOR_SALE',
  greenhouseZone TEXT NOT NULL,   -- e.g., 'Shade House A - Table 2'
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (speciesId) REFERENCES PlantSpecies(id)
);

-- Index to speed up the batch lookup in /api/inventory/scan
CREATE INDEX IF NOT EXISTS idx_inventory_batch_lookup
  ON InventoryBatch (speciesId, potSizeInches, greenhouseZone);

-- Daily care logs for greenhouse staff
CREATE TABLE IF NOT EXISTS CareTask (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  taskType TEXT NOT NULL,         -- 'WATER', 'FERTILIZE', 'PRUNE'
  dueDate DATETIME NOT NULL,
  completed INTEGER DEFAULT 0,
  completedBy TEXT,
  FOREIGN KEY (batchId) REFERENCES InventoryBatch(id)
);

-- Configurable settings (categories, currency, locations, pot sizes)
CREATE TABLE IF NOT EXISTS AppSetting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
