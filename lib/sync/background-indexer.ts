import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { isShopifyApiReady } from "@/lib/shopify/config";
import { beginSyncRun, executeSyncRun } from "@/lib/sync/shopify-sync";
import {
  INDEXER_CHECK_EVERY_MS,
  isCatchUpDue,
} from "@/lib/sync/indexer-schedule";

export { isScheduledIndexerEnabled, isCatchUpDue } from "@/lib/sync/indexer-schedule";

let started = false;
let inFlight = false;

function inNextBuild() {
  if (process.env.NEXT_PHASE) return true;
  return process.argv.includes("build");
}

/**
 * Long-lived Next.js process (Render `next start`): keep Postgres current
 * without a browser tab. Sleeping instances resume this on cold start.
 */
export function startBackgroundIndexer() {
  if (started || inNextBuild()) return;
  if (!prisma) return;
  started = true;
  void tick("boot");
  setInterval(() => void tick("interval"), INDEXER_CHECK_EVERY_MS);
}

async function tick(reason: "boot" | "interval") {
  if (inFlight || !prisma) return;
  inFlight = true;
  try {
    const settings = await prisma.appSetting.findFirst({
      select: { pollingIntervalMinutes: true, lastSuccessfulSyncAt: true },
    });
    if (!isCatchUpDue(settings?.lastSuccessfulSyncAt, settings?.pollingIntervalMinutes)) return;
    if (!(await isShopifyApiReady())) return;

    const began = await beginSyncRun(prisma, {});
    if (!began.shouldExecute) return;
    log.info("Background indexer starting", { reason, runId: began.run.id });
    await executeSyncRun(prisma, began.run.id, {});
  } catch (e) {
    log.warn("Background indexer tick failed", {
      reason,
      message: e instanceof Error ? e.message.slice(0, 160) : String(e),
    });
  } finally {
    inFlight = false;
  }
}
