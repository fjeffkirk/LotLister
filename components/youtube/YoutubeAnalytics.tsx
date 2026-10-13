'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface Connection {
  connectionId: string;
  channelId: string;
  channelTitle: string;
  channelHandle: string | null;
  status: string;
}

interface Report {
  range: { startDate: string; endDate: string; days: number };
  totals: {
    views: number;
    watchTimeMinutes: number;
    averageViewDurationSeconds: number;
    averageViewPercentage: number;
    likes: number;
    comments: number;
    subscribersGained: number;
    subscribersLost: number;
    netSubscribers: number;
  };
  daily: Array<{ date: string; views: number; watchTimeMinutes: number; subscribersGained: number }>;
  videos: Array<{ videoId: string; title: string; views: number; watchTimeMinutes: number; averageViewDurationSeconds: number; likes: number }>;
  countries: Array<{ country: string; countryName: string; views: number; watchTimeMinutes: number }>;
}

type View =
  | { state: 'empty'; connections: Connection[] }
  | { state: 'reconnect'; connection: Connection; connections: Connection[]; message: string }
  | { state: 'needs_scope'; connection: Connection; connections: Connection[] }
  | { state: 'unavailable'; connection: Connection; connections: Connection[]; message: string }
  | { state: 'ready'; connection: Connection; connections: Connection[]; report: Report };

const RANGES = [7, 28, 90] as const;
const STORAGE_KEY = 'lotlister.youtubeConnection';
const numberFormat = new Intl.NumberFormat('en-US');

function formatCount(value: number): string {
  return numberFormat.format(Math.round(value));
}

function formatWatchTime(minutes: number): string {
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return hours < 100 ? `${hours.toFixed(1)} hr` : `${formatCount(hours)} hr`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, '0')}`;
}

function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function YoutubeAnalytics() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(28);
  const [connectionId, setConnectionId] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const load = useCallback(async (nextId: string, nextDays: number) => {
    const ticket = ++requestId.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(nextDays) });
    if (nextId) params.set('connectionId', nextId);
    try {
      const response = await fetch(`/api/youtube/analytics?${params}`, { cache: 'no-store' });
      const body = await response.json();
      if (ticket !== requestId.current) return;
      if (!response.ok || !body.success) throw new Error(body.error || 'Could not load YouTube analytics');
      const data = body.data as View;
      setView(data);
      if (data.state !== 'empty' && data.connection.connectionId !== nextId) {
        setConnectionId(data.connection.connectionId);
        window.localStorage.setItem(STORAGE_KEY, data.connection.connectionId);
      }
    } catch (err) {
      if (ticket !== requestId.current) return;
      setError(err instanceof Error ? err.message : 'Could not load YouTube analytics');
    } finally {
      if (ticket === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) || '';
    setConnectionId(stored);
    load(stored, 28).catch(() => undefined);
  }, [load]);

  function chooseConnection(id: string) {
    setConnectionId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
    load(id, days).catch(() => undefined);
  }

  function chooseRange(next: (typeof RANGES)[number]) {
    setDays(next);
    load(connectionId, next).catch(() => undefined);
  }

  const connections = view?.connections ?? [];
  const selected = view && view.state !== 'empty' ? view.connection : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">YouTube</h1>
          <p className="mt-1 text-sm text-surface-400">
            {selected
              ? `${selected.channelTitle}${selected.channelHandle ? ` · ${selected.channelHandle}` : ''} · ${selected.channelId}`
              : 'Views, watch time, and subscribers for a channel you connected.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connections.length > 1 && (
            <label className="text-xs text-surface-400">
              <span className="sr-only">Channel</span>
              <select
                value={selected?.connectionId || connectionId}
                onChange={(event) => chooseConnection(event.target.value)}
                className="h-8 text-xs"
                aria-label="YouTube channel"
              >
                {connections.map((connection) => (
                  <option key={connection.connectionId} value={connection.connectionId}>
                    {connection.channelTitle}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                role="radio"
                aria-checked={days === range}
                onClick={() => chooseRange(range)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === range ? 'bg-white/[0.1] text-white shadow-sm' : 'text-surface-400 hover:text-surface-100'
                }`}
              >
                {range}D
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="panel px-4 py-3 text-sm text-red-200 border-red-500/30 bg-red-500/10">{error}</div>}
      {loading && !view && <div className="panel p-10 text-center text-sm text-surface-500">Loading channel analytics…</div>}

      {view?.state === 'empty' && (
        <div className="panel p-10 text-center space-y-3">
          <p className="text-sm text-surface-300">No YouTube channel is connected to this LotLister account.</p>
          <Link href="/settings#youtube" className="btn btn-primary btn-sm inline-flex">Connect a channel</Link>
        </div>
      )}

      {view?.state === 'reconnect' && (
        <Notice
          text={view.message}
          actionHref="/api/youtube/connect"
          action="Reconnect YouTube"
        />
      )}

      {view?.state === 'needs_scope' && (
        <Notice
          text={`${view.connection.channelTitle} is connected for uploads. Reconnect it and accept the YouTube Analytics permission before this tab can read views and watch time.`}
          actionHref="/api/youtube/connect"
          action="Grant analytics access"
        />
      )}

      {view?.state === 'unavailable' && <Notice text={view.message} actionHref="/settings#youtube" action="YouTube settings" />}

      {view?.state === 'ready' && <ReportView report={view.report} channelId={view.connection.channelId} loading={loading} />}
    </div>
  );
}

function Notice({ text, actionHref, action }: { text: string; actionHref: string; action: string }) {
  return (
    <div className="panel p-6 sm:p-8 space-y-4">
      <p className="text-sm text-surface-200 leading-6">{text}</p>
      <a href={actionHref} className="btn btn-primary btn-sm inline-flex">{action}</a>
    </div>
  );
}

function ReportView({ report, channelId, loading }: { report: Report; channelId: string; loading: boolean }) {
  const maxViews = Math.max(1, ...report.daily.map((day) => day.views));
  const cards = [
    { label: 'Views', value: formatCount(report.totals.views) },
    { label: 'Watch time', value: formatWatchTime(report.totals.watchTimeMinutes) },
    { label: 'Avg view', value: formatDuration(report.totals.averageViewDurationSeconds), hint: `${report.totals.averageViewPercentage.toFixed(1)}% of the video` },
    { label: 'Subscribers', value: `${report.totals.netSubscribers >= 0 ? '+' : ''}${formatCount(report.totals.netSubscribers)}`, hint: `${formatCount(report.totals.subscribersGained)} gained · ${formatCount(report.totals.subscribersLost)} lost` },
    { label: 'Likes', value: formatCount(report.totals.likes) },
    { label: 'Comments', value: formatCount(report.totals.comments) },
  ];

  return (
    <div className={`space-y-6 ${loading ? 'opacity-60' : ''}`}>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="panel px-4 py-3">
            <div className="text-xs text-surface-400">{card.label}</div>
            <div className="mt-1 text-xl font-semibold text-white tabular-nums">{card.value}</div>
            {card.hint && <div className="mt-1 text-xs text-surface-500">{card.hint}</div>}
          </div>
        ))}
      </div>

      <section className="panel p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h2 className="text-sm font-semibold text-white">Views by day</h2>
          <p className="text-xs text-surface-500">{formatDay(report.range.startDate)} – {formatDay(report.range.endDate)} UTC</p>
        </div>
        <div className="flex items-end gap-1 h-36" role="img" aria-label={`Daily views from ${report.range.startDate} to ${report.range.endDate}`}>
          {report.daily.map((day) => (
            <div key={day.date} className="flex-1 min-w-0 h-full flex items-end" title={`${formatDay(day.date)}: ${formatCount(day.views)} views, ${formatWatchTime(day.watchTimeMinutes)} watch time`}>
              <div
                className="w-full rounded-sm bg-primary-400/80"
                style={{ height: `${Math.max(day.views > 0 ? 4 : 0, (day.views / maxViews) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-surface-500">
          <span>{formatDay(report.range.startDate)}</span>
          <span>{formatDay(report.range.endDate)}</span>
        </div>
      </section>

      <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)] gap-4">
        <section className="panel overflow-hidden">
          <h2 className="px-4 py-3 text-sm font-semibold text-white border-b border-white/[0.06]">Top videos</h2>
          {report.videos.length === 0 ? (
            <p className="px-4 py-6 text-sm text-surface-500">No video views in this range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-surface-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Video</th>
                  <th className="px-4 py-2 font-medium text-right">Views</th>
                  <th className="px-4 py-2 font-medium text-right hidden sm:table-cell">Watch time</th>
                  <th className="px-4 py-2 font-medium text-right hidden sm:table-cell">Avg</th>
                </tr>
              </thead>
              <tbody>
                {report.videos.map((video) => (
                  <tr key={video.videoId} className="border-t border-white/[0.04]">
                    <td className="px-4 py-3">
                      <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`} target="_blank" rel="noreferrer" className="text-white hover:text-primary-200">
                        {video.title}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-200">{formatCount(video.views)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-300 hidden sm:table-cell">{formatWatchTime(video.watchTimeMinutes)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-300 hidden sm:table-cell">{formatDuration(video.averageViewDurationSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel overflow-hidden">
          <h2 className="px-4 py-3 text-sm font-semibold text-white border-b border-white/[0.06]">Countries</h2>
          {report.countries.length === 0 ? (
            <p className="px-4 py-6 text-sm text-surface-500">No country data in this range.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {report.countries.map((country) => (
                  <tr key={country.country} className="border-t border-white/[0.04] first:border-t-0">
                    <td className="px-4 py-2.5 text-surface-200">{country.countryName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-white">{formatCount(country.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <p className="text-xs text-surface-500 leading-5">
        Numbers come from the YouTube Analytics API for channel {channelId}. The range ends yesterday because YouTube finishes a day after the fact, and it can still omit the newest days. Estimated revenue is not included.
        {' '}
        <a href={`https://studio.youtube.com/channel/${encodeURIComponent(channelId)}/analytics`} className="text-primary-300 hover:text-white" target="_blank" rel="noreferrer">
          Compare in YouTube Studio
        </a>
      </p>
    </div>
  );
}
