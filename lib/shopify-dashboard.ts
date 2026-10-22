import { DashboardSection, ShopifyData, ShopifyRangeStats } from './dashboard-types';
import { DateRangeKey, getComparisonDates, rangeToDates } from './dates';
import { tryPrisma } from './db';
import { toNumber } from './money';
import { getAdSpendForRange, getEffectiveDailyBudget, getRecentAdBudgets } from './queries/ad-budget';
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

const flatChange = { pct: 0, direction: 'flat' as const };

const emptyRange = (): ShopifyRangeStats => ({
  revenue: 0,
  net: 0,
  adSpend: 0,
  orders: 0,
  units: 0,
  aov: 0,
  shipping: 0,
  itemCost: 0,
  postage: 0,
  daily: [],
  change: { revenue: flatChange, net: flatChange, orders: flatChange, units: flatChange },
});

function emptyShopify(shop: string | null = null): ShopifyData {
  return {
    state: 'not_configured',
    shop,
    lastSync: null,
    ranges: { '7': emptyRange(), '30': emptyRange(), '90': emptyRange() },
    focus: emptyRange(),
    dailyBudget: null,
    adEntries: [],
    unfulfilled: 0,
    overdue: 0,
    lowStock: 0,
    products: { '7': [], '30': [], '90': [] },
    focusProducts: [],
    recent: [],
  };
}

async function statsFor(
  from: Date,
  to: Date,
  key: DateRangeKey | null,
  margin: number,
  freeShip: number
): Promise<ShopifyRangeStats> {
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
    itemCost: kpis.itemCost,
    postage: kpis.postage,
    daily: daily.map((point) => point.value),
    prior: {
      revenue: kpis.prior.revenue,
      net: kpis.prior.estProfit,
      orders: kpis.prior.orderCount,
      units: kpis.prior.itemCount,
    },
    change: {
      revenue: kpis.trends.revenue,
      net: kpis.trends.estProfit,
      orders: kpis.trends.orderCount,
      units: kpis.trends.itemCount,
    },
  };
}

export async function getShopifyDashboard(window?: {
  from: Date;
  to: Date;
  key: DateRangeKey | null;
}): Promise<DashboardSection<ShopifyData>> {
  try {
    const [ready, settings] = await Promise.all([isShopifyApiReady(), getAppSettings()]);
    const shop = settings?.shopifyShopName || settings?.shopifyShopDomain || null;
    const orderCount = await tryPrisma((db) => db.order.count());

    if (!ready && !orderCount) {
      return { status: 'ok', data: emptyShopify(shop) };
    }

    const margin = settings?.defaultMarginPercent ?? 35;
    const freeShip = settings?.averageFreeShippingCost ?? 15;
    const selected = window ?? { ...rangeToDates('1d'), key: '1d' as const };

    const [focus, tops, recent, budget, entries, ops] = await Promise.all([
      statsFor(selected.from, selected.to, selected.key, margin, freeShip),
      getAllTopProducts(selected.from, selected.to, margin),
      getRecentOrders(8),
      getEffectiveDailyBudget(),
      getRecentAdBudgets(14),
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

    const focusProducts = tops.byUnits.slice(0, 10).map((row) => ({ name: row.title, units: row.units, revenue: row.revenue }));

    return {
      status: 'ok',
      data: {
        state: ready || (orderCount ?? 0) > 0 ? 'ok' : 'not_configured',
        shop,
        lastSync: settings?.lastSuccessfulSyncAt?.toISOString() ?? null,
        ranges: { '7': focus, '30': focus, '90': focus },
        focus,
        dailyBudget: budget,
        adEntries: entries.map((entry) => ({
          date: entry.date.toISOString().slice(0, 10),
          amount: toNumber(entry.amount),
        })),
        unfulfilled: ops?.unfulfilled ?? 0,
        overdue: ops?.overdue ?? 0,
        lowStock: ops?.lowStock ?? 0,
        products: { '7': focusProducts, '30': focusProducts, '90': focusProducts },
        focusProducts,
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
