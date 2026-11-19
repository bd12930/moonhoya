type D1Database = CloudflareEnv['DB'];

/** One AI candidate saved for a scanned photo (ScanDetection row). */
export interface ScanDetectionItem {
  botanicalName: string;
  commonName: string;
  confidence: number | null;
  rank: number;
}

/**
 * Loads saved AI candidates grouped by inventory batch id, best match first.
 * Returns an empty map if the table is not there yet (migration 0002 not applied),
 * so the inventory still loads.
 */
export async function loadDetectionsByBatch(db: D1Database): Promise<Map<string, ScanDetectionItem[]>> {
  const byBatch = new Map<string, ScanDetectionItem[]>();
  try {
    const { results } = await db
      .prepare(`SELECT batchId, rank, botanicalName, commonName, confidence FROM ScanDetection ORDER BY rank ASC, createdAt ASC`)
      .all<{ batchId: string; rank: number; botanicalName: string; commonName: string; confidence: number | null }>();

    for (const row of results ?? []) {
      const list = byBatch.get(row.batchId) ?? [];
      list.push({
        botanicalName: row.botanicalName,
        commonName: row.commonName,
        confidence: row.confidence,
        rank: row.rank,
      });
      byBatch.set(row.batchId, list);
    }
  } catch {
    // table missing: no AI candidates to show
  }
  return byBatch;
}
