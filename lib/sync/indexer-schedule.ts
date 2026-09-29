/** How often the in-process indexer checks whether a catch-up is due. */
export const INDEXER_CHECK_EVERY_MS = 60_000;

function intervalMs(minutes: number | null | undefined) {
  const n = minutes ?? 10;
  if (n <= 0) return 0;
  return n * 60_000;
}

/** Server catch-up is on whenever the interval is > 0. */
export function isScheduledIndexerEnabled(pollingIntervalMinutes: number | null | undefined) {
  return intervalMs(pollingIntervalMinutes) > 0;
}

export function isCatchUpDue(
  lastSuccessfulSyncAt: Date | null | undefined,
  pollingIntervalMinutes: number | null | undefined,
  nowMs = Date.now(),
) {
  const ms = intervalMs(pollingIntervalMinutes);
  if (ms <= 0) return false;
  if (!lastSuccessfulSyncAt) return true;
  return nowMs - lastSuccessfulSyncAt.getTime() >= ms;
}
