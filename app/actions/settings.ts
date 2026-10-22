"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { SyncMode } from "@prisma/client";
import { revalidateAppData } from "@/lib/sync/revalidate";

const schema = z.object({
  defaultMarginPercent: z.coerce.number().min(0).max(99.99),
  lowStockDefaultThreshold: z.coerce.number().int().min(0),
  defaultReorderQuantity: z.coerce.number().int().min(1),
  averageFreeShippingCost: z.coerce.number().min(0).max(999),
  pollingIntervalMinutes: z.coerce.number().int().min(0).max(1440),
  syncMode: z.nativeEnum(SyncMode),
});

export async function updateSettings(input: z.infer<typeof schema>) {
  const data = schema.parse(input);
  if (!prisma) return { ok: false as const, error: "Database not configured" };
  try {
    const existing = await prisma.appSetting.findFirst();
    if (!existing) {
      await prisma.appSetting.create({ data });
    } else {
      await prisma.appSetting.update({ where: { id: existing.id }, data });
    }
  } catch {
    return { ok: false as const, error: "Database unreachable; check PostgreSQL and DATABASE_URL." };
  }
  revalidateAppData();
  return { ok: true as const };
}
