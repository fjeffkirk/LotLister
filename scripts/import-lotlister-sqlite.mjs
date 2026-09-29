/**
 * One-time copy of the pre-Postgres LotLister SQLite database into Postgres.
 *
 * Keeps every id and timestamp. Rows that already exist in Postgres are left alone.
 * The SQLite file is never modified; a `<file>.imported` marker is written next to it
 * so later deploys skip the import (otherwise lots deleted after the move would come back).
 *
 * Run from db-migrate.mjs by setting IMPORT_SQLITE_PATH (e.g. /data/lotlister.sqlite),
 * or directly: node scripts/import-lotlister-sqlite.mjs /data/lotlister.sqlite
 */

import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const CHUNK = 500;

/** Parents before children, so foreign keys are satisfied. Optional tables were added late and may be absent. */
const TABLES = [
  { model: 'user', key: 'email' },
  { model: 'lot', key: 'id' },
  { model: 'exportProfile', key: 'id' },
  { model: 'cardItem', key: 'id' },
  { model: 'cardImage', key: 'id' },
  { model: 'ebayConnection', key: 'userEmail' },
  { model: 'ebayDeletionNotification', key: 'notificationId', optional: true },
  { model: 'ebayItemPlayer', key: 'itemId', optional: true },
];

export async function importLotListerSqlite(sqlitePath) {
  const file = path.resolve(sqlitePath);
  const marker = `${file}.imported`;
  if (existsSync(marker)) {
    console.log(`[import] ${path.basename(file)} was already imported. Skipping.`);
    return;
  }
  if (!existsSync(file)) {
    throw new Error(`[import] SQLite file not found: ${file}`);
  }

  const { PrismaClient: LegacyClient } = require('../node_modules/.prisma/legacy-sqlite');
  const legacy = new LegacyClient({ datasources: { db: { url: `file:${file}` } } });
  const db = new PrismaClient();
  const summary = {};

  try {
    for (const { model, key, optional } of TABLES) {
      let rows;
      try {
        rows = await legacy[model].findMany();
      } catch (error) {
        const missing = /does not exist|no such table/i.test(String(error?.message));
        if (missing && !optional) {
          throw new Error(`[import] ${file} has no ${model} table. Is IMPORT_SQLITE_PATH pointing at the LotLister database?`);
        }
        if (missing) {
          summary[model] = { sqlite: 0, copied: 0, note: 'table not in SQLite file' };
          continue;
        }
        throw error;
      }

      let copied = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const result = await db[model].createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
        copied += result.count;
      }

      let present = 0;
      const keys = rows.map((row) => row[key]);
      for (let i = 0; i < keys.length; i += CHUNK) {
        present += await db[model].count({ where: { [key]: { in: keys.slice(i, i + CHUNK) } } });
      }
      if (present !== rows.length) {
        throw new Error(`[import] ${model}: ${rows.length} rows in SQLite but only ${present} in Postgres`);
      }
      summary[model] = { sqlite: rows.length, copied };
    }
  } finally {
    await legacy.$disconnect();
    await db.$disconnect();
  }

  writeFileSync(marker, JSON.stringify({ importedAt: new Date().toISOString(), summary }, null, 2));
  console.log('[import] Copied LotLister data into Postgres:');
  for (const [model, counts] of Object.entries(summary)) {
    console.log(`  ${model}: ${counts.sqlite} rows (${counts.copied} new)${counts.note ? ` - ${counts.note}` : ''}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const target = process.argv[2] || process.env.IMPORT_SQLITE_PATH;
  if (!target) {
    console.error('Usage: node scripts/import-lotlister-sqlite.mjs <path-to-sqlite-file>');
    process.exit(1);
  }
  await importLotListerSqlite(target);
}
