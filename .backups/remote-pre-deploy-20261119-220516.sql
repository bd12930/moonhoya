PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE PlantSpecies (
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
CREATE TABLE PlantSpeciesPhoto (
  id TEXT PRIMARY KEY,
  speciesId TEXT NOT NULL,
  imageUrl TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (speciesId) REFERENCES PlantSpecies(id)
);
CREATE TABLE InventoryBatch (
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
CREATE TABLE CareTask (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  taskType TEXT NOT NULL,         -- 'WATER', 'FERTILIZE', 'PRUNE'
  dueDate DATETIME NOT NULL,
  completed INTEGER DEFAULT 0,
  completedBy TEXT,
  FOREIGN KEY (batchId) REFERENCES InventoryBatch(id)
);
CREATE TABLE AppSetting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_species_photo_lookup
  ON PlantSpeciesPhoto (speciesId, createdAt);
CREATE INDEX idx_inventory_batch_lookup
  ON InventoryBatch (speciesId, potSizeInches, greenhouseZone);
