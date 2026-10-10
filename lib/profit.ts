/** Merchandise total at or above this (excl. customer-paid shipping) qualifies for free shipping. */
export const FREE_SHIPPING_THRESHOLD_USD = 100;
/** Fallback when Settings has no value yet. The dashboard must use AppSetting when present. */
export const DEFAULT_AVERAGE_FREE_SHIPPING_COST_USD = 15;

/**
 * Blended product margin as a 0–1 rate.
 * Falls back to the account default when there is no line revenue.
 */
export function blendedMarginRate(lineProfit: number, lineRevenue: number, fallbackRate: number): number {
  return lineRevenue > 0 ? lineProfit / lineRevenue : fallbackRate;
}

/** True when Shopify charged $0 shipping and merchandise hit the free-shipping threshold. */
export function isQualifyingFreeShippingOrder(shippingCollected: number, merchandiseTotal: number): boolean {
  return shippingCollected < 0.01 && merchandiseTotal >= FREE_SHIPPING_THRESHOLD_USD;
}

export function freeShippingCostTotal(qualifyingOrderCount: number, averageCostUsd: number): number {
  return Math.max(0, qualifyingOrderCount) * Math.max(0, averageCostUsd);
}

/**
 * Est. profit: product-line profit (per-SKU margins) minus ads and free-shipping postage.
 * Customer-paid shipping is excluded (break-even). Ads and free postage are cash, not margined.
 */
export function estimatedNetProfit(
  productProfit: number,
  adSpend: number,
  freeShippingCosts: number,
): number {
  return productProfit - adSpend - freeShippingCosts;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Profit = merchandise − item cost − ad spend − postage we pay.
 * Merchandise is total sales with buyer-paid shipping and sales tax already removed.
 */
export function salesProfit(merchandise: number, itemCost: number, adSpend: number, postage = 0): number {
  return round2(merchandise - itemCost - adSpend - postage);
}

/**
 * Item cost from LotLister margins, applied to merchandise.
 * marginWeightedCost is the sum of each line's price times (1 − that product's margin).
 * When a product has its own margin, that rate is used. Otherwise the account default is used.
 */
export function itemCostFromMargins(
  merchandise: number,
  lineRevenue: number,
  marginWeightedCost: number,
  fallbackMarginRate: number,
): number {
  const raw = lineRevenue > 0
    ? merchandise * (marginWeightedCost / lineRevenue)
    : merchandise * (1 - fallbackMarginRate);
  return round2(raw);
}
