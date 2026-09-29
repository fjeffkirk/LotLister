import { PrismaClient } from "@prisma/client";
import { getAppSettings } from "@/lib/queries/app-settings";
import { toNumber } from "@/lib/money";
import { shopifyAdminUrl } from "@/lib/shopify/admin-url";

export type LowStockRow = {
  id: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  available: number;
  threshold: number;
  shopifyProductId: string | null;
  skipLowStockAlert: boolean;
  costBasis: number | null;
  reorderQuantity: number | null;
};

export async function listLowStockItems(db: PrismaClient): Promise<LowStockRow[]> {
  const def = (await getAppSettings())?.lowStockDefaultThreshold ?? 5;
  const rows = await db.$queryRaw<{
    id: string;
    title: string;
    sku: string | null;
    imageUrl: string | null;
    available: number;
    threshold: number;
    shopifyProductId: string | null;
    skipLowStockAlert: boolean;
    costBasis: string | null;
    reorderQuantity: number | null;
  }[]>`
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
    SELECT
      c.id,
      c.title,
      c.sku,
      c."imageUrl",
      t.available,
      COALESCE(c."reorderThreshold", ${def}) AS threshold,
      c."shopifyProductId",
      c."skipLowStockAlert",
      c."costBasis"::text,
      c."reorderQuantity"
    FROM "CatalogItem" c
    JOIN totals t ON t."catalogItemId" = c.id
    WHERE c.type = 'product'
      AND c."trackInventory" = true
      AND c.status = 'active'
      AND c."skipLowStockAlert" = false
      AND t.available <= COALESCE(c."reorderThreshold", ${def})
    ORDER BY t.available ASC, c.title ASC
  `;
  return rows.map((r) => ({
    ...r,
    costBasis: r.costBasis != null ? parseFloat(r.costBasis) : null,
  }));
}

export type OpenOrderRow = {
  id: string;
  shopifyOrderId: string;
  orderName: string | null;
  customerName: string | null;
  total: number;
  orderDate: Date;
  fulfillBy: Date | null;
  fulfillmentStatus: string | null;
  overdue: boolean;
};

const OPEN_FULFILLMENT = ["UNFULFILLED", "PARTIALLY_FULFILLED", "PARTIAL", "unfulfilled", "partial"];

export async function listOpenFulfillment(db: PrismaClient): Promise<OpenOrderRow[]> {
  const now = Date.now();
  const rows = await db.order.findMany({
    where: {
      fulfillmentStatus: { in: OPEN_FULFILLMENT },
      OR: [{ sourceChannel: null }, { NOT: { sourceChannel: "draft_orders" } }],
    },
    orderBy: { orderDate: "asc" },
    select: {
      id: true,
      shopifyOrderId: true,
      orderName: true,
      customerName: true,
      total: true,
      orderDate: true,
      fulfillBy: true,
      fulfillmentStatus: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    total: toNumber(r.total),
    overdue: r.fulfillBy != null && r.fulfillBy.getTime() < now,
  }));
}

export type SearchHit = {
  kind: "order" | "product";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export async function searchOps(db: PrismaClient, q: string, shop: string | null): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const [orders, products] = await Promise.all([
    db.order.findMany({
      where: {
        OR: [
          { orderName: { contains: term, mode: "insensitive" } },
          { customerName: { contains: term, mode: "insensitive" } },
          { customerEmail: { contains: term, mode: "insensitive" } },
        ],
      },
      take: 8,
      orderBy: { orderDate: "desc" },
      select: { shopifyOrderId: true, orderName: true, customerName: true, total: true },
    }),
    db.catalogItem.findMany({
      where: {
        status: "active",
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { sku: { contains: term, mode: "insensitive" } },
        ],
      },
      take: 8,
      orderBy: { title: "asc" },
      select: { id: true, title: true, sku: true, shopifyProductId: true },
    }),
  ]);

  const hits: SearchHit[] = [];
  for (const o of orders) {
    const href = shopifyAdminUrl(shop, "orders", o.shopifyOrderId) ?? "/ops/orders";
    hits.push({
      kind: "order",
      id: o.shopifyOrderId,
      title: o.orderName || "Order",
      subtitle: o.customerName || "Guest",
      href,
    });
  }
  for (const p of products) {
    const href = shopifyAdminUrl(shop, "products", p.shopifyProductId) ?? "/ops/inventory";
    hits.push({
      kind: "product",
      id: p.id,
      title: p.title,
      subtitle: p.sku || "No SKU",
      href,
    });
  }
  return hits;
}
