import {
  CatalogStatus,
  CatalogType,
  PrismaClient,
  SyncRunStatus,
  SyncRunType,
} from "@prisma/client";
import { shopify } from "@/lib/shopify/client";
import { persistShopifyShopProfile } from "@/lib/shopify/shop-profile";
import { log } from "@/lib/logger";
import { toDecimal } from "@/lib/money";
import { revalidateAppData } from "@/lib/sync/revalidate";
import type { ShopifyLineItemNode, ShopifyOrderNode } from "@/lib/shopify/types";

function qtyMap(names: { name: string; quantity: number }[]) {
  const m: Record<string, number> = {};
  for (const n of names) m[n.name] = n.quantity;
  return m;
}

function pickMoney(
  o: ShopifyOrderNode,
  pick: (x: ShopifyOrderNode) => { shopMoney: { amount: string } } | null | undefined
) {
  const p = pick(o);
  if (!p?.shopMoney?.amount) return toDecimal(0);
  return toDecimal(p.shopMoney.amount);
}

function lineRevenue(line: ShopifyLineItemNode) {
  const p = line.originalUnitPriceSet?.shopMoney;
  if (!p) return toDecimal(0);
  return toDecimal(p.amount).mul(line.currentQuantity);
}

function earliestFulfillBy(o: ShopifyOrderNode): Date | null {
  let min: number | null = null;
  for (const fo of o.fulfillmentOrders?.nodes ?? []) {
    if (!fo.fulfillBy) continue;
    const status = (fo.status ?? "").toUpperCase();
    if (status === "CLOSED" || status === "CANCELLED") continue;
    const t = new Date(fo.fulfillBy).getTime();
    if (Number.isNaN(t)) continue;
    if (min == null || t < min) min = t;
  }
  return min != null ? new Date(min) : null;
}

async function getOrCreateSettings(db: PrismaClient) {
  const found = await db.appSetting.findFirst();
  if (found) return found;
  return db.appSetting.create({ data: {} });
}

export type SyncResult = { recordsProcessed: number; errorMessage?: string };

export type SyncOptions = {
  /** When true, re-fetch ~90 days of orders + all products and archive missing variants. */
  full?: boolean;
  /** Start even if a successful incremental just finished. */
  force?: boolean;
};

export type BeginSyncResult = {
  run: { id: string; status: SyncRunStatus; recordsProcessed: number };
  shouldExecute: boolean;
  reused: boolean;
  skipped: boolean;
};

const MIN_INCREMENTAL_GAP_MS = 90_000;
const STALE_RUNNING_MS = 300_000;

type ProgressPhase = "locations" | "products" | "inventory" | "orders" | "finishing";

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 2 * 60 * 60 * 1000; // 2h overlap so boundary updates aren't missed
const BOOTSTRAP_ORDER_DAYS = 90;

/** How far back to pull. Incremental uses lastSuccessfulSyncAt; full/bootstrap uses 90 days. */
function resolveSince(lastSuccessfulSyncAt: Date | null | undefined, full: boolean): Date {
  if (full || !lastSuccessfulSyncAt) {
    return new Date(Date.now() - BOOTSTRAP_ORDER_DAYS * DAY_MS);
  }
  return new Date(lastSuccessfulSyncAt.getTime() - OVERLAP_MS);
}

async function setProgress(
  db: PrismaClient,
  runId: string,
  phase: ProgressPhase,
  current: number,
  total: number | null,
  recordsProcessed?: number,
) {
  try {
    await db.syncRun.update({
      where: { id: runId },
      data: {
        progressPhase: phase,
        progressCurrent: current,
        progressTotal: total,
        ...(recordsProcessed != null ? { recordsProcessed } : {}),
      },
    });
  } catch (e) {
    // Never let progress bookkeeping kill the sync itself.
    log.warn("setProgress failed", {
      phase,
      message: e instanceof Error ? e.message.slice(0, 120) : String(e),
    });
  }
}

/** Mark any other "running" rows failed so a new sync is not shadowed by a zombie. */
async function abandonStaleRuns(db: PrismaClient) {
  try {
    const stale = await db.syncRun.updateMany({
      where: { status: SyncRunStatus.running },
      data: {
        status: SyncRunStatus.failed,
        completedAt: new Date(),
        errorMessage: "Abandoned: superseded by a new sync or left incomplete",
      },
    });
    if (stale.count > 0) {
      log.warn("Abandoned incomplete sync runs", { count: stale.count });
    }
  } catch (e) {
    log.warn("abandonStaleRuns failed", {
      message: e instanceof Error ? e.message.slice(0, 100) : String(e),
    });
  }
}

/** Reuse an in-flight run, skip a fresh incremental if we just synced, or start a new run. */
export async function beginSyncRun(db: PrismaClient, opts: SyncOptions = {}): Promise<BeginSyncResult> {
  const full = opts.full === true;
  const force = opts.force === true;

  const running = await db.syncRun.findFirst({
    where: { status: SyncRunStatus.running },
    orderBy: { startedAt: "desc" },
  });
  if (running && !full) {
    const age = Date.now() - running.startedAt.getTime();
    if (age <= STALE_RUNNING_MS) {
      return { run: running, shouldExecute: false, reused: true, skipped: false };
    }
  }

  if (!full && !force) {
    const lastOk = await db.syncRun.findFirst({
      where: { status: SyncRunStatus.success },
      orderBy: { completedAt: "desc" },
    });
    if (lastOk?.completedAt && Date.now() - lastOk.completedAt.getTime() < MIN_INCREMENTAL_GAP_MS) {
      return { run: lastOk, shouldExecute: false, reused: false, skipped: true };
    }
  }

  await abandonStaleRuns(db);
  const run = await db.syncRun.create({
    data: {
      type: full ? SyncRunType.full : SyncRunType.incremental,
      status: SyncRunStatus.running,
      progressPhase: "locations",
    },
  });
  return { run, shouldExecute: true, reused: false, skipped: false };
}

/** Execute an already-created SyncRun (used after POST returns the id to the client). */
export async function executeSyncRun(
  db: PrismaClient,
  runId: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const full = opts.full === true;
  if (!(await shopify.isReady())) {
    const errorMessage = "Shopify not configured";
    await db.syncRun.update({
      where: { id: runId },
      data: { status: SyncRunStatus.failed, completedAt: new Date(), errorMessage },
    });
    return { recordsProcessed: 0, errorMessage };
  }
  let count = 0;
  try {
    const settings = await getOrCreateSettings(db);
    if (!settings.shopifyShopName) {
      await persistShopifyShopProfile(db);
    }
    count += await syncLocations(db, runId);
    count += await syncProducts(db, runId, full);
    if (!full) {
      count += await syncInventoryLevels(db, runId);
    }
    count += await syncOrders(db, runId, full);
    await setProgress(db, runId, "finishing", 1, 1, count);
    const s = await getOrCreateSettings(db);
    await db.appSetting.update({
      where: { id: s.id },
      data: { lastSuccessfulSyncAt: new Date() },
    });
    await db.syncRun.update({
      where: { id: runId },
      data: {
        status: SyncRunStatus.success,
        completedAt: new Date(),
        recordsProcessed: count,
        progressPhase: "finishing",
        progressCurrent: 1,
        progressTotal: 1,
      },
    });
    // Best-effort — may no-op when called from after() without request context.
    // Clients also call PUT /api/sync on success to revalidate in request context.
    try {
      revalidateAppData();
    } catch (e) {
      log.warn("revalidateAppData after sync failed", {
        message: e instanceof Error ? e.message.slice(0, 100) : String(e),
      });
    }
    return { recordsProcessed: count };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("Sync failed", { message: msg, full });
    await db.syncRun.update({
      where: { id: runId },
      data: {
        status: SyncRunStatus.failed,
        completedAt: new Date(),
        recordsProcessed: count,
        errorMessage: msg,
      },
    });
    return { recordsProcessed: count, errorMessage: msg };
  }
}

/** Default path: incremental sync since last success. Pass `{ full: true }` for a deep rebuild. */
export async function runSync(db: PrismaClient, opts: SyncOptions = {}): Promise<SyncResult> {
  if (!(await shopify.isReady())) {
    return { recordsProcessed: 0, errorMessage: "Shopify not configured" };
  }
  const began = await beginSyncRun(db, opts);
  if (!began.shouldExecute) {
    return { recordsProcessed: began.run.recordsProcessed ?? 0 };
  }
  return executeSyncRun(db, began.run.id, opts);
}

/** @deprecated Prefer runSync(). Kept for callers that want an explicit full rebuild. */
export async function runFullSync(db: PrismaClient): Promise<SyncResult> {
  return runSync(db, { full: true });
}

async function syncLocations(db: PrismaClient, runId: string): Promise<number> {
  const locs = await shopify.fetchAllLocations();
  await setProgress(db, runId, "locations", 0, locs.length);
  let n = 0;
  for (const l of locs) {
    await db.location.upsert({
      where: { shopifyLocationId: l.id },
      create: { shopifyLocationId: l.id, name: l.name, isActive: l.isActive },
      update: { name: l.name, isActive: l.isActive },
    });
    n++;
    await setProgress(db, runId, "locations", n, locs.length, n);
  }
  return n;
}

async function writeSnapshots(
  db: PrismaClient,
  catalogItemId: string,
  levels: {
    location: { id: string; name: string; isActive: boolean };
    quantities: { name: string; quantity: number }[];
  }[],
  fallbackQty?: number | null,
) {
  if (levels.length) {
    for (const lvl of levels) {
      const loc = await db.location.upsert({
        where: { shopifyLocationId: lvl.location.id },
        create: {
          shopifyLocationId: lvl.location.id,
          name: lvl.location.name,
          isActive: lvl.location.isActive,
        },
        update: { name: lvl.location.name, isActive: lvl.location.isActive },
      });
      const q = qtyMap(lvl.quantities);
      const snap = await db.inventorySnapshot.create({
        data: {
          catalogItemId,
          locationId: loc.id,
          available: q["available"] ?? 0,
          onHand: q["on_hand"] ?? 0,
          committed: q["committed"] ?? 0,
          incoming: q["incoming"] ?? 0,
          reserved: q["reserved"] ?? 0,
          snapshotAt: new Date(),
        },
      });
      await db.inventorySnapshot.deleteMany({
        where: {
          catalogItemId,
          locationId: loc.id,
          id: { not: snap.id },
        },
      });
    }
    return;
  }
  const anyLoc = await db.location.findFirst();
  if (anyLoc && fallbackQty != null) {
    const snap = await db.inventorySnapshot.create({
      data: {
        catalogItemId,
        locationId: anyLoc.id,
        available: fallbackQty,
        onHand: fallbackQty,
        committed: 0,
        incoming: 0,
        reserved: 0,
        snapshotAt: new Date(),
      },
    });
    await db.inventorySnapshot.deleteMany({
      where: {
        catalogItemId,
        locationId: anyLoc.id,
        id: { not: snap.id },
      },
    });
  }
}

async function syncProducts(db: PrismaClient, runId: string, full: boolean): Promise<number> {
  let n = 0;
  let productsDone = 0;

  const settings = await getOrCreateSettings(db);
  const since = resolveSince(settings.lastSuccessfulSyncAt, full);
  const filter = full ? undefined : `updated_at:>='${since.toISOString()}'`;
  log.info(full ? "Syncing products (full catalog)" : `Syncing products updated since ${since.toISOString()}`);

  const totalProducts = await shopify.countProducts(filter);
  await setProgress(db, runId, "products", 0, totalProducts);

  for await (const page of shopify.paginateProducts(filter)) {
    for (const p of page.nodes) {
      const vnodes = p.variants.nodes as {
        id: string;
        title: string;
        sku: string | null;
        barcode: string | null;
        price: string;
        image?: { url: string } | null;
        inventoryItem: {
          id: string;
          tracked: boolean;
          inventoryLevels?: {
            nodes: {
              id: string;
              location: { id: string; name: string; isActive: boolean };
              quantities: { name: string; quantity: number }[];
            }[];
          } | null;
        } | null;
        inventoryQuantity?: number;
      }[];
      for (const v of vnodes) {
        const item = await db.catalogItem.upsert({
          where: { shopifyVariantId: v.id },
          create: {
            type: CatalogType.product,
            status: p.status === "ARCHIVED" ? CatalogStatus.archived : CatalogStatus.active,
            title: `${p.title}${v.title !== "Default Title" ? " — " + v.title : ""}`,
            sku: v.sku,
            barcode: v.barcode,
            vendor: p.vendor,
            imageUrl: v.image?.url ?? p.featuredImage?.url,
            thumbnailUrl: v.image?.url ?? p.featuredImage?.url,
            trackInventory: v.inventoryItem?.tracked ?? true,
            shopifyProductId: p.id,
            shopifyVariantId: v.id,
            shopifyInventoryItemId: v.inventoryItem?.id ?? null,
            sellingPrice: toDecimal(v.price),
          },
          update: {
            title: `${p.title}${v.title !== "Default Title" ? " — " + v.title : ""}`,
            sku: v.sku,
            barcode: v.barcode,
            vendor: p.vendor,
            imageUrl: v.image?.url ?? p.featuredImage?.url,
            thumbnailUrl: v.image?.url ?? p.featuredImage?.url,
            trackInventory: v.inventoryItem?.tracked ?? true,
            shopifyProductId: p.id,
            shopifyInventoryItemId: v.inventoryItem?.id ?? null,
            sellingPrice: toDecimal(v.price),
            status: p.status === "ARCHIVED" ? CatalogStatus.archived : CatalogStatus.active,
          },
        });
        n++;
        if (full) {
          await writeSnapshots(
            db,
            item.id,
            v.inventoryItem?.inventoryLevels?.nodes ?? [],
            v.inventoryQuantity,
          );
        }
      }
      productsDone++;
    }
    const total = totalProducts != null ? Math.max(totalProducts, productsDone) : null;
    await setProgress(db, runId, "products", productsDone, total, n);
  }

  await pruneRemovedShopifyVariants(db);
  return n;
}

async function updateStatusByIds(db: PrismaClient, ids: string[], status: CatalogStatus) {
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    await db.catalogItem.updateMany({
      where: { id: { in: ids.slice(i, i + chunk) } },
      data: { status },
    });
  }
}

/**
 * Drop catalog rows for variants Shopify deleted (or archived the product).
 * Runs on every catch-up — deleted products never appear in the updated_at product page.
 */
async function pruneRemovedShopifyVariants(db: PrismaClient) {
  let census: { liveIds: Set<string>; archivedIds: Set<string> };
  try {
    census = await shopify.fetchVariantCensus();
  } catch (e) {
    log.warn("Skipping catalog prune; variant census failed", {
      message: e instanceof Error ? e.message.slice(0, 160) : String(e),
    });
    return;
  }

  const productCount = await shopify.countProducts();
  if (census.liveIds.size === 0 && (productCount ?? 0) > 0) {
    log.warn("Skipping catalog prune; census was empty but Shopify still has products", { productCount });
    return;
  }

  const local = await db.catalogItem.findMany({
    where: { type: CatalogType.product, shopifyVariantId: { not: null } },
    select: { id: true, shopifyVariantId: true, status: true },
  });

  const toArchive: string[] = [];
  const toRestore: string[] = [];
  for (const row of local) {
    const vid = row.shopifyVariantId!;
    const gone = !census.liveIds.has(vid) || census.archivedIds.has(vid);
    if (gone && row.status === CatalogStatus.active) toArchive.push(row.id);
    if (!gone && row.status === CatalogStatus.archived) toRestore.push(row.id);
  }

  if (toArchive.length) {
    await updateStatusByIds(db, toArchive, CatalogStatus.archived);
    log.info(`Archived ${toArchive.length} catalog item(s) removed or archived in Shopify`);
  }
  if (toRestore.length) {
    await updateStatusByIds(db, toRestore, CatalogStatus.active);
    log.info(`Restored ${toRestore.length} catalog item(s) active again in Shopify`);
  }
}

async function syncInventoryLevels(db: PrismaClient, runId: string): Promise<number> {
  const settings = await getOrCreateSettings(db);
  const since = resolveSince(settings.lastSuccessfulSyncAt, false);
  const filter = `updated_at:>='${since.toISOString()}'`;
  log.info(`Syncing inventory items updated since ${since.toISOString()}`);
  await setProgress(db, runId, "inventory", 0, null);

  const catalog = await db.catalogItem.findMany({
    where: { shopifyInventoryItemId: { not: null } },
    select: { id: true, shopifyInventoryItemId: true },
  });
  const byInvId = new Map(
    catalog.filter((c) => c.shopifyInventoryItemId).map((c) => [c.shopifyInventoryItemId!, c.id]),
  );

  let n = 0;
  let itemsDone = 0;
  for await (const page of shopify.paginateInventoryItems(filter)) {
    for (const item of page.nodes) {
      itemsDone++;
      const catalogItemId = byInvId.get(item.id);
      if (!catalogItemId) continue;
      await writeSnapshots(db, catalogItemId, item.inventoryLevels?.nodes ?? []);
      n++;
    }
    await setProgress(db, runId, "inventory", itemsDone, null, n);
  }
  return n;
}

async function syncOrders(db: PrismaClient, runId: string, full: boolean): Promise<number> {
  await setProgress(db, runId, "orders", 0, null);

  const settings = await getOrCreateSettings(db);
  const defaultMargin = (settings.defaultMarginPercent ?? 35) / 100;
  const since = resolveSince(settings.lastSuccessfulSyncAt, full);
  const filter = full
    ? `updated_at:>='${since.toISOString()}'`
    : `(updated_at:>='${since.toISOString()}' OR fulfillment_status:unfulfilled OR fulfillment_status:partial)`;
  log.info(`Syncing orders updated since ${since.toISOString()} (full=${full})`);

  const totalOrders = await shopify.countOrders(filter);
  await setProgress(db, runId, "orders", 0, totalOrders);

  const allCatalog = await db.catalogItem.findMany({
    where: { type: CatalogType.product },
    select: { id: true, shopifyVariantId: true, sku: true, marginPercentOverride: true },
  });
  const byVariantId = new Map(allCatalog.filter((c) => c.shopifyVariantId).map((c) => [c.shopifyVariantId!, c]));
  const bySku = new Map(allCatalog.filter((c) => c.sku).map((c) => [c.sku!, c]));

  let n = 0;
  for await (const page of shopify.paginateOrders(filter)) {
    for (const o of page.nodes) {
      try {
        const subtotal = pickMoney(o, (x) => x.subtotalPriceSet ?? x.currentTotalPriceSet);
        const ship = pickMoney(o, (x) => x.totalShippingPriceSet);
        const tax = pickMoney(o, (x) => x.totalTaxSet);
        const disc = pickMoney(o, (x) => x.totalDiscountsSet);
        const total = pickMoney(o, (x) => x.currentTotalPriceSet);
        const channelHandle = o.channelInformation?.channelDefinition?.handle ?? null;
        const isDraft =
          channelHandle === "draft_orders" ||
          o.sourceName === "draft_orders" ||
          o.sourceIdentifier === "draft_orders";
        const sourceChannel = isDraft
          ? "draft_orders"
          : (channelHandle ?? o.sourceName ?? o.sourceIdentifier ?? null);

        const fulfillBy = earliestFulfillBy(o);

        const order = await db.order.upsert({
          where: { shopifyOrderId: o.id },
          create: {
            shopifyOrderId: o.id,
            orderNumber: o.number,
            orderName: o.name,
            customerName: o.shippingAddress?.name ?? null,
            customerEmail: o.email,
            financialStatus: o.displayFinancialStatus,
            fulfillmentStatus: o.displayFulfillmentStatus,
            currency: o.currentTotalPriceSet.shopMoney.currencyCode,
            subtotal,
            shippingCollected: ship,
            tax,
            discountTotal: disc,
            total,
            estimatedProfit: toDecimal(0),
            profitIsEstimated: true,
            orderDate: new Date(o.createdAt),
            fulfillBy,
            sourceChannel,
            rawPayloadJson: JSON.stringify({ id: o.id, name: o.name }),
          },
          update: {
            orderName: o.name,
            customerName: o.shippingAddress?.name ?? null,
            customerEmail: o.email,
            financialStatus: o.displayFinancialStatus,
            fulfillmentStatus: o.displayFulfillmentStatus,
            subtotal,
            shippingCollected: ship,
            tax,
            discountTotal: disc,
            total,
            orderDate: new Date(o.createdAt),
            fulfillBy,
            sourceChannel,
          },
        });
        n++;
        let orderProfit = toDecimal(0);
        for (const li of o.lineItems.nodes) {
          const rev = lineRevenue(li);
          const match =
            (li.variant?.id ? byVariantId.get(li.variant.id) : null) ??
            (li.sku ? bySku.get(li.sku) : null) ??
            null;
          const q = li.currentQuantity || 1;
          const unitPrice = li.originalUnitPriceSet?.shopMoney
            ? toDecimal(li.originalUnitPriceSet.shopMoney.amount)
            : rev.div(q);
          const m =
            match?.marginPercentOverride != null
              ? match.marginPercentOverride / 100
              : defaultMargin;
          const estUnit = unitPrice.mul(1 - m);
          const lineProfit = rev.minus(estUnit.mul(q));
          orderProfit = orderProfit.add(lineProfit);
          await db.orderLineItem.upsert({
            where: { shopifyLineItemId: li.id },
            create: {
              orderId: order.id,
              shopifyLineItemId: li.id,
              title: li.title,
              variantTitle: li.variantTitle || null,
              sku: li.sku,
              quantity: li.currentQuantity,
              unitPrice: li.originalUnitPriceSet?.shopMoney
                ? toDecimal(li.originalUnitPriceSet.shopMoney.amount)
                : toDecimal(0),
              lineRevenue: rev,
              estimatedUnitCost: estUnit,
              estimatedLineProfit: lineProfit,
              profitIsExact: false,
              fulfillmentStatus: li.fulfillmentStatus,
              catalogItemId: match?.id ?? null,
            },
            update: {
              title: li.title,
              variantTitle: li.variantTitle || null,
              sku: li.sku,
              quantity: li.currentQuantity,
              unitPrice: li.originalUnitPriceSet?.shopMoney
                ? toDecimal(li.originalUnitPriceSet.shopMoney.amount)
                : toDecimal(0),
              lineRevenue: rev,
              estimatedUnitCost: estUnit,
              estimatedLineProfit: lineProfit,
              profitIsExact: false,
              fulfillmentStatus: li.fulfillmentStatus,
              catalogItemId: match?.id ?? null,
            },
          });
        }
        await db.order.update({
          where: { id: order.id },
          data: { estimatedProfit: orderProfit, profitIsEstimated: true },
        });

        // Heartbeat every 5 orders so the UI doesn't look frozen mid-page
        if (n % 5 === 0) {
          const tot = totalOrders != null ? Math.max(totalOrders, n) : null;
          await setProgress(db, runId, "orders", n, tot, n);
        }
      } catch (e) {
        log.warn("Order sync skipped one order", {
          order: o.name ?? o.id,
          message: e instanceof Error ? e.message.slice(0, 150) : String(e),
        });
      }
    }
    const tot = totalOrders != null ? Math.max(totalOrders, n) : null;
    await setProgress(db, runId, "orders", n, tot, n);
  }
  return n;
}
