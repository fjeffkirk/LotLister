import { unstable_cache } from "next/cache";
import { safeQuery } from "@/lib/db";
import { getAppSettings } from "@/lib/queries/app-settings";
import { fillDaySeries } from "@/lib/dates";
import { blendedMarginRate, estimatedNetProfit, freeShippingCostTotal, FREE_SHIPPING_THRESHOLD_USD, DEFAULT_AVERAGE_FREE_SHIPPING_COST_USD } from "@/lib/profit";
import { Prisma, PrismaClient } from "@prisma/client";

/** 1 for each $0-shipping order whose merchandise hit the free-shipping threshold. */
const freeShippingOrderSql = Prisma.sql`(
  CASE
    WHEN COALESCE("shippingCollected", 0) < 0.01
     AND (total - COALESCE("shippingCollected", 0)) >= ${FREE_SHIPPING_THRESHOLD_USD}
    THEN 1 ELSE 0
  END
)`;

export type KpiTrend = {
  pct: number;
  /** "none" = prior period had no data, suppress badge entirely */
  direction: "up" | "down" | "flat" | "none";
};

export type DashboardKpis = {
  orderCount: number;
  itemCount: number;
  revenue: number;
  estProfit: number;   // product-line profit − ads − free-shipping costs
  grossProfit: number; // product-line profit − free-shipping costs
  adSpend: number;     // total ad spend for the period
  shipping: number;
  aov: number;
  unfulfilledOrders: number;
  fulfilledOrders: number;
  marginPercent: number;
  avgMargin: number;
  prior: { revenue: number; estProfit: number; orderCount: number; itemCount: number };
  trends: {
    revenue: KpiTrend;
    estProfit: KpiTrend;
    orderCount: KpiTrend;
    aov: KpiTrend;
    itemCount: KpiTrend;
    shipping: KpiTrend;
  };
};

export type DaySeries = { name: string; value: number }[];

function flatTrend(): KpiTrend { return { pct: 0, direction: "flat" }; }
function calcTrend(current: number, prev: number): KpiTrend {
  // No prior data — suppress the badge rather than show a misleading "+100%"
  if (prev === 0) return current > 0 ? { pct: 0, direction: "none" } : { pct: 0, direction: "flat" };
  const pct = Math.round(((current - prev) / Math.abs(prev)) * 100);
  return { pct: Math.abs(pct), direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}
function emptyKpis(marginPercent: number): DashboardKpis {
  const t = flatTrend();
  return { orderCount: 0, itemCount: 0, revenue: 0, estProfit: 0, grossProfit: 0, adSpend: 0, shipping: 0, aov: 0, unfulfilledOrders: 0, fulfilledOrders: 0, marginPercent, avgMargin: marginPercent, prior: { revenue: 0, estProfit: 0, orderCount: 0, itemCount: 0 }, trends: { revenue: t, estProfit: t, orderCount: t, aov: t, itemCount: t, shipping: t } };
}


export async function getDashboardKpis(
  from: Date,
  to: Date,
  marginPercent?: number,
  comparison?: { prevFrom: Date; prevTo: Date },
  adSpendAmounts?: { current: number; prev: number },
  averageFreeShippingCost = DEFAULT_AVERAGE_FREE_SHIPPING_COST_USD,
): Promise<DashboardKpis> {
  return safeQuery(emptyKpis(marginPercent ?? 35), async (db) => {
    // margin is already resolved by the caller (page-level getAppSettings) — no extra settings fetch needed
    const margin = (marginPercent ?? 35) / 100;
    const freeShipEach = Math.max(0, averageFreeShippingCost);

    const duration = to.getTime() - from.getTime();
    const prevFrom = comparison?.prevFrom ?? new Date(from.getTime() - duration);
    const prevTo = comparison?.prevTo ?? new Date(from.getTime() - 1);

    // Each CTE query combines two former separate queries into one DB round-trip,
    // reducing parallel connection usage from 6 to 3.
    type CombinedAgg = {
      order_count: bigint; revenue: string; shipping: string; free_ship_orders: bigint;
      total_profit: string; total_revenue: string; total_items: bigint;
    };
    type FulfillAgg = { unfulfilled: bigint; fulfilled: bigint };

    const [curr, prev, fulfillRow] = await Promise.all([
      // Current period: order totals + line-item profit in one CTE
      db.$queryRaw<CombinedAgg[]>`
        WITH order_agg AS (
          SELECT COUNT(*)::bigint                          AS order_count,
                 COALESCE(SUM(total), 0)::text            AS revenue,
                 COALESCE(SUM("shippingCollected"), 0)::text AS shipping,
                 COALESCE(SUM(${freeShippingOrderSql}), 0)::bigint AS free_ship_orders
          FROM "Order"
          WHERE "orderDate" >= ${from} AND "orderDate" <= ${to}
            AND ("sourceChannel" IS DISTINCT FROM 'draft_orders')
        ),
        line_agg AS (
          SELECT COALESCE(SUM(COALESCE(l."estimatedLineProfit", l."lineRevenue" * ${margin})), 0)::text AS total_profit,
                 COALESCE(SUM(l."lineRevenue"), 0)::text   AS total_revenue,
                 COALESCE(SUM(l.quantity), 0)::bigint      AS total_items
          FROM "OrderLineItem" l
          JOIN "Order" o ON o.id = l."orderId"
          WHERE o."orderDate" >= ${from} AND o."orderDate" <= ${to}
            AND (o."sourceChannel" IS DISTINCT FROM 'draft_orders')
        )
        SELECT o.order_count, o.revenue, o.shipping, o.free_ship_orders,
               l.total_profit, l.total_revenue, l.total_items
        FROM order_agg o, line_agg l`,

      // Previous period: same structure
      db.$queryRaw<CombinedAgg[]>`
        WITH order_agg AS (
          SELECT COUNT(*)::bigint                          AS order_count,
                 COALESCE(SUM(total), 0)::text            AS revenue,
                 COALESCE(SUM("shippingCollected"), 0)::text AS shipping,
                 COALESCE(SUM(${freeShippingOrderSql}), 0)::bigint AS free_ship_orders
          FROM "Order"
          WHERE "orderDate" >= ${prevFrom} AND "orderDate" <= ${prevTo}
            AND ("sourceChannel" IS DISTINCT FROM 'draft_orders')
        ),
        line_agg AS (
          SELECT COALESCE(SUM(COALESCE(l."estimatedLineProfit", l."lineRevenue" * ${margin})), 0)::text AS total_profit,
                 COALESCE(SUM(l."lineRevenue"), 0)::text   AS total_revenue,
                 COALESCE(SUM(l.quantity), 0)::bigint      AS total_items
          FROM "OrderLineItem" l
          JOIN "Order" o ON o.id = l."orderId"
          WHERE o."orderDate" >= ${prevFrom} AND o."orderDate" <= ${prevTo}
            AND (o."sourceChannel" IS DISTINCT FROM 'draft_orders')
        )
        SELECT o.order_count, o.revenue, o.shipping, o.free_ship_orders,
               l.total_profit, l.total_revenue, l.total_items
        FROM order_agg o, line_agg l`,

      // Unfulfilled + fulfilled counts combined (no date filter — all-time queue)
      db.$queryRaw<FulfillAgg[]>`
        SELECT
          SUM(CASE WHEN "fulfillmentStatus" = ANY(ARRAY['UNFULFILLED','PARTIALLY_FULFILLED','PARTIAL','unfulfilled','partial'])
                   THEN 1 ELSE 0 END)::bigint AS unfulfilled,
          SUM(CASE WHEN "fulfillmentStatus" != ALL(ARRAY['UNFULFILLED','PARTIALLY_FULFILLED','PARTIAL','unfulfilled','partial'])
                   THEN 1 ELSE 0 END)::bigint AS fulfilled
        FROM "Order"
        WHERE ("sourceChannel" IS DISTINCT FROM 'draft_orders')`,
    ]);

    const c = curr[0];
    const p = prev[0];
    const f = fulfillRow[0];

    const orderCount    = Number(c.order_count);
    const revenue       = parseFloat(c.revenue);
    const shipping      = parseFloat(c.shipping);
    const lineProfit    = parseFloat(c.total_profit);
    const totalLineRev  = parseFloat(c.total_revenue);
    const itemCount     = Number(c.total_items);
    const freeShipCost  = freeShippingCostTotal(Number(c.free_ship_orders), freeShipEach);

    const prevOrderCount = Number(p.order_count);
    const prevRevenue    = parseFloat(p.revenue);
    const prevShipping   = parseFloat(p.shipping);
    const prevLineProfit = parseFloat(p.total_profit);
    const prevItemCount  = Number(p.total_items);
    const prevFreeShipCost = freeShippingCostTotal(Number(p.free_ship_orders), freeShipEach);

    const unfulfilled = Number(f.unfulfilled);
    const fulfilled   = Number(f.fulfilled);

    const rate     = blendedMarginRate(lineProfit, totalLineRev, margin);
    const avgMargin = Math.round(rate * 1000) / 10;
    const aov     = orderCount     ? (revenue     - shipping)     / orderCount     : 0;
    const prevAov = prevOrderCount ? (prevRevenue - prevShipping) / prevOrderCount : 0;

    const adSpend      = adSpendAmounts?.current ?? 0;
    const prevAdSpend  = adSpendAmounts?.prev    ?? 0;
    const grossProfit  = estimatedNetProfit(lineProfit, 0, freeShipCost);
    const netProfit    = estimatedNetProfit(lineProfit, adSpend, freeShipCost);
    const prevNetProfit = estimatedNetProfit(prevLineProfit, prevAdSpend, prevFreeShipCost);

    return {
      orderCount, itemCount, revenue,
      grossProfit,
      estProfit: netProfit,
      adSpend,
      shipping, aov,
      unfulfilledOrders: unfulfilled,
      fulfilledOrders: fulfilled,
      marginPercent: margin * 100,
      avgMargin,
      prior: {
        revenue: prevRevenue,
        estProfit: prevNetProfit,
        orderCount: prevOrderCount,
        itemCount: prevItemCount,
      },
      trends: {
        revenue:    calcTrend(revenue,     prevRevenue),
        estProfit:  calcTrend(netProfit,   prevNetProfit),
        orderCount: calcTrend(orderCount,  prevOrderCount),
        aov:        calcTrend(aov,         prevAov),
        itemCount:  calcTrend(itemCount,   prevItemCount),
        shipping:   calcTrend(shipping,    prevShipping),
      },
    };
  });
}

export type AlertSnapshot = { count: number; ids: string[] };

export async function getLowStockAlert(db: PrismaClient, threshold?: number): Promise<AlertSnapshot> {
  const def = threshold ?? (await getAppSettings())?.lowStockDefaultThreshold ?? 5;

  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (s."catalogItemId", s."locationId")
        s."catalogItemId", s.available
      FROM "InventorySnapshot" s
      JOIN "Location" loc ON loc.id = s."locationId"
      WHERE loc."isActive" = true
      ORDER BY s."catalogItemId", s."locationId", s."snapshotAt" DESC
    ),
    totals AS (
      SELECT "catalogItemId", SUM(available)::int AS available
      FROM latest
      GROUP BY "catalogItemId"
    )
    SELECT c.id
    FROM "CatalogItem" c
    JOIN totals t ON t."catalogItemId" = c.id
    WHERE c.type = 'product'
      AND c."trackInventory" = true
      AND c.status = 'active'
      AND c."skipLowStockAlert" = false
      AND t.available <= COALESCE(c."reorderThreshold", ${def})
  `;

  return { count: rows.length, ids: rows.map((r) => r.id) };
}

export async function countLowStockItems(db: PrismaClient, threshold?: number): Promise<number> {
  return (await getLowStockAlert(db, threshold)).count;
}

/** Unfulfilled orders whose Shopify Fulfill by date has passed. */
export async function getOverdueFulfillmentAlert(db: PrismaClient): Promise<AlertSnapshot> {
  const now = new Date();
  const rows = await db.order.findMany({
    where: {
      fulfillmentStatus: { in: ["UNFULFILLED", "PARTIALLY_FULFILLED", "PARTIAL", "unfulfilled", "partial"] },
      fulfillBy: { lt: now },
      OR: [{ sourceChannel: null }, { NOT: { sourceChannel: "draft_orders" } }],
    },
    select: { id: true },
  });
  return { count: rows.length, ids: rows.map((r) => r.id) };
}

export async function getRevenueByDay(from: Date, to: Date): Promise<DaySeries> {
  return safeQuery([], async (db) => {
    const rows = await db.$queryRaw<{ d: string; v: string }[]>`
    SELECT to_char("orderDate" at time zone 'America/New_York', 'YYYY-MM-DD') as d,
           SUM("total")::text as v
    FROM "Order"
    WHERE "orderDate" >= ${from} AND "orderDate" <= ${to}
      AND ("sourceChannel" IS DISTINCT FROM 'draft_orders')
    GROUP BY 1
    ORDER BY 1
  `;
    return rows.map((r) => ({ name: r.d, value: parseFloat(r.v) || 0 }));
  });
}

export async function getOrdersByDay(from: Date, to: Date): Promise<DaySeries> {
  return safeQuery([], async (db) => {
    const rows = await db.$queryRaw<{ d: string; c: bigint }[]>`
    SELECT to_char("orderDate" at time zone 'America/New_York', 'YYYY-MM-DD') as d,
           COUNT(*)::bigint as c
    FROM "Order"
    WHERE "orderDate" >= ${from} AND "orderDate" <= ${to}
      AND ("sourceChannel" IS DISTINCT FROM 'draft_orders')
    GROUP BY 1
    ORDER BY 1
  `;
    return rows.map((r) => ({ name: r.d, value: Number(r.c) }));
  });
}

export async function getItemsSoldByDay(from: Date, to: Date): Promise<DaySeries> {
  return safeQuery([], async (db) => {
    const rows = await db.$queryRaw<{ d: string; v: string }[]>`
    SELECT to_char(o."orderDate" at time zone 'America/New_York', 'YYYY-MM-DD') as d,
           COALESCE(SUM(l."quantity"),0)::text as v
    FROM "OrderLineItem" l
    JOIN "Order" o ON o.id = l."orderId"
    WHERE o."orderDate" >= ${from} AND o."orderDate" <= ${to}
      AND (o."sourceChannel" IS DISTINCT FROM 'draft_orders')
    GROUP BY 1
    ORDER BY 1
  `;
    return rows.map((r) => ({ name: r.d, value: parseFloat(r.v) || 0 }));
  });
}

export async function getProfitByDay(from: Date, to: Date): Promise<DaySeries> {
  return safeQuery([], async (db) => {
    // Use estimatedLineProfit so the chart source matches the KPI card calculation.
    // COALESCE per line item handles the rare null (falls back to 0 for that item).
    const rows = await db.$queryRaw<{ d: string; v: string }[]>`
    SELECT to_char(o."orderDate" at time zone 'America/New_York', 'YYYY-MM-DD') as d,
           COALESCE(SUM(COALESCE(l."estimatedLineProfit", 0)), 0)::text as v
    FROM "Order" o
    LEFT JOIN "OrderLineItem" l ON l."orderId" = o.id
    WHERE o."orderDate" >= ${from} AND o."orderDate" <= ${to}
      AND (o."sourceChannel" IS DISTINCT FROM 'draft_orders')
    GROUP BY 1
    ORDER BY 1
  `;
    return rows.map((r) => ({ name: r.d, value: parseFloat(r.v) || 0 }));
  });
}

export async function getShippingByDay(from: Date, to: Date): Promise<DaySeries> {
  return safeQuery([], async (db) => {
    const rows = await db.$queryRaw<{ d: string; v: string }[]>`
    SELECT to_char("orderDate" at time zone 'America/New_York', 'YYYY-MM-DD') as d,
           COALESCE(SUM("shippingCollected"),0)::text as v
    FROM "Order"
    WHERE "orderDate" >= ${from} AND "orderDate" <= ${to}
      AND ("sourceChannel" IS DISTINCT FROM 'draft_orders')
    GROUP BY 1
    ORDER BY 1
  `;
    return rows.map((r) => ({ name: r.d, value: parseFloat(r.v) || 0 }));
  });
}

export async function getTopProducts(
  from: Date,
  to: Date,
  by: "units" | "revenue" | "profit",
  marginPercent?: number
): Promise<TopRow[]> {
  return safeQuery([], async (db) => {
    // Caller (page) resolves margin from settings — no extra DB round-trip needed
    const margin = (marginPercent ?? 35) / 100;

    // Aggregate fully in PostgreSQL — no row fetching into Node memory.
    const orderCol =
      by === "units"
        ? Prisma.sql`SUM(l.quantity)`
        : by === "revenue"
          ? Prisma.sql`SUM(l."lineRevenue")`
          : Prisma.sql`SUM(COALESCE(l."estimatedLineProfit", l."lineRevenue" * ${margin}))`;

    const rows = await db.$queryRaw<{
      title: string;
      sku: string | null;
      units: bigint;
      revenue: string;
      profit: string;
    }[]>`
      SELECT
        -- Priority: 1) productGroup from linked catalog item (consolidates A/B listings)
        --           2) product title + variant title (standard individual display)
        COALESCE(
          MIN(c."productGroup"),
          CASE
            WHEN MIN(l."variantTitle") IS NOT NULL
              AND TRIM(MIN(l."variantTitle")) <> ''
              AND LOWER(TRIM(MIN(l."variantTitle"))) <> 'default title'
            THEN MIN(l.title) || ' — ' || MIN(l."variantTitle")
            ELSE MIN(l.title)
          END
        )                                                                               AS title,
        MIN(l.sku)                                                                      AS sku,
        SUM(l.quantity)::bigint                                                         AS units,
        SUM(l."lineRevenue")::text                                                      AS revenue,
        SUM(COALESCE(l."estimatedLineProfit", l."lineRevenue" * ${margin}))::text       AS profit
      FROM "OrderLineItem" l
      JOIN "Order" o ON o.id = l."orderId"
      LEFT JOIN "CatalogItem" c ON c.id = l."catalogItemId"
      WHERE o."orderDate" >= ${from} AND o."orderDate" <= ${to}
        AND (o."sourceChannel" IS DISTINCT FROM 'draft_orders')
      GROUP BY
        -- Group by productGroup when set, otherwise by title+variant combo
        COALESCE(
          c."productGroup",
          LOWER(TRIM(l.title)) || '||' || LOWER(TRIM(COALESCE(l."variantTitle", '')))
        )
      ORDER BY ${orderCol} DESC NULLS LAST
      LIMIT 12`;

    return rows.map((r) => ({
      title:   r.title,
      sku:     r.sku,
      units:   Number(r.units),
      revenue: parseFloat(r.revenue) || 0,
      profit:  parseFloat(r.profit)  || 0,
    }));
  });
}

export type ReturningCustomerStats = {
  totalCustomers: number;
  returningCustomers: number;
  returnRate: number; // percentage
};

export async function getReturningCustomers(from: Date, to: Date): Promise<ReturningCustomerStats> {
  return safeQuery({ totalCustomers: 0, returningCustomers: 0, returnRate: 0 }, async (db) => {
    // Single query: LEFT JOIN current-period unique customers against pre-period orders.
    const rows = await db.$queryRaw<{ total_customers: bigint; returning_customers: bigint }[]>`
      SELECT
        COUNT(DISTINCT rc.email)::bigint  AS total_customers,
        COUNT(DISTINCT ret.email)::bigint AS returning_customers
      FROM (
        SELECT DISTINCT LOWER("customerEmail") AS email
        FROM "Order"
        WHERE "orderDate" >= ${from} AND "orderDate" <= ${to}
          AND "customerEmail" IS NOT NULL AND "customerEmail" <> ''
          AND ("sourceChannel" IS DISTINCT FROM 'draft_orders')
      ) rc
      LEFT JOIN (
        SELECT DISTINCT LOWER("customerEmail") AS email
        FROM "Order"
        WHERE "orderDate" < ${from}
          AND "customerEmail" IS NOT NULL AND "customerEmail" <> ''
          AND ("sourceChannel" IS DISTINCT FROM 'draft_orders')
      ) ret ON ret.email = rc.email`;

    const totalCustomers    = Number(rows[0]?.total_customers    ?? 0);
    const returningCustomers = Number(rows[0]?.returning_customers ?? 0);
    const returnRate = totalCustomers > 0 ? Math.round((returningCustomers / totalCustomers) * 100) : 0;
    return { totalCustomers, returningCustomers, returnRate };
  });
}

// ---------------------------------------------------------------------------
// Consolidated chart-data query — 2 DB round-trips instead of the original 5.
// ---------------------------------------------------------------------------
export type ChartData = {
  revenue: DaySeries;
  orders:  DaySeries;
  shipping: DaySeries;
  items:   DaySeries;
  profit:  DaySeries;
};

export async function getChartData(
  from: Date,
  to: Date,
  marginPercent?: number,
  averageFreeShippingCost = DEFAULT_AVERAGE_FREE_SHIPPING_COST_USD,
): Promise<ChartData> {
  return safeQuery(
    { revenue: [], orders: [], shipping: [], items: [], profit: [] },
    async (db) => {
      const margin = (marginPercent ?? 35) / 100;
      const freeShipEach = Math.max(0, averageFreeShippingCost);
      const [orderRows, lineRows] = await Promise.all([
        // Prisma DateTime is UTC-naive timestamp: interpret as UTC, then NY date.
        db.$queryRaw<{ d: string; revenue: string; orders: bigint; shipping: string; free_ship_orders: bigint }[]>`
          SELECT to_char(("orderDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d,
                 SUM(total)::text                                        AS revenue,
                 COUNT(*)::bigint                                        AS orders,
                 COALESCE(SUM("shippingCollected"), 0)::text            AS shipping,
                 COALESCE(SUM(${freeShippingOrderSql}), 0)::bigint      AS free_ship_orders
          FROM   "Order"
          WHERE  "orderDate" >= ${from} AND "orderDate" <= ${to}
            AND  ("sourceChannel" IS DISTINCT FROM 'draft_orders')
          GROUP BY 1 ORDER BY 1`,
        db.$queryRaw<{ d: string; items: string; profit: string; line_rev: string }[]>`
          SELECT to_char((o."orderDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d,
                 COALESCE(SUM(l.quantity), 0)::text                       AS items,
                 COALESCE(SUM(COALESCE(l."estimatedLineProfit", l."lineRevenue" * ${margin})), 0)::text AS profit,
                 COALESCE(SUM(l."lineRevenue"), 0)::text                  AS line_rev
          FROM   "OrderLineItem" l
          JOIN   "Order" o ON o.id = l."orderId"
          WHERE  o."orderDate" >= ${from} AND o."orderDate" <= ${to}
            AND  (o."sourceChannel" IS DISTINCT FROM 'draft_orders')
          GROUP BY 1 ORDER BY 1`,
      ]);
      const revenue  = fillDaySeries(from, to, orderRows.map((r) => ({ name: r.d, value: parseFloat(r.revenue)  || 0 })));
      const shipping = fillDaySeries(from, to, orderRows.map((r) => ({ name: r.d, value: parseFloat(r.shipping) || 0 })));
      const productProfit = fillDaySeries(from, to, lineRows.map((r) => ({ name: r.d, value: parseFloat(r.profit) || 0 })));
      const freeShipCost = fillDaySeries(from, to, orderRows.map((r) => ({
        name: r.d,
        value: freeShippingCostTotal(Number(r.free_ship_orders), freeShipEach),
      })));
      const profit = productProfit.map((r, i) => ({
        name: r.name,
        value: estimatedNetProfit(r.value, 0, freeShipCost[i]?.value ?? 0),
      }));
      return {
        revenue,
        orders:   fillDaySeries(from, to, orderRows.map((r) => ({ name: r.d, value: Number(r.orders) }))),
        shipping,
        items:    fillDaySeries(from, to, lineRows.map((r)  => ({ name: r.d, value: parseFloat(r.items)    || 0 }))),
        profit,
      };
    }
  );
}

// ---------------------------------------------------------------------------
// All-three top-products rankings in a single SQL round-trip.
// ---------------------------------------------------------------------------
export type TopRow = { title: string; sku: string | null; units: number; revenue: number; profit: number };
export type TopProductsAll = { byUnits: TopRow[]; byRevenue: TopRow[]; byProfit: TopRow[] };

export async function getAllTopProducts(
  from: Date, to: Date, marginPercent?: number
): Promise<TopProductsAll> {
  return safeQuery({ byUnits: [], byRevenue: [], byProfit: [] }, async (db) => {
    const margin = (marginPercent ?? 35) / 100;
    const rows = await db.$queryRaw<{
      title: string; sku: string | null;
      units: bigint; revenue: string; profit: string;
      rank_units: bigint; rank_rev: bigint; rank_profit: bigint;
    }[]>`
      WITH agg AS (
        SELECT
          COALESCE(
            MIN(c."productGroup"),
            CASE
              WHEN MIN(l."variantTitle") IS NOT NULL
                AND TRIM(MIN(l."variantTitle")) <> ''
                AND LOWER(TRIM(MIN(l."variantTitle"))) <> 'default title'
              THEN MIN(l.title) || ' — ' || MIN(l."variantTitle")
              ELSE MIN(l.title)
            END
          )                                                                     AS title,
          MIN(l.sku)                                                            AS sku,
          SUM(l.quantity)::bigint                                               AS units,
          SUM(l."lineRevenue")::text                                            AS revenue,
          SUM(COALESCE(l."estimatedLineProfit", l."lineRevenue" * ${margin}))::text AS profit
        FROM "OrderLineItem" l
        JOIN "Order" o ON o.id = l."orderId"
        LEFT JOIN "CatalogItem" c ON c.id = l."catalogItemId"
        WHERE o."orderDate" >= ${from} AND o."orderDate" <= ${to}
          AND (o."sourceChannel" IS DISTINCT FROM 'draft_orders')
        GROUP BY COALESCE(
          c."productGroup",
          LOWER(TRIM(l.title)) || '||' || LOWER(TRIM(COALESCE(l."variantTitle", '')))
        )
      ),
      ranked AS (
        SELECT *,
          RANK() OVER (ORDER BY units           DESC NULLS LAST) AS rank_units,
          RANK() OVER (ORDER BY revenue::numeric DESC NULLS LAST) AS rank_rev,
          RANK() OVER (ORDER BY profit::numeric  DESC NULLS LAST) AS rank_profit
        FROM agg
      )
      SELECT * FROM ranked
      WHERE rank_units <= 12 OR rank_rev <= 12 OR rank_profit <= 12`;

    const mapped: TopRow[] = rows.map((r) => ({
      title:   r.title,
      sku:     r.sku,
      units:   Number(r.units),
      revenue: parseFloat(r.revenue) || 0,
      profit:  parseFloat(r.profit)  || 0,
    }));
    const byUnits   = [...mapped].sort((a, b) => b.units   - a.units).slice(0, 12);
    const byRevenue = [...mapped].sort((a, b) => b.revenue - a.revenue).slice(0, 12);
    const byProfit  = [...mapped].sort((a, b) => b.profit  - a.profit).slice(0, 12);
    return { byUnits, byRevenue, byProfit };
  });
}

// ---------------------------------------------------------------------------
// Cached dashboard data — expires after 60 s, invalidated by "dashboard" tag.
// Wraps all expensive order-aggregation queries so subsequent page loads within
// the TTL window require zero heavy DB work.
// ---------------------------------------------------------------------------
export type CachedDashboardData = {
  kpis:      DashboardKpis;
  tops:      TopProductsAll;
  returning: ReturningCustomerStats;
};

const _cachedDashboard = unstable_cache(
  async (
    fromMs:    number, toMs:     number,
    prevFromMs: number, prevToMs: number,
    margin: number,
    adSpendCurrent: number, adSpendPrev: number,
    _lastSyncMs: number,
    averageFreeShippingCost: number,
  ): Promise<CachedDashboardData> => {
    void _lastSyncMs;
    const from    = new Date(fromMs),    to    = new Date(toMs);
    const prevFrom = new Date(prevFromMs), prevTo = new Date(prevToMs);
    const [kpis, tops, returning] = await Promise.all([
      getDashboardKpis(from, to, margin, { prevFrom, prevTo }, { current: adSpendCurrent, prev: adSpendPrev }, averageFreeShippingCost),
      getAllTopProducts(from, to, margin),
      getReturningCustomers(from, to),
    ]);
    return { kpis, tops, returning };
  },
  ["dashboard-v4"],
  // Tag-invalidated on sync. lastSyncMs is also part of the cache key so a
  // router.refresh() after lastSuccessfulSyncAt changes never serves stale KPIs
  // even if revalidateTag is a no-op. 30s TTL is a fallback only.
  { revalidate: 30, tags: ["dashboard"] },
);

/** Public wrapper — converts Date args to numbers for the cache serializer. */
export function getCachedDashboardData(
  from: Date, to: Date,
  prevFrom: Date, prevTo: Date,
  margin: number,
  adSpendCurrent: number, adSpendPrev: number,
  lastSyncMs = 0,
  averageFreeShippingCost = DEFAULT_AVERAGE_FREE_SHIPPING_COST_USD,
): Promise<CachedDashboardData> {
  return _cachedDashboard(
    from.getTime(), to.getTime(),
    prevFrom.getTime(), prevTo.getTime(),
    margin, adSpendCurrent, adSpendPrev,
    lastSyncMs,
    averageFreeShippingCost,
  );
}

export async function getRecentOrders(take: number, from?: Date, to?: Date) {
  return safeQuery([], (db) =>
    db.order.findMany({
      where: {
        OR: [{ sourceChannel: null }, { NOT: { sourceChannel: 'draft_orders' } }],
        ...(from && to ? { orderDate: { gte: from, lte: to } } : {}),
      },
      orderBy: { orderDate: "desc" },
      take,
      select: {
        id: true,
        shopifyOrderId: true,
        orderName: true,
        customerName: true,
        total: true,
        orderDate: true,
        fulfillmentStatus: true,
      },
    })
  );
}

