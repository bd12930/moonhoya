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
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, slot INTEGER,
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
CREATE TABLE AppUser (
  username TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  passwordHash TEXT NOT NULL,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "AppUser" ("username","role","passwordHash","updatedAt") VALUES('budi','admin','pbkdf2-sha256$100000$XO73EcLfwIdpIJyvYlfWUA==$oCFpw6AOpGQc7rJnn9wTJAfyzwjHsKxxd3rk4QSZ32A=','2026-11-19 14:06:49');
INSERT INTO "AppUser" ("username","role","passwordHash","updatedAt") VALUES('shitarini','staff','pbkdf2-sha256$100000$R9Zc8dggVM5fSA3EbEEyQQ==$2v1xBvqdGqC0xOWm3XjUxAWAnu3vIhdLNyQXKT81DlM=','2026-11-19 14:06:49');
INSERT INTO "AppUser" ("username","role","passwordHash","updatedAt") VALUES('andy','staff','pbkdf2-sha256$100000$/cDnxYWGqPRj3cfDAlbfBw==$ZcrKPqH2i0EXw3RzGuy2oh3c8nr+qF88i4r/j7cmkiQ=','2026-11-19 14:06:49');
INSERT INTO "AppUser" ("username","role","passwordHash","updatedAt") VALUES('debora','staff','pbkdf2-sha256$100000$7o89dsGpnb1+2q9ddziL4Q==$keddDkMnkhc+Rcl2rp4g539L7g8nQxrYTrUOsMnWVIs=','2026-11-19 14:06:49');
CREATE TABLE ScanDetection (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  rank INTEGER NOT NULL,          -- 1 = top AI match
  botanicalName TEXT NOT NULL,
  commonName TEXT NOT NULL,
  confidence REAL,                -- 0-100
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batchId) REFERENCES InventoryBatch(id)
);
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_species_photo_lookup
  ON PlantSpeciesPhoto (speciesId, createdAt);
CREATE INDEX idx_inventory_batch_lookup
  ON InventoryBatch (speciesId, potSizeInches, greenhouseZone);
CREATE INDEX idx_scan_detection_batch
  ON ScanDetection (batchId, rank);
CREATE UNIQUE INDEX idx_species_photo_slot
  ON PlantSpeciesPhoto (speciesId, slot);
