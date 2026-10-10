'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdBudgetEntry,
  DashboardChannel,
  DashboardData,
  DashboardSection,
  EtsyData,
  PeriodChange,
  RangeStats,
  ShopifyData,
  ShopifyRangeStats,
} from '../../lib/dashboard-types';
import {
  AlertIcon,
  ExternalIcon,
  LayersIcon,
  RotateIcon,
  TagIcon,
  TrendIcon,
  TrophyIcon,
  TruckIcon,
  WalletIcon,
} from '../ui/icons';

const RANGE_STORAGE_KEY = 'lotlister.dashboardRange.v2';
const CHANNEL_STORAGE_KEY = 'lotlister.dashboardChannel.v2';
const PRESETS = ['1d', 'yesterday', '7d', '30d', '90d'] as const;
type Preset = (typeof PRESETS)[number];

const PRESET_LABELS: Record<Preset, string> = {
  '1d': 'Today',
  yesterday: 'Yesterday',
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
};
const SELLER_HUB = {
  orders: 'https://www.ebay.com/sh/ord',
  awaiting: 'https://www.ebay.com/sh/ord/?filter=status:AWAITING_SHIPMENT',
  active: 'https://www.ebay.com/sh/lst/active',
};

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const compactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

function money(n: number): string {
  return Math.abs(n) >= 100_000 ? compactCurrency.format(n) : currency.format(n);
}

function etsyProfitNote(etsy: EtsyData | null): string | null {
  if (!etsy) return null;
  if (etsy.fees == null) return 'Etsy ads were not included';
  return `after ${money(etsy.shipping)} shipping, ${money(etsy.fees)} ads, and ${money(etsy.itemCost)} item cost`;
}

function shopifyProfitNote(range: ShopifyRangeStats): string {
  const postage = range.postage > 0 ? `, ${money(range.postage)} postage` : '';
  return `after ${money(range.shipping)} shipping, ${money(range.adSpend)} ads, ${money(range.itemCost)} item cost${postage}`;
}

const YEAR_DAYS = 365;

function periodDayCount(range: Preset | 'custom', customFrom: string, customTo: string): number {
  if (range === '1d' || range === 'yesterday') return 1;
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  if (range === '90d') return 90;
  if (customFrom && customTo) {
    const from = Date.parse(`${customFrom}T00:00:00Z`);
    const to = Date.parse(`${customTo}T00:00:00Z`);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      return Math.max(1, Math.round(Math.abs(to - from) / 86_400_000) + 1);
    }
  }
  return 1;
}

/** This range stretched to a full year. A $200 day becomes $200 × 365. */
function annualized(value: number, days: number): number {
  return (value / days) * YEAR_DAYS;
}

function periodChange(current: number, prior: number): PeriodChange {
  if (prior === 0) return current > 0 ? { pct: 0, direction: 'none' } : { pct: 0, direction: 'flat' };
  const pct = Math.round(((current - prior) / Math.abs(prior)) * 100);
  return { pct: Math.abs(pct), direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

function compareWith(range: Preset | 'custom'): string {
  if (range === '1d') return 'the same time yesterday';
  if (range === 'yesterday') return 'the day before';
  if (range === '7d') return 'the 7 days before';
  if (range === '30d') return 'the 30 days before';
  if (range === '90d') return 'the 90 days before';
  return 'the period just before this one';
}

function countAverage(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString()
    : rounded.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sectionData<T>(section: DashboardSection<T> | undefined): T | null {
  return section?.status === 'ok' ? section.data : null;
}

export function EbayOverview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [range, setRange] = useState<Preset | 'custom'>('1d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [channel, setChannel] = useState<DashboardChannel>('shopify');
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(RANGE_STORAGE_KEY);
    if (saved && (PRESETS as readonly string[]).includes(saved)) setRange(saved as Preset);
    const savedFrom = window.localStorage.getItem(`${RANGE_STORAGE_KEY}.from`);
    const savedTo = window.localStorage.getItem(`${RANGE_STORAGE_KEY}.to`);
    if (saved === 'custom' && savedFrom && savedTo) {
      setRange('custom');
      setCustomFrom(savedFrom);
      setCustomTo(savedTo);
    }
    const savedChannel = window.localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (savedChannel === 'all' || savedChannel === 'ebay' || savedChannel === 'shopify' || savedChannel === 'etsy') setChannel(savedChannel);
    setPrefsReady(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    const query =
      range === 'custom' && customFrom && customTo
        ? `from=${customFrom}&to=${customTo}`
        : `range=${range === 'custom' ? '1d' : range}`;
    try {
      const res = await fetch(`/api/dashboard?tz=${new Date().getTimezoneOffset()}&${query}`, { cache: 'no-store' });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Could not load dashboard data');
      setData(body.data as DashboardData);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Could not load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [range, customFrom, customTo]);

  useEffect(() => {
    if (prefsReady) load();
  }, [prefsReady, load]);

  function chooseRange(next: Preset) {
    setRange(next);
    window.localStorage.setItem(RANGE_STORAGE_KEY, next);
  }

  function applyCustom(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
    setRange('custom');
    window.localStorage.setItem(RANGE_STORAGE_KEY, 'custom');
    window.localStorage.setItem(`${RANGE_STORAGE_KEY}.from`, from);
    window.localStorage.setItem(`${RANGE_STORAGE_KEY}.to`, to);
  }

  function chooseChannel(next: DashboardChannel) {
    setChannel(next);
    window.localStorage.setItem(CHANNEL_STORAGE_KEY, next);
  }

  const sales = sectionData(data?.sales);
  const shipping = sectionData(data?.shipping);
  const listings = sectionData(data?.listings);
  const shopify = sectionData(data?.shopify);
  const shopifyReady = shopify?.state === 'ok';
  const etsy = data?.etsy?.status === 'ok' ? data.etsy.data : null;
  const etsyReady = etsy?.state === 'ok';
  const stats: RangeStats | null = sales?.focus ?? (sales ? sales.ranges['30'] : null);
  const periodLabel = range === 'custom' && customFrom && customTo ? `${customFrom} – ${customTo}` : range === 'custom' ? 'Today' : PRESET_LABELS[range];
  const comparedWith = compareWith(range);
  const shopRange = shopify?.focus ?? shopify?.ranges['30'] ?? null;
  const rangeDays = periodDayCount(range, customFrom, customTo);
  const yearSales = shopRange ? annualized(shopRange.revenue, rangeDays) : null;
  const yearProfit = shopRange ? annualized(shopRange.net, rangeDays) : null;
  const yearOrders = shopRange ? annualized(shopRange.orders, rangeDays) : null;
  const yearUnits = shopRange ? annualized(shopRange.units, rangeDays) : null;
  const ebayPrior = sales?.prior;
  const ebaySalesChange = stats && ebayPrior ? periodChange(stats.summary.gross, ebayPrior.gross) : undefined;
  const ebayNetChange = stats && ebayPrior ? periodChange(stats.summary.net, ebayPrior.net) : undefined;
  const needsReconnect = [data?.sales, data?.shipping, data?.listings].some((s) => s?.status === 'reconnect');
  const busy = loading;
  const showEbayConnect = Boolean(data && data.state !== 'ok' && !shopifyReady && (channel === 'ebay' || channel === 'all'));

  const combinedSales = (stats?.summary.gross ?? 0) + (shopRange?.revenue ?? 0) + (etsyReady ? etsy?.revenue ?? 0 : 0);
  const combinedNet = (stats?.summary.net ?? 0) + (shopRange?.net ?? 0) + (etsyReady && etsy?.profit != null ? etsy.profit : 0);
  const allSalesChange = periodChange(
    combinedSales,
    (ebayPrior?.gross ?? 0) + (shopRange?.prior?.revenue ?? 0) + (etsy?.prior?.revenue ?? 0)
  );
  const allNetChange = periodChange(
    combinedNet,
    (ebayPrior?.net ?? 0) + (shopRange?.prior?.net ?? 0) + (etsy?.prior?.profit ?? 0)
  );
  const combinedOrders = (stats?.summary.orders ?? 0) + (shopRange?.orders ?? 0) + (etsyReady ? etsy?.orders ?? 0 : 0);
  const combinedUnits = (stats?.summary.units ?? 0) + (shopRange?.units ?? 0) + (etsyReady ? etsy?.units ?? 0 : 0);
  const combinedDaily = mergeDaily(mergeDaily(stats?.summary.daily, shopRange?.daily), etsyReady ? etsy?.daily : undefined);
  const toShip = (shipping?.orders ?? 0) + (shopify?.unfulfilled ?? 0) + (etsyReady ? etsy?.unshipped ?? 0 : 0);
  const overdue = (shipping?.overdue ?? 0) + (shopify?.overdue ?? 0);
  const etsySalesChange = etsy?.prior ? periodChange(etsy.revenue, etsy.prior.revenue) : undefined;
  const etsyProfitChange = etsy?.profit != null && etsy.prior?.profit != null ? periodChange(etsy.profit, etsy.prior.profit) : undefined;
  const etsyOrdersChange = etsy?.prior ? periodChange(etsy.orders, etsy.prior.orders) : undefined;
  const etsyUnitsChange = etsy?.prior ? periodChange(etsy.units, etsy.prior.units) : undefined;

  const liveLabel =
    channel === 'shopify'
      ? `Live from Shopify${shopify?.shop ? ` · ${shopify.shop}` : ''}`
      : channel === 'ebay'
        ? `Live from eBay${data?.account ? ` · ${data.account}` : ''}`
        : channel === 'etsy'
          ? `Live from Etsy${etsy?.shop ? ` · ${etsy.shop}` : ''}`
          : `eBay + Shopify + Etsy${[data?.account, shopify?.shop, etsy?.shop].filter(Boolean).length ? ` · ${[data?.account, shopify?.shop, etsy?.shop].filter(Boolean).join(' · ')}` : ''}`;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-sm text-surface-400 min-w-0">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className={`absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 ${loading ? 'animate-ping' : ''}`} />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="truncate">{liveLabel}</span>
          {data && (
            <span className="hidden lg:inline text-surface-500 flex-shrink-0">
              · Updated {new Date(data.fetchedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="btn btn-ghost btn-icon btn-sm -ml-1"
            aria-label="Refresh dashboard"
            title="Refresh"
          >
            <RotateIcon size={14} className={loading ? 'animate-spin [animation-direction:reverse]' : ''} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChannelToggle value={channel} onChange={chooseChannel} />
          <RangeToggle value={range} customFrom={customFrom} customTo={customTo} onChange={chooseRange} onCustom={applyCustom} />
        </div>
      </div>

      {channel === 'shopify' && (
        <AdSpendBar
          dailyBudget={shopify?.dailyBudget ?? null}
          periodSpend={shopRange?.adSpend ?? 0}
          periodLabel={periodLabel}
          entries={shopify?.adEntries ?? []}
          onSaved={load}
        />
      )}

      {failed && !data && (
        <div className="panel flex items-center justify-between gap-4 px-4 py-3 text-sm text-red-200 border-red-500/30 bg-red-500/10">
          <span className="flex items-center gap-2"><AlertIcon size={15} /> {failed}</span>
          <button onClick={load} className="btn btn-secondary btn-sm">Try again</button>
        </div>
      )}

      {needsReconnect && (channel === 'ebay' || channel === 'all') && <ReconnectBanner />}
      {showEbayConnect && data && (data.state === 'not_configured' || data.state === 'not_connected') && (
        <ConnectBanner state={data.state} />
      )}
      {(channel === 'shopify' || channel === 'all') && data?.shopify?.status === 'ok' && shopify?.state === 'not_configured' && <ShopifyConnectBanner />}
      {(channel === 'shopify' || channel === 'all') && data?.shopify?.status === 'error' && (
        <div className="panel px-4 py-3 text-sm text-surface-400">{data.shopify.message}</div>
      )}
      {(channel === 'etsy' || channel === 'all') && etsy?.state === 'not_connected' && <EtsyConnectBanner />}
      {channel === 'etsy' && data?.etsy?.status === 'error' && (
        <div className="panel px-4 py-3 text-sm text-surface-400">{data.etsy.message}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {channel === 'ebay' ? (
          <>
            <MetricTile
              icon={<TrendIcon size={16} />}
              tone="primary"
              label="Sales"
              suffix={periodLabel}
              loading={busy}
              section={data?.sales}
              value={stats ? money(stats.summary.gross) : null}
              sub={stats ? `${plural(stats.summary.orders, 'order')} · ${plural(stats.summary.units, 'card')}` : null}
              href={SELLER_HUB.orders}
              title="Item price plus shipping the buyer paid, before sales tax."
              delta={ebaySalesChange}
              deltaLabel={comparedWith}
              footer={
                stats ? (
                  <div className="space-y-2">
                    {stats.summary.gross > 0 && <Sparkline values={stats.summary.daily} />}
                    <FootNote title="This range stretched across 365 days.">Over 365 days {money(annualized(stats.summary.gross, rangeDays))}</FootNote>
                  </div>
                ) : null
              }
            />
            <MetricTile
              icon={<WalletIcon size={16} />}
              tone="emerald"
              label="Net earnings"
              shortLabel="Net"
              suffix={periodLabel}
              loading={busy}
              section={data?.sales}
              value={stats ? money(stats.summary.net) : null}
              sub={
                stats
                  ? `after ${money(stats.summary.fees)} eBay fees${stats.summary.refunds > 0 ? ` · ${money(stats.summary.refunds)} refunded` : ''}`
                  : null
              }
              title="Sales minus the marketplace fees and refunds eBay deducts on the order. eBay takes promoted listing charges out of the payout."
              delta={ebayNetChange}
              deltaLabel={comparedWith}
              footer={
                stats ? (
                  <div className="space-y-1">
                    {stats.summary.units > 0 && <FootNote>{money(stats.summary.avgItemPrice)} avg per card</FootNote>}
                    <FootNote title="This range stretched across 365 days.">Over 365 days {money(annualized(stats.summary.net, rangeDays))}</FootNote>
                  </div>
                ) : null
              }
            />
            <MetricTile
              icon={<TruckIcon size={16} />}
              tone={shipping && shipping.overdue > 0 ? 'danger' : 'amber'}
              label="Awaiting shipment"
              shortLabel="To ship"
              loading={busy}
              section={data?.shipping}
              value={shipping ? shipping.orders.toLocaleString() : null}
              sub={shipping ? (shipping.orders === 0 ? 'All caught up' : `${plural(shipping.units, 'card')} to pack`) : null}
              href={SELLER_HUB.awaiting}
              footer={
                shipping && shipping.overdue > 0 ? (
                  <FootNote tone="danger">{plural(shipping.overdue, 'order')} past ship-by date</FootNote>
                ) : shipping?.nextShipBy ? (
                  <FootNote>
                    Next ship by {new Date(shipping.nextShipBy).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </FootNote>
                ) : null
              }
            />
            <MetricTile
              icon={<TagIcon size={16} />}
              tone="violet"
              label="Active listings"
              shortLabel="Listings"
              loading={busy}
              section={data?.listings}
              value={listings ? listings.count.toLocaleString() : null}
              sub={listings ? `${money(listings.value)} listed · ${plural(listings.watchers, 'watcher')}` : null}
              href={SELLER_HUB.active}
              footer={listings && listings.scheduled > 0 ? <FootNote>{listings.scheduled.toLocaleString()} scheduled to start</FootNote> : null}
            />
          </>
        ) : channel === 'etsy' ? (
          <>
            <MetricTile
              icon={<TrendIcon size={16} />}
              tone="primary"
              label="Sales"
              suffix={periodLabel}
              loading={busy}
              section={data?.etsy?.status === 'error' ? data.etsy : { status: 'ok', data: true }}
              value={etsy ? money(etsy.revenue) : null}
              sub={etsy ? `${plural(etsy.orders, 'order')} · ${plural(etsy.units, 'item')}` : null}
              href="https://www.etsy.com/your/orders/sold"
              title="Item price plus shipping the buyer paid, before tax."
              delta={etsySalesChange}
              deltaLabel={comparedWith}
              footer={
                etsy ? (
                  <div className="space-y-2">
                    {etsy.revenue > 0 && <Sparkline values={etsy.daily} />}
                    <FootNote title="This range stretched across 365 days.">Over 365 days {money(annualized(etsy.revenue, rangeDays))}</FootNote>
                  </div>
                ) : null
              }
            />
            <MetricTile
              icon={<WalletIcon size={16} />}
              tone="emerald"
              label="Profit"
              suffix={periodLabel}
              loading={busy}
              section={data?.etsy?.status === 'error' ? data.etsy : { status: 'ok', data: true }}
              value={etsy ? (etsy.profit != null ? money(etsy.profit) : '—') : null}
              sub={etsyProfitNote(etsy)}
              title="Sales minus the shipping the buyer paid, minus Etsy ads, minus item cost from your product margin. A day with no sales is $0 unless Etsy charged ads that day."
              delta={etsyProfitChange}
              deltaLabel={comparedWith}
              footer={
                etsy?.profit != null ? (
                  <FootNote title="This range stretched across 365 days.">Over 365 days {money(annualized(etsy.profit, rangeDays))}</FootNote>
                ) : null
              }
            />
            <MetricTile
              icon={<LayersIcon size={16} />}
              tone="amber"
              label="Orders"
              suffix={periodLabel}
              loading={busy}
              section={data?.etsy?.status === 'error' ? data.etsy : { status: 'ok', data: true }}
              value={etsy ? etsy.orders.toLocaleString() : null}
              sub={etsy ? `${plural(etsy.orders, 'order')}` : null}
              delta={etsyOrdersChange}
              deltaLabel={comparedWith}
              footer={etsy ? <FootNote title="This range stretched across 365 days.">Over 365 days {Math.round(annualized(etsy.orders, rangeDays)).toLocaleString()}</FootNote> : null}
            />
            <MetricTile
              icon={<TagIcon size={16} />}
              tone="violet"
              label="Items sold"
              shortLabel="Items"
              suffix={periodLabel}
              loading={busy}
              section={data?.etsy?.status === 'error' ? data.etsy : { status: 'ok', data: true }}
              value={etsy ? etsy.units.toLocaleString() : null}
              sub={etsy ? `${plural(etsy.units, 'item')}` : null}
              delta={etsyUnitsChange}
              deltaLabel={comparedWith}
              footer={etsy ? <FootNote title="This range stretched across 365 days.">Over 365 days {Math.round(annualized(etsy.units, rangeDays)).toLocaleString()}</FootNote> : null}
            />
            <MetricTile
              icon={<TruckIcon size={16} />}
              tone={etsy && etsy.unshipped > 0 ? 'amber' : 'emerald'}
              label="Awaiting shipment"
              shortLabel="To ship"
              loading={busy}
              section={data?.etsy?.status === 'error' ? data.etsy : { status: 'ok', data: true }}
              value={etsy ? etsy.unshipped.toLocaleString() : null}
              sub="Open paid orders"
              href="https://www.etsy.com/your/orders/sold"
            />
          </>
        ) : channel === 'shopify' ? (
          <>
            <MetricTile
              icon={<TrendIcon size={16} />}
              tone="primary"
              label="Sales"
              suffix={periodLabel}
              loading={busy}
              section={data?.shopify}
              value={shopRange ? money(shopRange.revenue) : null}
              sub={shopRange ? `${plural(shopRange.orders, 'order')} · ${plural(shopRange.units, 'item')}` : null}
              title="Item price plus shipping the buyer paid, before tax. Draft orders are excluded."
              delta={shopRange?.change?.revenue}
              deltaLabel={comparedWith}
              footer={
                shopRange ? (
                  <div className="space-y-2">
                    {shopRange.revenue > 0 && <Sparkline values={shopRange.daily} />}
                    {yearSales !== null && (
                      <FootNote title="This range stretched across 365 days.">Over 365 days {money(yearSales)}</FootNote>
                    )}
                  </div>
                ) : null
              }
            />
            <MetricTile
              icon={<WalletIcon size={16} />}
              tone="emerald"
              label="Est. profit"
              shortLabel="Profit"
              suffix={periodLabel}
              loading={busy}
              section={data?.shopify}
              value={shopRange ? money(shopRange.net) : null}
              sub={shopRange ? shopifyProfitNote(shopRange) : null}
              title="Sales minus shipping, minus Shopify ad spend, minus item cost from the margin set in LotLister, minus postage on free-shipping orders."
              delta={shopRange?.change?.net}
              deltaLabel={comparedWith}
              footer={
                yearProfit !== null ? (
                  <FootNote title="This range stretched across 365 days.">Over 365 days {money(yearProfit)}</FootNote>
                ) : null
              }
            />
            <MetricTile
              icon={<LayersIcon size={16} />}
              tone="amber"
              label="Order amount"
              shortLabel="Orders"
              suffix={periodLabel}
              loading={busy}
              section={data?.shopify}
              value={shopRange ? shopRange.orders.toLocaleString() : null}
              sub={shopRange && shopRange.orders > 0 ? `${money(shopRange.aov)} average` : 'Shopify orders'}
              title="Number of Shopify orders in this range, excluding draft orders."
              delta={shopRange?.change?.orders}
              deltaLabel={comparedWith}
              footer={
                yearOrders !== null ? (
                  <FootNote title="This range stretched across 365 days.">Over 365 days {countAverage(yearOrders)}</FootNote>
                ) : null
              }
            />
            <MetricTile
              icon={<TagIcon size={16} />}
              tone="violet"
              label="Items sold"
              shortLabel="Items"
              suffix={periodLabel}
              loading={busy}
              section={data?.shopify}
              value={shopRange ? shopRange.units.toLocaleString() : null}
              sub="Units on those orders"
              title="Quantity of items sold on Shopify in this range."
              delta={shopRange?.change?.units}
              deltaLabel={comparedWith}
              footer={
                yearUnits !== null ? (
                  <FootNote title="This range stretched across 365 days.">Over 365 days {countAverage(yearUnits)}</FootNote>
                ) : null
              }
            />
          </>
        ) : (
          <>
            <MetricTile
              icon={<TrendIcon size={16} />}
              tone="primary"
              label="Sales"
              suffix={periodLabel}
              loading={busy}
              section={data?.sales?.status === 'ok' || shopifyReady ? { status: 'ok', data: true } : data?.sales}
              value={!busy ? money(combinedSales) : null}
              sub={`${plural(combinedOrders, 'order')} · ${plural(combinedUnits, 'item')}`}
              title="eBay, Shopify, and Etsy sales: item price plus shipping, before tax."
              delta={!busy ? allSalesChange : undefined}
              deltaLabel={comparedWith}
              footer={
                !busy ? (
                  <div className="space-y-2">
                    {combinedSales > 0 && <Sparkline values={combinedDaily} />}
                    <FootNote title="This range stretched across 365 days.">Over 365 days {money(annualized(combinedSales, rangeDays))}</FootNote>
                  </div>
                ) : null
              }
            />
            <MetricTile
              icon={<WalletIcon size={16} />}
              tone="emerald"
              label="Net earnings"
              shortLabel="Net"
              suffix={periodLabel}
              loading={busy}
              section={data?.sales?.status === 'ok' || shopifyReady ? { status: 'ok', data: true } : data?.sales}
              value={!busy ? money(combinedNet) : null}
              sub="eBay after its fees, plus Shopify and Etsy after shipping, ads, and item cost"
              title="eBay after the fees eBay charged. Shopify and Etsy use sales minus shipping, ads, and item cost."
              delta={!busy ? allNetChange : undefined}
              deltaLabel={comparedWith}
              footer={
                !busy ? (
                  <FootNote title="This range stretched across 365 days.">Over 365 days {money(annualized(combinedNet, rangeDays))}</FootNote>
                ) : null
              }
            />
            <MetricTile
              icon={<TruckIcon size={16} />}
              tone={overdue > 0 ? 'danger' : 'amber'}
              label="Awaiting shipment"
              shortLabel="To ship"
              loading={busy}
              section={data?.shipping?.status === 'ok' || shopifyReady ? { status: 'ok', data: true } : data?.shipping}
              value={!busy ? toShip.toLocaleString() : null}
              sub={toShip === 0 ? 'All caught up' : 'eBay + Shopify'}
              href="/ops/orders"
              footer={overdue > 0 ? <FootNote tone="danger">{plural(overdue, 'order')} overdue</FootNote> : null}
            />
            <MetricTile
              icon={<TagIcon size={16} />}
              tone="violet"
              label="Store pulse"
              shortLabel="Pulse"
              loading={busy}
              section={data?.listings?.status === 'ok' || shopifyReady ? { status: 'ok', data: true } : data?.listings}
              value={listings ? listings.count.toLocaleString() : shopifyReady ? String(shopify?.lowStock ?? 0) : null}
              sub={[
                listings ? `${listings.count.toLocaleString()} eBay live` : null,
                shopify ? `${shopify.lowStock} low stock` : null,
              ].filter(Boolean).join(' · ') || null}
              title="eBay active listings and Shopify products at or below reorder."
            />
          </>
        )}
      </div>

      {channel === 'all' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <TopPlayers
            label={periodLabel}
            loading={busy}
            section={data?.sales}
            stats={stats}
            pendingLookups={sales?.pendingLookups ?? 0}
          />
          <TopShopifyProducts label={periodLabel} loading={busy} shopify={shopify} section={data?.shopify} />
        </div>
      ) : channel === 'ebay' ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
          <TopPlayers
            className="lg:col-span-3"
            label={periodLabel}
            loading={busy}
            section={data?.sales}
            stats={stats}
            pendingLookups={sales?.pendingLookups ?? 0}
          />
          <RecentSales className="lg:col-span-2" loading={busy} section={data?.sales} />
        </div>
      ) : channel === 'etsy' ? (
        <div className="panel p-4 sm:p-5">
          <h3 className="text-sm font-medium text-white">Recent Etsy orders</h3>
          {etsy && etsy.recent.length > 0 ? (
            <ul className="mt-3 divide-y divide-white/[0.06]">
              {etsy.recent.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-surface-200">{sale.title}</span>
                  <span className="shrink-0 tabular-nums text-surface-400">{money(sale.total)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-surface-500">No Etsy orders in this range.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
          <TopShopifyProducts className="lg:col-span-3" label={periodLabel} loading={busy} shopify={shopify} section={data?.shopify} />
          <RecentShopifyOrders className="lg:col-span-2" loading={busy} shopify={shopify} section={data?.shopify} />
        </div>
      )}
    </section>
  );
}

function mergeDaily(a?: number[], b?: number[]): number[] {
  if (!a?.length) return b ?? [];
  if (!b?.length) return a;
  const length = Math.max(a.length, b.length);
  return Array.from({ length }, (_, i) => {
    const ai = a.length === length ? a[i] : a[Math.floor((i * a.length) / length)] ?? 0;
    const bi = b.length === length ? b[i] : b[Math.floor((i * b.length) / length)] ?? 0;
    return ai + bi;
  });
}

function ChannelToggle({ value, onChange }: { value: DashboardChannel; onChange: (channel: DashboardChannel) => void }) {
  const options: { id: DashboardChannel; label: string }[] = [
    { id: 'shopify', label: 'Shopify' },
    { id: 'ebay', label: 'eBay' },
    { id: 'etsy', label: 'Etsy' },
    { id: 'all', label: 'All' },
  ];
  return (
    <div role="radiogroup" aria-label="Sales channel" className="inline-flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            value === option.id ? 'bg-white/[0.1] text-white shadow-sm' : 'text-surface-400 hover:text-surface-100'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function RangeToggle({
  value,
  customFrom,
  customTo,
  onChange,
  onCustom,
}: {
  value: Preset | 'custom';
  customFrom: string;
  customTo: string;
  onChange: (range: Preset) => void;
  onCustom: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(customFrom);
  const [to, setTo] = useState(customTo);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            role="radio"
            aria-checked={value === preset}
            onClick={() => onChange(preset)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              value === preset ? 'bg-white/[0.1] text-white shadow-sm' : 'text-surface-400 hover:text-surface-100'
            }`}
          >
            {preset === 'yesterday' ? <><span className="sm:hidden">Yday</span><span className="hidden sm:inline">Yesterday</span></> : PRESET_LABELS[preset]}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value === 'custom'}
          onClick={() => setOpen((current) => !current)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
            value === 'custom' ? 'bg-white/[0.1] text-white shadow-sm' : 'text-surface-400 hover:text-surface-100'
          }`}
        >
          Custom
        </button>
      </div>
      {open && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!from || !to) return;
            onCustom(from <= to ? from : to, from <= to ? to : from);
            setOpen(false);
          }}
        >
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-8 py-0 text-xs" aria-label="From" />
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-8 py-0 text-xs" aria-label="To" />
          <button type="submit" className="btn btn-secondary btn-sm">Apply</button>
        </form>
      )}
    </div>
  );
}

type Tone = 'primary' | 'emerald' | 'amber' | 'violet' | 'danger';

const TONE_CLASSES: Record<Tone, string> = {
  primary: 'bg-primary-500/15 text-primary-300',
  emerald: 'bg-emerald-500/10 text-emerald-300',
  amber: 'bg-amber-500/10 text-amber-300',
  violet: 'bg-accent-500/15 text-accent-300',
  danger: 'bg-red-500/15 text-red-300',
};

function MetricTile({
  icon,
  tone,
  label,
  shortLabel,
  suffix,
  loading,
  section,
  value,
  sub,
  href,
  title,
  footer,
  delta,
  deltaLabel,
}: {
  icon: React.ReactNode;
  tone: Tone;
  label: string;
  shortLabel?: string;
  suffix?: string;
  loading: boolean;
  section: DashboardSection<unknown> | undefined;
  value: string | null;
  sub: string | null;
  href?: string;
  title?: string;
  footer?: React.ReactNode;
  delta?: PeriodChange;
  deltaLabel?: string;
}) {
  const unavailable = !loading && section && section.status !== 'ok';
  return (
    <div className="group panel relative flex flex-col px-4 py-4 sm:px-5 animate-slide-up min-h-[9.5rem]" title={title}>
      <div className="flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${TONE_CLASSES[tone]}`}>{icon}</span>
        <span className="text-xs sm:text-sm text-surface-400 truncate">
          {shortLabel ? (
            <>
              <span className="sm:hidden">{shortLabel}</span>
              <span className="hidden sm:inline">{label}</span>
            </>
          ) : (
            label
          )}
          {suffix && <span className="hidden sm:inline"> · {suffix}</span>}
        </span>
        {href && !unavailable && (
          <a
            href={href}
            target={href.startsWith('/') ? undefined : '_blank'}
            rel={href.startsWith('/') ? undefined : 'noreferrer'}
            className="ml-auto text-surface-500 hover:text-surface-200 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            aria-label={href.startsWith('/') ? `Open ${label}` : `Open ${label} in eBay Seller Hub`}
            title={href.startsWith('/') ? label : 'Open in eBay Seller Hub'}
          >
            <ExternalIcon size={14} />
          </a>
        )}
      </div>

      {loading ? (
        <div className="mt-4 space-y-2.5">
          <div className="skeleton h-7 w-24" />
          <div className="skeleton h-3 w-32" />
        </div>
      ) : unavailable ? (
        <div className="mt-3">
          <div className="text-2xl font-semibold text-surface-600">—</div>
          <p className="mt-1 text-xs text-surface-500 line-clamp-2">
            {section.status === 'reconnect' ? 'Needs eBay sign-in' : section.message}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-2 min-w-0">
            <div className="text-2xl sm:text-[28px] font-semibold tracking-tight text-white tabular-nums truncate">{value}</div>
            <PeriodDelta change={delta} label={deltaLabel} />
          </div>
          {sub && <p className="mt-0.5 text-xs text-surface-400 truncate">{sub}</p>}
          {footer && <div className="mt-auto pt-3">{footer}</div>}
        </>
      )}
    </div>
  );
}

function PeriodDelta({ change, label }: { change?: PeriodChange; label?: string }) {
  if (!change || change.direction === 'none') return null;
  const sign = change.direction === 'up' ? '+' : change.direction === 'down' ? '−' : '';
  const color =
    change.direction === 'up' ? 'text-emerald-300' : change.direction === 'down' ? 'text-red-300' : 'text-surface-400';
  return (
    <span title={label ? `Compared with ${label}` : undefined} className={`flex-shrink-0 text-sm font-medium tabular-nums ${color}`}>
      {sign}
      {change.pct}%
    </span>
  );
}

function FootNote({ children, tone, title }: { children: React.ReactNode; tone?: 'danger'; title?: string }) {
  return (
    <p title={title} className={`text-[11px] ${tone === 'danger' ? 'text-red-300' : 'text-surface-500'} truncate`}>{children}</p>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const width = 100;
  const height = 28;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => [i * step, height - 2 - (v / max) * (height - 4)] as const);
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-7" aria-hidden="true">
      <defs>
        <linearGradient id="sales-spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(74 118 251 / 0.35)" />
          <stop offset="100%" stopColor="rgb(74 118 251 / 0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sales-spark)" />
      <path d={line} fill="none" stroke="rgb(116 150 255)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function PanelShell({
  className = '',
  icon,
  title,
  aside,
  children,
}: {
  className?: string;
  icon: React.ReactNode;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`panel p-4 sm:p-5 animate-slide-up ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          {icon}
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-surface-500">{children}</div>;
}

function TopPlayers({
  className,
  label,
  loading,
  section,
  stats,
  pendingLookups,
}: {
  className?: string;
  label: string;
  loading: boolean;
  section: DashboardSection<unknown> | undefined;
  stats: RangeStats | null;
  pendingLookups: number;
}) {
  const maxUnits = Math.max(1, ...(stats?.players.map((p) => p.units) ?? []));
  return (
    <PanelShell
      className={className}
      icon={<TrophyIcon size={16} className="text-amber-300" />}
      title="Best-selling players"
      aside={<span className="text-xs text-surface-500">{label}</span>}
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton h-6 w-full" />
          ))}
        </div>
      ) : section && section.status !== 'ok' ? (
        <PanelMessage>{section.status === 'reconnect' ? 'Sign in with eBay again to see who is selling.' : section.message}</PanelMessage>
      ) : !stats || stats.players.length === 0 ? (
        <PanelMessage>
          {stats && stats.summary.units > 0
            ? 'Sold cards in this range had no player listed.'
            : `No eBay sales for ${label}.`}
        </PanelMessage>
      ) : (
        <>
          <ol className="space-y-2.5">
            {stats.players.map((player, i) => (
              <li key={player.name} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3">
                <span className={`text-xs font-semibold tabular-nums ${i < 3 ? 'text-amber-300' : 'text-surface-500'}`}>{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-surface-100 truncate" title={player.name}>{player.name}</span>
                    <span className="text-xs text-surface-400 tabular-nums flex-shrink-0">{plural(player.units, 'sold', 'sold')}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-400 transition-all duration-700"
                      style={{ width: `${(player.units / maxUnits) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="w-20 text-right text-sm font-medium text-white tabular-nums">{money(player.revenue)}</span>
              </li>
            ))}
          </ol>
          {(stats.unidentifiedUnits > 0 || pendingLookups > 0) && (
            <p className="mt-4 text-[11px] text-surface-500">
              {pendingLookups > 0
                ? `Still matching ${plural(pendingLookups, 'sold listing')} to players. Refresh in a minute to include them.`
                : `${plural(stats.unidentifiedUnits, 'sold card')} had no player listed on eBay.`}
            </p>
          )}
        </>
      )}
    </PanelShell>
  );
}

function RecentSales({
  className,
  loading,
  section,
}: {
  className?: string;
  loading: boolean;
  section: DashboardData['sales'] | undefined;
}) {
  const recent = section?.status === 'ok' ? section.data.recent : [];
  return (
    <PanelShell
      className={className}
      icon={<TrendIcon size={16} className="text-primary-300" />}
      title="Recent sales"
      aside={
        <a href={SELLER_HUB.orders} target="_blank" rel="noreferrer" className="text-xs text-surface-400 hover:text-white inline-flex items-center gap-1">
          All orders <ExternalIcon size={12} />
        </a>
      }
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton h-9 w-full" />
          ))}
        </div>
      ) : section && section.status !== 'ok' ? (
        <PanelMessage>{section.status === 'reconnect' ? 'Sign in with eBay again to see sales.' : section.message}</PanelMessage>
      ) : recent.length === 0 ? (
        <PanelMessage>No sales in the last 90 days.</PanelMessage>
      ) : (
        <ul className="-mx-2">
          {recent.map((sale, i) => {
            const row = (
              <>
                <div className="min-w-0">
                  <div className="text-sm text-surface-100 truncate" title={sale.title}>{sale.title}</div>
                  <div className="text-[11px] text-surface-500 truncate">
                    {relativeTime(sale.soldAt)}
                    {sale.player ? ` · ${sale.player}` : ''}
                    {sale.quantity > 1 ? ` · ×${sale.quantity}` : ''}
                  </div>
                </div>
                <span className="text-sm font-medium text-white tabular-nums flex-shrink-0">{money(sale.price)}</span>
              </>
            );
            const rowClass = 'flex items-center justify-between gap-3 rounded-lg px-2 py-1.5';
            return (
              <li key={`${sale.itemId}-${sale.soldAt}-${i}`}>
                {sale.itemId ? (
                  <a href={`https://www.ebay.com/itm/${sale.itemId}`} target="_blank" rel="noreferrer" className={`${rowClass} hover:bg-white/[0.04]`}>
                    {row}
                  </a>
                ) : (
                  <div className={rowClass}>{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

function RankedItems({
  items,
}: {
  items: { name: string; units: number; revenue: number }[];
}) {
  const maxUnits = Math.max(1, ...items.map((item) => item.units));
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={item.name} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3">
          <span className={`text-xs font-semibold tabular-nums ${i < 3 ? 'text-amber-300' : 'text-surface-500'}`}>{i + 1}</span>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-surface-100 truncate" title={item.name}>{item.name}</span>
              <span className="text-xs text-surface-400 tabular-nums flex-shrink-0">{plural(item.units, 'sold', 'sold')}</span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-white/[0.05] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-400 transition-all duration-700"
                style={{ width: `${(item.units / maxUnits) * 100}%` }}
              />
            </div>
          </div>
          <span className="w-20 text-right text-sm font-medium text-white tabular-nums">{money(item.revenue)}</span>
        </li>
      ))}
    </ol>
  );
}

function TopShopifyProducts({
  className,
  label,
  loading,
  shopify,
  section,
}: {
  className?: string;
  label: string;
  loading: boolean;
  shopify: ShopifyData | null;
  section: DashboardSection<unknown> | undefined;
}) {
  const items = shopify?.focusProducts ?? [];
  return (
    <PanelShell
      className={className}
      icon={<TrophyIcon size={16} className="text-emerald-300" />}
      title="Best-selling Shopify products"
      aside={<span className="text-xs text-surface-500">{label}</span>}
    >
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-6 w-full" />)}</div>
      ) : section && section.status !== 'ok' ? (
        <PanelMessage>{section.message}</PanelMessage>
      ) : !shopify || shopify.state === 'not_configured' ? (
        <PanelMessage>Connect Shopify to see store bestsellers.</PanelMessage>
      ) : items.length === 0 ? (
        <PanelMessage>{`No Shopify sales for ${label}.`}</PanelMessage>
      ) : (
        <RankedItems items={items} />
      )}
    </PanelShell>
  );
}

function RecentShopifyOrders({
  className,
  loading,
  shopify,
  section,
}: {
  className?: string;
  loading: boolean;
  shopify: ShopifyData | null;
  section: DashboardSection<unknown> | undefined;
}) {
  const recent = shopify?.recent ?? [];
  return (
    <PanelShell
      className={className}
      icon={<TrendIcon size={16} className="text-emerald-300" />}
      title="Recent Shopify orders"
      aside={
        <a href="/ops/orders" className="text-xs text-surface-400 hover:text-white inline-flex items-center gap-1">
          Open orders <ExternalIcon size={12} />
        </a>
      }
    >
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-9 w-full" />)}</div>
      ) : section && section.status !== 'ok' ? (
        <PanelMessage>{section.message}</PanelMessage>
      ) : recent.length === 0 ? (
        <PanelMessage>No Shopify orders yet.</PanelMessage>
      ) : (
        <ul className="-mx-2">
          {recent.map((order) => {
            const row = (
              <>
                <div className="min-w-0">
                  <div className="text-sm text-surface-100 truncate">{order.name}</div>
                  <div className="text-[11px] text-surface-500 truncate">
                    {relativeTime(order.soldAt)}
                    {order.customer ? ` · ${order.customer}` : ''}
                  </div>
                </div>
                <span className="text-sm font-medium text-white tabular-nums flex-shrink-0">{money(order.total)}</span>
              </>
            );
            const rowClass = 'flex items-center justify-between gap-3 rounded-lg px-2 py-1.5';
            return (
              <li key={order.id}>
                {order.href ? (
                  <a href={order.href} target="_blank" rel="noreferrer" className={`${rowClass} hover:bg-white/[0.04]`}>{row}</a>
                ) : (
                  <div className={rowClass}>{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

function AdSpendBar({
  dailyBudget,
  periodSpend,
  periodLabel,
  entries,
  onSaved,
}: {
  dailyBudget: number | null;
  periodSpend: number;
  periodLabel: string;
  entries: AdBudgetEntry[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [amount, setAmount] = useState(dailyBudget != null ? String(dailyBudget) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lookup = useRef(0);
  const today = new Date().toLocaleDateString('en-CA');

  function openEditor() {
    setDate(today);
    setAmount(dailyBudget != null ? String(dailyBudget) : '');
    setError(null);
    setOpen(true);
  }

  async function chooseDate(next: string) {
    setDate(next);
    setError(null);
    const saved = entries.find((entry) => entry.date === next);
    if (saved) {
      setAmount(String(saved.amount));
      return;
    }
    const requestId = lookup.current + 1;
    lookup.current = requestId;
    try {
      const res = await fetch(`/api/ad-budget?date=${next}`);
      const body = await res.json().catch(() => null);
      if (lookup.current !== requestId) return;
      if (res.ok && typeof body?.amount === 'number') setAmount(String(body.amount));
    } catch {
      // Leave the amount the seller already sees.
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const num = Number(amount);
    if (!date || !Number.isFinite(num) || num < 0) {
      setError('Enter a date and an amount of 0 or more.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/ad-budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, amount: num }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Could not save ad spend');
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save ad spend');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-surface-400">Shopify ad spend</span>
        <span className="font-medium text-white tabular-nums">{dailyBudget != null ? `${money(dailyBudget)}/day` : 'not set'}</span>
        <span className="text-surface-500 tabular-nums">· {money(periodSpend)} {periodLabel}</span>
        <button type="button" onClick={openEditor} className="btn btn-ghost btn-icon btn-sm ml-auto" aria-label="Edit ad spend" title="Edit ad spend">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </div>
      {open && (
        <form onSubmit={save} className="mt-3 grid gap-2 sm:grid-cols-[auto_auto_auto] sm:items-end">
          <label className="text-xs text-surface-400">
            Day
            <input type="date" value={date} max={today} onChange={(event) => chooseDate(event.target.value)} className="mt-1 block" />
          </label>
          <label className="text-xs text-surface-400">
            Ad spend
            <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 block" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn btn-primary btn-sm">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">Cancel</button>
          </div>
          <p className="sm:col-span-3 text-[11px] text-surface-500">
            Today’s amount is used again tomorrow until you change it. Pick an earlier day to correct that day only. That spend is subtracted from that day’s profit.
          </p>
          {error && <p className="sm:col-span-3 text-xs text-red-300">{error}</p>}
          {entries.length > 0 && (
            <ul className="sm:col-span-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-surface-500">
              {entries.slice(0, 14).map((entry) => (
                <li key={entry.date}>
                  <button type="button" onClick={() => chooseDate(entry.date)} className="tabular-nums underline-offset-2 hover:underline">
                    {entry.date} · {money(entry.amount)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
    </div>
  );
}

function EtsyConnectBanner() {
  return (
    <div className="panel flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 border-primary-500/30 bg-primary-500/[0.07]">
      <div className="text-sm">
        <div className="font-medium text-white">Connect Etsy to include shop sales here</div>
        <div className="text-xs text-surface-400 mt-0.5">Listing cards on Etsy uses the same lots. Pick a shipping profile in Settings after you connect.</div>
      </div>
      <a href="/settings#etsy" className="btn btn-secondary btn-sm flex-shrink-0">Etsy settings</a>
    </div>
  );
}

function ShopifyConnectBanner() {
  return (
    <div className="panel flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 border-accent-500/30 bg-accent-500/[0.07]">
      <div className="text-sm">
        <div className="font-medium text-white">Connect Shopify to include store sales here</div>
        <div className="text-xs text-surface-400 mt-0.5">eBay listing is unchanged. Store orders and inventory show up after Shopify is connected.</div>
      </div>
      <a href="/settings#shopify" className="btn btn-secondary btn-sm flex-shrink-0">Shopify settings</a>
    </div>
  );
}

function ReconnectBanner() {
  return (
    <div className="panel flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 border-primary-500/30 bg-primary-500/[0.07]">
      <div className="text-sm">
        <div className="font-medium text-white">Sign in with eBay once more to turn on sales numbers</div>
        <div className="text-xs text-surface-400 mt-0.5">
          The dashboard needs read-only access to your eBay orders. Listing keeps working either way.
        </div>
      </div>
      <a href="/api/ebay/connect" className="btn btn-primary btn-sm flex-shrink-0">Reconnect eBay</a>
    </div>
  );
}

function ConnectBanner({ state }: { state: 'not_configured' | 'not_connected' }) {
  return (
    <div className="panel px-5 py-5 text-sm">
      <div className="font-medium text-white">
        {state === 'not_configured' ? 'eBay is not set up on this server yet' : 'Connect eBay to see your sales'}
      </div>
      <p className="mt-1 text-surface-400">
        {state === 'not_configured'
          ? 'Sales, shipping, and listing numbers appear here once the eBay keys are added on Render.'
          : 'Sign in with eBay to see sales, earnings, orders to ship, and live listings here.'}
      </p>
      {state === 'not_connected' && (
        <a href="/api/ebay/connect" className="btn btn-primary btn-sm mt-3">Sign in with eBay</a>
      )}
    </div>
  );
}
