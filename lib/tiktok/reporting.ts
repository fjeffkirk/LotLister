import { TiktokUserError } from './policy';

export interface MetricValue {
  value: number | null;
  reason: string | null;
}

export interface NormalizedReport {
  currency: string | null;
  timezone: string | null;
  freshness: string;
  attribution: string;
  includesOrganicSales: boolean;
  paidOnlyRoas: MetricValue;
  verifiedStoreOrders: MetricValue;
  spend: MetricValue;
  impressions: MetricValue;
  videoViews: MetricValue;
  destinationClicks: MetricValue;
  allClicks: MetricValue;
  ctr: MetricValue;
  cpc: MetricValue;
  cpm: MetricValue;
  landingPageViews: MetricValue;
  addToCart: MetricValue;
  checkout: MetricValue;
  purchases: MetricValue;
  purchaseRevenue: MetricValue;
  cpa: MetricValue;
  roas: MetricValue;
  definitions: Record<string, string>;
}

const DEFINITIONS: Record<string, string> = {
  spend: 'Amount TikTok attributes to delivery, in the advertiser currency.',
  impressions: 'Times the ad was shown. This is not a video view.',
  videoViews: 'video_play_actions. Counted separately from impressions.',
  destinationClicks: 'TikTok clicks: clicks through to the destination.',
  allClicks: 'TikTok engagements when that metric is returned. This is not the destination-click count.',
  landingPageViews: 'total_landing_page_view when TikTok returns it.',
  purchases: 'complete_payment events attributed by TikTok. Not matched to store orders.',
  purchaseRevenue: 'total_complete_payment_rate for auction reports. GMV Max uses gross_revenue, which includes organic sales.',
  cpa: 'Spend divided by TikTok-attributed purchases. Null when either number is missing or purchases are zero.',
  roas: 'TikTok-attributed purchase revenue divided by spend. Null for GMV Max because that revenue includes organic sales.',
};

const FRESHNESS = 'TikTok synchronous reports can lag. A missing hour is not a zero. Compare a downloaded Ads Manager file with an async report, not this synchronous response.';
const ATTRIBUTION = 'Figures use TikTok’s attribution for this ad account. LotLister does not receive the click or view window in this response, and these purchases are not matched to Shopify orders.';

function present(metrics: Record<string, unknown>, key: string): MetricValue {
  if (!(key in metrics) || metrics[key] === null || metrics[key] === undefined || metrics[key] === '') {
    return { value: null, reason: `TikTok did not return ${key} for this report.` };
  }
  const value = Number(metrics[key]);
  if (!Number.isFinite(value)) return { value: null, reason: `TikTok returned a non-numeric ${key}.` };
  return { value, reason: null };
}

function ratio(numerator: MetricValue, denominator: MetricValue, label: string): MetricValue {
  if (numerator.value == null || denominator.value == null) {
    return { value: null, reason: `${label} needs both numbers from TikTok.` };
  }
  if (denominator.value === 0) return { value: null, reason: `${label} is undefined because the denominator is zero.` };
  return { value: Math.round((numerator.value / denominator.value) * 10000) / 10000, reason: null };
}

/** Map one integrated-report metrics object. Absent metrics stay null. */
export function normalizeAuctionReport(metrics: Record<string, unknown>, context: { currency?: string | null; timezone?: string | null } = {}): NormalizedReport {
  const spend = present(metrics, 'spend');
  const impressions = present(metrics, 'impressions');
  const videoViews = present(metrics, 'video_play_actions');
  const destinationClicks = present(metrics, 'clicks');
  const allClicks = present(metrics, 'engagements');
  const ctr = present(metrics, 'ctr');
  const cpc = present(metrics, 'cpc');
  const cpm = present(metrics, 'cpm');
  const landingPageViews = present(metrics, 'total_landing_page_view');
  const addToCart = present(metrics, 'web_event_add_to_cart');
  const checkout = present(metrics, 'initiate_checkout');
  const purchases = present(metrics, 'complete_payment');
  const purchaseRevenue = present(metrics, 'total_complete_payment_rate');
  return {
    currency: context.currency ?? null,
    timezone: context.timezone ?? null,
    freshness: FRESHNESS,
    attribution: ATTRIBUTION,
    includesOrganicSales: false,
    paidOnlyRoas: ratio(purchaseRevenue, spend, 'Paid ROAS'),
    verifiedStoreOrders: { value: null, reason: 'Shopify orders are not joined to TikTok conversions. Purchase counts are TikTok-attributed only.' },
    spend,
    impressions,
    videoViews,
    destinationClicks,
    allClicks,
    ctr: ctr.value == null ? ratio(destinationClicks, impressions, 'CTR') : ctr,
    cpc: cpc.value == null ? ratio(spend, destinationClicks, 'CPC') : cpc,
    cpm: cpm.value == null ? (spend.value != null && impressions.value ? { value: impressions.value === 0 ? null : Math.round((spend.value / impressions.value) * 1000 * 10000) / 10000, reason: impressions.value === 0 ? 'CPM is undefined because impressions are zero.' : null } : { value: null, reason: 'CPM needs spend and impressions.' }) : cpm,
    landingPageViews,
    addToCart,
    checkout,
    purchases,
    purchaseRevenue,
    cpa: ratio(spend, purchases, 'CPA'),
    roas: ratio(purchaseRevenue, spend, 'ROAS'),
    definitions: DEFINITIONS,
  };
}

/** GMV Max revenue includes organic sales. Paid-only ROAS is therefore unavailable. */
export function normalizeGmvMaxReport(metrics: Record<string, unknown>, context: { currency?: string | null; timezone?: string | null } = {}): NormalizedReport {
  const report = normalizeAuctionReport(metrics, context);
  const revenue = present(metrics, 'gross_revenue');
  return {
    ...report,
    includesOrganicSales: true,
    purchaseRevenue: revenue.value == null ? { value: null, reason: 'TikTok did not return gross_revenue. GMV Max revenue includes organic sales when it is present, so it is not paid-only revenue.' } : { value: revenue.value, reason: 'gross_revenue includes organic TikTok Shop sales. It is not paid-only purchase revenue.' },
    paidOnlyRoas: { value: null, reason: 'GMV Max ROI mixes paid and organic sales. LotLister will not report it as paid ROAS.' },
    roas: { value: null, reason: 'GMV Max ROI mixes paid and organic sales. LotLister will not report it as paid ROAS.' },
  };
}

export function assertReportWindow(input: { startDate: string; endDate: string; breakdown: 'none' | 'day' | 'hour' }): void {
  const start = Date.parse(`${input.startDate}T00:00:00Z`);
  const end = Date.parse(`${input.endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new TiktokUserError('invalid_range', 'Use startDate and endDate as YYYY-MM-DD in the advertiser timezone.');
  }
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (input.breakdown === 'hour' && days !== 1) {
    throw new TiktokUserError('invalid_range', 'TikTok allows stat_time_hour only when the report covers one advertiser-timezone day.');
  }
  if (input.breakdown === 'day' && days > 30) {
    throw new TiktokUserError('invalid_range', 'TikTok allows stat_time_day for at most 30 days.');
  }
  if (days > 365) throw new TiktokUserError('invalid_range', 'TikTok basic reports cover at most 365 days.');
}
