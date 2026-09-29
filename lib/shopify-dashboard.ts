import { DashboardRange, DashboardSection, ShopifyData, ShopifyRangeStats } from './dashboard-types';
import { getComparisonDates, rangeToDates } from './dates';
import { tryPrisma } from './db';
import { getAdSpendForRange } from './queries/ad-budget';
import {
  countLowStockItems,
  getAllTopProducts,
  getDashboardKpis,
  getOverdueFulfillmentAlert,
  getRecentOrders,
  getRevenueByDay,
} from './queries/dashboard';
import { getAppSettings } from './queries/app-settings';
import { shopifyAdminUrl } from './shopify/admin-url';
import { isShopifyApiReady } from './shopify/config';

const OPEN_FULFILLMENT = ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'PARTIAL', 'unfulfilled', 'partial'];

const emptyRange = (): ShopifyRangeStats => ({
  revenue: 0,
  net: 0,
  adSpend: 0,
  orders: 0,
  units: 0,
  aov: 0,
  shipping: 0,
  daily: [],
});

function emptyShopify(shop: string | null = null): ShopifyData {
  return {
    state: 'not_configured',
    shop,
    lastSync: null,
    ranges: { '7': emptyRange(), '30': emptyRange(), '90': emptyRange() },
    unfulfilled: 0,
    overdue: 0,
    lowStock: 0,
    products: { '7': [], '30': [], '90': [] },
    recent: [],
  };
}

async function rangeStats(days: DashboardRange, margin: number, freeShip: number): Promise<ShopifyRangeStats> {
  const key = `${days}d` as const;
  const { from, to } = rangeToDates(key);
  const comparison = getComparisonDates(key, from, to);
  const [currentAds, prevAds, daily] = await Promise.all([
    getAdSpendForRange(from, to),
    getAdSpendForRange(comparison.prevFrom, comparison.prevTo),
    getRevenueByDay(from, to),
  ]);
  const kpis = await getDashboardKpis(
    from,
    to,
    margin,
    comparison,
    { current: currentAds, prev: prevAds },
    freeShip
  );
  return {
    revenue: kpis.revenue,
    net: kpis.estProfit,
    adSpend: currentAds || kpis.adSpend,
    orders: kpis.orderCount,
    units: kpis.itemCount,
    aov: kpis.aov,
    shipping: kpis.shipping,
    daily: daily.map((point) => point.value),
  };
}

export async function getShopifyDashboard(): Promise<DashboardSection<ShopifyData>> {
  try {
    const [ready, settings] = await Promise.all([isShopifyApiReady(), getAppSettings()]);
    const shop = settings?.shopifyShopName || settings?.shopifyShopDomain || null;
    const orderCount = await tryPrisma((db) => db.order.count());

    if (!ready && !orderCount) {
      return { status: 'ok', data: emptyShopify(shop) };
    }

    const margin = settings?.defaultMarginPercent ?? 35;
    const freeShip = settings?.averageFreeShippingCost ?? 15;

    const window7 = rangeToDates('7d');
    const window30 = rangeToDates('30d');
    const window90 = rangeToDates('90d');
    const [seven, thirty, ninety, products7, products30, products90, recent, ops] = await Promise.all([
      rangeStats(7, margin, freeShip),
      rangeStats(30, margin, freeShip),
      rangeStats(90, margin, freeShip),
      getAllTopProducts(window7.from, window7.to, margin),
      getAllTopProducts(window30.from, window30.to, margin),
      getAllTopProducts(window90.from, window90.to, margin),
      getRecentOrders(8),
      tryPrisma(async (db) => {
        const [lowStock, overdue, unfulfilled] = await Promise.all([
          countLowStockItems(db, settings?.lowStockDefaultThreshold),
          getOverdueFulfillmentAlert(db),
          db.order.count({
            where: {
              fulfillmentStatus: { in: OPEN_FULFILLMENT },
              OR: [{ sourceChannel: null }, { NOT: { sourceChannel: 'draft_orders' } }],
            },
          }),
        ]);
        return { lowStock, overdue: overdue.count, unfulfilled };
      }),
    ]);

    const toProducts = (tops: Awaited<ReturnType<typeof getAllTopProducts>>) =>
      tops.byUnits.slice(0, 10).map((row) => ({ name: row.title, units: row.units, revenue: row.revenue }));

    return {
      status: 'ok',
      data: {
        state: ready || (orderCount ?? 0) > 0 ? 'ok' : 'not_configured',
        shop,
        lastSync: settings?.lastSuccessfulSyncAt?.toISOString() ?? null,
        ranges: { '7': seven, '30': thirty, '90': ninety },
        unfulfilled: ops?.unfulfilled ?? 0,
        overdue: ops?.overdue ?? 0,
        lowStock: ops?.lowStock ?? 0,
        products: { '7': toProducts(products7), '30': toProducts(products30), '90': toProducts(products90) },
        recent: recent.map((order) => ({
          id: order.id,
          name: order.orderName || 'Shopify order',
          customer: order.customerName,
          total: Number(order.total),
          soldAt: order.orderDate.toISOString(),
          href: shopifyAdminUrl(settings?.shopifyShopDomain, 'orders', order.shopifyOrderId),
        })),
      },
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error && error.message ? error.message : 'Could not load Shopify data',
    };
  }
}
