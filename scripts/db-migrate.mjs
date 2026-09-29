/**
 * Runs before `next start` on every deploy.
 *
 * 1. If this is StockPilot's existing database (tables created by `prisma db push`,
 *    so no migration history), record the StockPilot baseline as already applied.
 * 2. Apply pending migrations. They only ever add to the database.
 * 3. If IMPORT_SQLITE_PATH is set, copy the old LotLister SQLite database in once.
 * 4. Warn (without failing) if the live database has drifted from prisma/schema.prisma.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const STOCKPILOT_BASELINE = '20260929000000_stockpilot_baseline';
const prismaBin = path.join('node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');

function prisma(args, options = {}) {
  return execFileSync(prismaBin, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
}

const db = new PrismaClient();
const [state] = await db.$queryRaw`
  SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "hasHistory",
         to_regclass('public."AppSetting"') IS NOT NULL AS "hasStockPilot"`;
await db.$disconnect();

if (!state.hasHistory && state.hasStockPilot) {
  console.log('[db] Existing StockPilot database found. Recording the StockPilot baseline as applied.');
  prisma(['migrate', 'resolve', '--applied', STOCKPILOT_BASELINE]);
}

prisma(['migrate', 'deploy']);

if (process.env.IMPORT_SQLITE_PATH?.trim()) {
  const { importLotListerSqlite } = await import('./import-lotlister-sqlite.mjs');
  await importLotListerSqlite(process.env.IMPORT_SQLITE_PATH.trim());
}

const drift = spawnSync(
  prismaBin,
  ['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'],
  { encoding: 'utf8', shell: process.platform === 'win32' }
);
if (drift.status === 2) {
  console.warn('[db] Warning: the database does not exactly match prisma/schema.prisma:\n' + drift.stdout.trim());
}
