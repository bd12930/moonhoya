-- Every candidate the on-device AI returned for a scanned photo, kept against the inventory batch.
-- Shown in the dashboard edit modal so the species can be picked from the AI's suggestions.
CREATE TABLE IF NOT EXISTS ScanDetection (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL,
  rank INTEGER NOT NULL,          -- 1 = top AI match
  botanicalName TEXT NOT NULL,
  commonName TEXT NOT NULL,
  confidence REAL,                -- 0-100
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batchId) REFERENCES InventoryBatch(id)
);

CREATE INDEX IF NOT EXISTS idx_scan_detection_batch
  ON ScanDetection (batchId, rank);
