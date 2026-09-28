'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DASHBOARD_RANGES,
  DashboardData,
  DashboardRange,
  DashboardSection,
  RangeStats,
} from '../../lib/dashboard-types';
import {
  AlertIcon,
  ExternalIcon,
  RotateIcon,
  TagIcon,
  TrendIcon,
  TrophyIcon,
  TruckIcon,
  WalletIcon,
} from '../ui/icons';

const RANGE_STORAGE_KEY = 'lotlister.dashboardRange';
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
  const [range, setRange] = useState<DashboardRange>(30);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(RANGE_STORAGE_KEY));
    if ((DASHBOARD_RANGES as readonly number[]).includes(saved)) setRange(saved as DashboardRange);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const res = await fetch(`/api/dashboard?tz=${new Date().getTimezoneOffset()}`, { cache: 'no-store' });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Could not load eBay data');
      setData(body.data as DashboardData);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Could not load eBay data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function chooseRange(next: DashboardRange) {
    setRange(next);
    window.localStorage.setItem(RANGE_STORAGE_KEY, String(next));
  }

  if (data && data.state !== 'ok') {
    return <ConnectBanner state={data.state} />;
  }

  const sales = sectionData(data?.sales);
  const shipping = sectionData(data?.shipping);
  const listings = sectionData(data?.listings);
  const stats: RangeStats | null = sales ? sales.ranges[`${range}`] : null;
  const needsReconnect = [data?.sales, data?.shipping, data?.listings].some((s) => s?.status === 'reconnect');
  const busy = loading && !data;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-sm text-surface-400">
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 ${loading ? 'animate-ping' : ''}`} />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span>
            Live from eBay{data?.account ? <> · <span className="text-surface-200">{data.account}</span></> : null}
          </span>
          {data && (
            <span className="hidden sm:inline text-surface-500">
              · Updated {new Date(data.fetchedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="btn btn-ghost btn-icon btn-sm -ml-1"
            aria-label="Refresh eBay numbers"
            title="Refresh"
          >
            <RotateIcon size={14} className={loading ? 'animate-spin [animation-direction:reverse]' : ''} />
          </button>
        </div>
        <RangeToggle value={range} onChange={chooseRange} />
      </div>

      {failed && !data && (
        <div className="panel flex items-center justify-between gap-4 px-4 py-3 text-sm text-red-200 border-red-500/30 bg-red-500/10">
          <span className="flex items-center gap-2"><AlertIcon size={15} /> {failed}</span>
          <button onClick={load} className="btn btn-secondary btn-sm">Try again</button>
        </div>
      )}

      {needsReconnect && <ReconnectBanner />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricTile
          icon={<TrendIcon size={16} />}
          tone="primary"
          label="Sales"
          suffix={`${range}d`}
          loading={busy}
          section={data?.sales}
          value={stats ? money(stats.summary.gross) : null}
          sub={stats ? `${plural(stats.summary.orders, 'order')} · ${plural(stats.summary.units, 'card')}` : null}
          href={SELLER_HUB.orders}
          title="Item price plus shipping the buyer paid, before sales tax. Canceled and fully refunded orders are left out."
          footer={stats && stats.summary.gross > 0 ? <Sparkline values={stats.summary.daily} /> : null}
        />
        <MetricTile
          icon={<WalletIcon size={16} />}
          tone="emerald"
          label="Net earnings"
          shortLabel="Net"
          suffix={`${range}d`}
          loading={busy}
          section={data?.sales}
          value={stats ? money(stats.summary.net) : null}
          sub={
            stats
              ? `after ${money(stats.summary.fees)} eBay fees${stats.summary.refunds > 0 ? ` · ${money(stats.summary.refunds)} refunded` : ''}`
              : null
          }
          title="Sales minus eBay's final value and per-order fees and any refunds. Promoted listing ad fees and shipping labels are not included."
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
          sub={
            shipping
              ? shipping.orders === 0
                ? 'All caught up'
                : `${plural(shipping.units, 'card')} to pack`
              : null
          }
          href={SELLER_HUB.awaiting}
          footer={
            shipping && shipping.orders > 0 ? (
              shipping.overdue > 0 ? (
                <FootNote tone="danger">{plural(shipping.overdue, 'order')} past ship-by date</FootNote>
              ) : shipping.nextShipBy ? (
                <FootNote>
                  Next ship by {new Date(shipping.nextShipBy).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </FootNote>
              ) : null
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
          title="Live listings at their current price (current bid for auctions)."
          footer={listings && listings.scheduled > 0 ? <FootNote>{listings.scheduled.toLocaleString()} scheduled to start</FootNote> : null}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
        <TopPlayers
          className="lg:col-span-3"
          range={range}
          loading={busy}
          section={data?.sales}
          stats={stats}
          pendingLookups={sales?.pendingLookups ?? 0}
        />
        <RecentSales className="lg:col-span-2" loading={busy} section={data?.sales} />
      </div>
    </section>
  );
}

function RangeToggle({ value, onChange }: { value: DashboardRange; onChange: (range: DashboardRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
      {DASHBOARD_RANGES.map((days) => (
        <button
          key={days}
          role="radio"
          aria-checked={value === days}
          onClick={() => onChange(days)}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            value === days ? 'bg-white/[0.1] text-white shadow-sm' : 'text-surface-400 hover:text-surface-100'
          }`}
        >
          {days} days
        </button>
      ))}
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
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-surface-500 hover:text-surface-200 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            aria-label={`Open ${label} in eBay Seller Hub`}
            title="Open in eBay Seller Hub"
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
  range,
  loading,
  section,
  stats,
  pendingLookups,
}: {
  className?: string;
  range: DashboardRange;
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
      aside={<span className="text-xs text-surface-500">Last {range} days</span>}
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
            : `No sales in the last ${range} days yet.`}
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
