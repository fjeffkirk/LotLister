import { NextResponse, after } from "next/server";
import { startBackgroundIndexer } from "@/lib/sync/background-indexer";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { beginSyncRun, executeSyncRun } from "@/lib/sync/shopify-sync";
import { isScheduledIndexerEnabled } from "@/lib/sync/background-indexer";
import { log } from "@/lib/logger";
import { isShopifyApiReady } from "@/lib/shopify/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * External scheduler (Render Cron, cron-job.org, etc.): GET /api/cron/sync
 * Set CRON_SECRET; pass ?secret= or Authorization: Bearer.
 * Wakes a sleeping instance and runs the same incremental catch-up as the in-process indexer.
 */
export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 401 });
  }
  const url = new URL(request.url);
  const s = url.searchParams.get("secret");
  const auth = request.headers.get("authorization");
  if (s !== env.CRON_SECRET && auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!prisma) return NextResponse.json({ error: "No database" }, { status: 503 });
  startBackgroundIndexer();
  if (!(await isShopifyApiReady())) return NextResponse.json({ skipped: true, reason: "no_shopify" });

  let settings;
  try {
    settings = await prisma.appSetting.findFirst({
      select: { pollingIntervalMinutes: true },
    });
  } catch (e) {
    log.warn("cron sync settings", { e });
    return NextResponse.json({ error: "Database unreachable" }, { status: 503 });
  }
  if (!isScheduledIndexerEnabled(settings?.pollingIntervalMinutes)) {
    return NextResponse.json({ skipped: true, reason: "indexer_disabled" });
  }

  const db = prisma;
  let began;
  try {
    began = await beginSyncRun(db, {});
  } catch (e) {
    log.error("cron sync create", { e });
    return NextResponse.json({ error: "Could not start sync" }, { status: 500 });
  }

  if (began.shouldExecute) {
    const work = executeSyncRun(db, began.run.id, {}).catch((e) => {
      log.error("cron sync background", { e });
    });
    after(() => work);
  }

  return NextResponse.json({
    ok: true,
    runId: began.run.id,
    skipped: began.skipped,
    reused: began.reused,
  });
}
