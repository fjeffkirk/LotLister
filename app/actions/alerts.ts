"use server";

import { prisma } from "@/lib/db";
import {
  getLowStockAlert,
  getOverdueFulfillmentAlert,
  type AlertSnapshot,
} from "@/lib/queries/dashboard";

const empty: AlertSnapshot = { count: 0, ids: [] };

export async function fetchAlertSnapshots(): Promise<{
  lowStock: AlertSnapshot;
  overdue: AlertSnapshot;
}> {
  if (!prisma) return { lowStock: empty, overdue: empty };
  try {
    const [lowStock, overdue] = await Promise.all([
      getLowStockAlert(prisma),
      getOverdueFulfillmentAlert(prisma),
    ]);
    return { lowStock, overdue };
  } catch {
    return { lowStock: empty, overdue: empty };
  }
}
