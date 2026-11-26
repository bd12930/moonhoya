#!/usr/bin/env node
// Export labeled plant photos from D1 + R2 into an image-folder dataset:
//   dataset/<species-id>/<photo>.webp   and   dataset/manifest.json
// Usage: node scripts/export-plant-dataset.mjs [--target local|remote] [--out dataset]
// Reads only; never writes to D1 or R2.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const BUCKET = 'moonhoya-plant-photos';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const target = flag('--target', 'local');
const outDir = flag('--out', 'dataset');
if (!['local', 'remote'].includes(target)) {
  console.error('--target must be "local" or "remote"');
  process.exit(1);
}
const targetFlag = target === 'remote' ? '--remote' : '--local';

async function d1(sql) {
  const { stdout } = await run('npx', ['wrangler', 'd1', 'execute', 'moonhoya_db', targetFlag, '--json', '--command', sql], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout)[0].results;
}

const rows = await d1(`
  SELECT S.id AS speciesId, S.commonName AS commonName, P.id AS photoId, P.imageUrl AS imageUrl
  FROM PlantSpeciesPhoto P
  JOIN PlantSpecies S ON S.id = P.speciesId
  ORDER BY S.id, P.slot, P.createdAt
`);

await rm(outDir, { recursive: true, force: true });
const manifest = [];
const skipped = [];

for (const row of rows) {
  // Gallery photos are stored as /api/photos/<key>; anything else is an external URL.
  const prefix = '/api/photos/';
  if (!row.imageUrl.startsWith(prefix)) {
    skipped.push({ photoId: row.photoId, reason: 'not an R2 key', imageUrl: row.imageUrl });
    continue;
  }
  const key = decodeURIComponent(row.imageUrl.slice(prefix.length));
  const dir = path.join(outDir, row.speciesId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, path.basename(key));

  try {
    await run('npx', ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${key}`, targetFlag, '--file', file]);
  } catch (err) {
    skipped.push({ photoId: row.photoId, reason: 'download failed', key, error: String(err.stderr ?? err.message).trim() });
    continue;
  }

  manifest.push({ label: row.speciesId, commonName: row.commonName, file: path.relative(outDir, file) });
}

await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({ exportedAt: new Date().toISOString(), target, manifest, skipped }, null, 2));

const perSpecies = manifest.reduce((acc, m) => ((acc[m.label] = (acc[m.label] ?? 0) + 1), acc), {});
console.log(`Exported ${manifest.length} photos across ${Object.keys(perSpecies).length} species to ${outDir}/`);
for (const [label, count] of Object.entries(perSpecies)) console.log(`  ${label}: ${count}`);
if (skipped.length) console.log(`Skipped ${skipped.length} (see manifest.json)`);
