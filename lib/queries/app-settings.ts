import { cache } from "react";
import { tryPrisma } from "@/lib/db";
import { SyncMode } from "@prisma/client";

/**
 * Fetch app settings once per React render cycle.
 * React's cache() deduplicates calls within the same server request,
 * so layout + page + any utility that calls this will share one DB query.
 */
export const getAppSettings = cache(async function getAppSettings() {
  return tryPrisma((db) => db.appSetting.findFirst());
});

export function syncModeLabel(mode: SyncMode) {
  switch (mode) {
    case "manual":
      return "Off (Sync button only)";
    case "polling":
      return "Scheduled";
    case "webhook_ready":
      return "Webhooks + scheduled";
    default:
      return mode;
  }
}
