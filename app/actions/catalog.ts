"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import { revalidateDashboardFigures } from "@/lib/sync/revalidate";

export async function updateProductMargin(id: string, marginPercent: number | null) {
  if (!prisma) return { ok: false as const, error: "No database" };
  try {
    await prisma.catalogItem.update({
      where: { id },
      data: { marginPercentOverride: marginPercent },
    });
    revalidateDashboardFigures();
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Failed to update margin" };
  }
}

const catalogPatch = z.object({
  costBasis: z.union([z.number().min(0), z.null()]).optional(),
  reorderThreshold: z.union([z.number().int().min(0), z.null()]).optional(),
  skipLowStockAlert: z.boolean().optional(),
});

export async function updateCatalogItem(id: string, patch: z.infer<typeof catalogPatch>) {
  const data = catalogPatch.parse(patch);
  if (!prisma) return { ok: false as const, error: "No database" };
  try {
    await prisma.catalogItem.update({
      where: { id },
      data: {
        ...(data.costBasis !== undefined
          ? { costBasis: data.costBasis == null ? null : toDecimal(data.costBasis) }
          : {}),
        ...(data.reorderThreshold !== undefined ? { reorderThreshold: data.reorderThreshold } : {}),
        ...(data.skipLowStockAlert !== undefined ? { skipLowStockAlert: data.skipLowStockAlert } : {}),
      },
    });
    revalidateDashboardFigures();
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Failed to update item" };
  }
}
