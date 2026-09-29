import { NextResponse } from "next/server";
import { isUnauthorized, requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/db";
import { fromZonedTime } from "date-fns-tz";
import { toNumber } from "@/lib/money";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  if (isUnauthorized(session)) return session;
  if (!prisma) return NextResponse.json({ error: "No database" }, { status: 503 });
  const url = new URL(request.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const from = fromStr
    ? fromZonedTime(fromStr + "T00:00:00", "America/New_York")
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = toStr
    ? fromZonedTime(toStr + "T23:59:59.999", "America/New_York")
    : new Date();

  const orders = await prisma.order.findMany({
    where: {
      orderDate: { gte: from, lte: to },
      OR: [{ sourceChannel: null }, { NOT: { sourceChannel: "draft_orders" } }],
    },
    orderBy: { orderDate: "desc" },
    take: 5000,
    select: {
      orderName: true,
      customerName: true,
      customerEmail: true,
      total: true,
      orderDate: true,
      fulfillmentStatus: true,
      financialStatus: true,
    },
  });

  const header = "order,customer,email,total,date,fulfillment,financial";
  const lines = orders.map((o) =>
    [
      csv(o.orderName),
      csv(o.customerName),
      csv(o.customerEmail),
      toNumber(o.total).toFixed(2),
      o.orderDate.toISOString(),
      csv(o.fulfillmentStatus),
      csv(o.financialStatus),
    ].join(","),
  );
  const body = [header, ...lines].join("\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stockpilot-orders.csv"`,
    },
  });
}

function csv(v: string | null | undefined) {
  const s = v ?? "";
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
