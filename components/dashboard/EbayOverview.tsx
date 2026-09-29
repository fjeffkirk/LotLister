'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AdBudgetEntry,
  DashboardChannel,
  DashboardData,
  DashboardSection,
  RangeStats,
  ShopifyData,
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
    if (savedChannel === 'all' || savedChannel === 'ebay' || savedChannel === 'shopify') setChannel(savedChannel);
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
  const stats: RangeStats | null = sales?.focus ?? (sales ? sales.ranges['30'] : null);
  const periodLabel = range === 'custom' && customFrom && customTo ? `${customFrom} – ${customTo}` : range === 'custom' ? 'Today' : PRESET_LABELS[range];
  const shopRange = shopify?.focus ?? shopify?.ranges['30'] ?? null;
  const needsReconnect = [data?.sales, data?.shipping, data?.listings].some((s) => s?.status === 'reconnect');
  const busy = loading;
  const showEbayConnect = Boolean(data && data.state !== 'ok' && !shopifyReady && channel !== 'shopify');

  const combinedSales = (stats?.summary.gross ?? 0) + (shopRange?.revenue ?? 0);
  const combinedNet = (stats?.summary.net ?? 0) + (shopRange?.net ?? 0);
  const combinedOrders = (stats?.summary.orders ?? 0) + (shopRange?.orders ?? 0);
  const combinedUnits = (stats?.summary.units ?? 0) + (shopRange?.units ?? 0);
  const combinedDaily = mergeDaily(stats?.summary.daily, shopRange?.daily);
  const toShip = (shipping?.orders ?? 0) + (shopify?.unfulfilled ?? 0);
  const overdue = (shipping?.overdue ?? 0) + (shopify?.overdue ?? 0);

  const liveLabel =
    channel === 'shopify'
      ? `Live from Shopify${shopify?.shop ? ` · ${shopify.shop}` : ''}`
      : channel === 'ebay'
        ? `Live from eBay${data?.account ? ` · ${data.account}` : ''}`
        : `eBay + Shopify${data?.account || shopify?.shop ? ` · ${[data?.account, shopify?.shop].filter(Boolean).join(' · ')}` : ''}`;

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

      {channel !== 'ebay' && (
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

      {needsReconnect && channel !== 'shopify' && <ReconnectBanner />}
      {showEbayConnect && data && (data.state === 'not_configured' || data.state === 'not_connected') && (
        <ConnectBanner state={data.state} />
      )}
      {channel !== 'ebay' && data?.shopify?.status === 'ok' && shopify?.state === 'not_configured' && <ShopifyConnectBanner />}
      {channel !== 'ebay' && data?.shopify?.status === 'error' && (
        <div className="panel px-4 py-3 text-sm text-surface-400">{data.shopify.message}</div>
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
              footer={stats && stats.summary.gross > 0 ? <Sparkline values={stats.summary.daily} /> : null}
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
              title="Sales minus eBay fees and refunds. Promoted listing ads are not included."
              footer={stats && stats.summary.units > 0 ? <FootNote>{money(stats.summary.avgItemPrice)} avg per card</FootNote> : null}
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
              title="Shopify order totals for the range, excluding draft orders."
              footer={shopRange && shopRange.revenue > 0 ? <Sparkline values={shopRange.daily} /> : null}
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
              sub={shopRange ? `after ${money(shopRange.adSpend)} ads` : null}
              title="Line profit minus ads and estimated free-shipping cost."
              footer={shopRange && shopRange.orders > 0 ? <FootNote>{money(shopRange.aov)} AOV</FootNote> : null}
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
              title="eBay sales (item + shipping) plus Shopify order totals."
              footer={combinedSales > 0 ? <Sparkline values={combinedDaily} /> : null}
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
              sub="eBay after fees + Shopify after ads"
              title="eBay net (after marketplace fees) plus Shopify estimated profit (after ads)."
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
          <div className="mt-3 text-2xl sm:text-[28px] font-semibold tracking-tight text-white tabular-nums truncate">{value}</div>
          {sub && <p className="mt-0.5 text-xs text-surface-400 truncate">{sub}</p>}
          {footer && <div className="mt-auto pt-3">{footer}</div>}
        </>
      )}
    </div>
  );
}

function FootNote({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <p className={`text-[11px] ${tone === 'danger' ? 'text-red-300' : 'text-surface-500'} truncate`}>{children}</p>
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

  function openEditor() {
    setDate(new Date().toLocaleDateString('en-CA'));
    setAmount(dailyBudget != null ? String(dailyBudget) : '');
    setError(null);
    setOpen(true);
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
        <span className="text-surface-400">Ad spend</span>
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
            Effective date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block" />
          </label>
          <label className="text-xs text-surface-400">
            Daily amount
            <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 block" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn btn-primary btn-sm">{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">Cancel</button>
          </div>
          <p className="sm:col-span-3 text-[11px] text-surface-500">
            This amount carries forward from the date you pick until you change it. To fill a 7D or 30D view, set a date at the start of that period.
          </p>
          {error && <p className="sm:col-span-3 text-xs text-red-300">{error}</p>}
          {entries.length > 0 && (
            <ul className="sm:col-span-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-surface-500">
              {entries.slice(0, 6).map((entry) => (
                <li key={entry.date} className="tabular-nums">{entry.date} · {money(entry.amount)}</li>
              ))}
            </ul>
          )}
        </form>
      )}
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
