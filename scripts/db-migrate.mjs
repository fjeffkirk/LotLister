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

const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  console.error(
    [
      '[db] DATABASE_URL must be a Postgres URL starting with postgresql://.',
      '[db] On Render, open the StockPilot Postgres database, copy its Internal Database URL,',
      '[db] and set that as DATABASE_URL on the LotLister service (replace the old file: SQLite value).',
      '[db] Leave IMPORT_SQLITE_PATH=/data/lotlister.sqlite. Existing lots are copied from that file on first start.',
    ].join('\n')
  );
  process.exit(1);
}

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
