import { NextResponse } from "next/server";
import { isUnauthorized, requireSession } from "@/lib/require-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import { revalidateDashboardFigures } from "@/lib/sync/revalidate";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  id: z.string().min(1),
  marginPercent: z.number().min(0).max(100).nullable().optional(),
  costBasis: z.number().min(0).nullable().optional(),
  reorderThreshold: z.number().int().min(0).nullable().optional(),
});

/**
 * JSON PATCH so Settings/Inventory saves are not tied to a Server Action RSC
 * refresh of the current page (that was leaving Save spinning forever).
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (isUnauthorized(session)) return session;
  if (!prisma) {
    return NextResponse.json({ ok: false, error: "No database" }, { status: 503, headers: noStore });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid catalog update" }, { status: 400, headers: noStore });
  }
  const { id, marginPercent, costBasis, reorderThreshold } = parsed.data;
  if (marginPercent === undefined && costBasis === undefined && reorderThreshold === undefined) {
    return NextResponse.json({ ok: false, error: "Nothing to update" }, { status: 400, headers: noStore });
  }
  try {
    await prisma.catalogItem.update({
      where: { id },
      data: {
        ...(marginPercent !== undefined ? { marginPercentOverride: marginPercent } : {}),
        ...(costBasis !== undefined ? { costBasis: costBasis == null ? null : toDecimal(costBasis) } : {}),
        ...(reorderThreshold !== undefined ? { reorderThreshold } : {}),
      },
    });
    if (marginPercent !== undefined) {
      const settings = await prisma.appSetting.findFirst({ select: { defaultMarginPercent: true } });
      const rate = (marginPercent ?? settings?.defaultMarginPercent ?? 35) / 100;
      const costRate = 1 - rate;
      await prisma.$executeRaw`
        UPDATE "OrderLineItem"
        SET "estimatedLineProfit" = "lineRevenue" * ${rate},
            "estimatedUnitCost" = CASE
              WHEN quantity > 0 THEN ("lineRevenue" / quantity) * ${costRate}
              ELSE "lineRevenue" * ${costRate}
            END
        WHERE "catalogItemId" = ${id} AND "profitIsExact" = false
      `;
    }
    revalidateDashboardFigures();
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update item" }, { status: 500, headers: noStore });
  }
}
