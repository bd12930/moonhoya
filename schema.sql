-- Static botanical data and care guides for Moonhoya catalog
CREATE TABLE IF NOT EXISTS PlantSpecies (
  id TEXT PRIMARY KEY,
  commonName TEXT NOT NULL,
  botanicalName TEXT NOT NULL UNIQUE,
  description TEXT,
  sunReq TEXT NOT NULL,          -- 'FULL_SUN', 'INDIRECT_LIGHT', 'PARTIAL_SHADE'
  waterFrequency INTEGER NOT NULL, -- Days between watering
  petSafe INTEGER DEFAULT 0,     -- 0 = False, 1 = True
  imageUrl TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
