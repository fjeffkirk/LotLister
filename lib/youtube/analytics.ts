import { YOUTUBE_ANALYTICS_SCOPE, hasAnalyticsScope } from './config';
import { getValidAccessToken, listConnections, type PublicConnection } from './connections';
import { parseGoogleError, redactSecrets } from './policy';
import { YoutubeUserError } from './types';

const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';
const DATA_API = 'https://www.googleapis.com/youtube/v3';

export const ANALYTICS_RANGES = [7, 28, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

const TOTAL_METRICS = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,subscribersGained,subscribersLost';
const DAILY_METRICS = 'views,estimatedMinutesWatched,subscribersGained';
const VIDEO_METRICS = 'views,estimatedMinutesWatched,averageViewDuration,likes';
const COUNTRY_METRICS = 'views,estimatedMinutesWatched';

const CHANNEL_ID = /^UC[0-9A-Za-z_-]{16,32}$/;

export interface AnalyticsDateRange {
  startDate: string;
  endDate: string;
  days: AnalyticsRange;
}

export interface AnalyticsReport {
  range: AnalyticsDateRange;
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
  videos: Array<{
    videoId: string;
    title: string;
    views: number;
    watchTimeMinutes: number;
    averageViewDurationSeconds: number;
    likes: number;
  }>;
  countries: Array<{ country: string; countryName: string; views: number; watchTimeMinutes: number }>;
}

export type AnalyticsView =
  | { state: 'empty'; connections: PublicConnection[] }
  | { state: 'reconnect'; connection: PublicConnection; connections: PublicConnection[]; message: string }
  | { state: 'needs_scope'; connection: PublicConnection; connections: PublicConnection[] }
  | { state: 'unavailable'; connection: PublicConnection; connections: PublicConnection[]; message: string }
  | { state: 'ready'; connection: PublicConnection; connections: PublicConnection[]; report: AnalyticsReport };

interface ResultTable {
  columnHeaders?: Array<{ name?: string }>;
  rows?: unknown[][];
}

export function analyticsDateRange(days: number, now = new Date()): AnalyticsDateRange {
  if (!ANALYTICS_RANGES.includes(days as AnalyticsRange)) {
    throw new YoutubeUserError('invalid_range', 'Choose 7, 28, or 90 days.');
  }
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    startDate: isoDate(start),
    endDate: isoDate(end),
    days: days as AnalyticsRange,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function assertAnalyticsChannelId(channelId: string): string {
  if (!CHANNEL_ID.test(channelId)) {
    throw new YoutubeUserError('invalid_channel', 'This connection does not have a usable YouTube channel id.');
  }
  return channelId;
}

export function analyticsQueries(channelId: string, range: AnalyticsDateRange): Record<'totals' | 'daily' | 'videos' | 'countries', Record<string, string>> {
  const ids = `channel==${assertAnalyticsChannelId(channelId)}`;
  const window = { ids, startDate: range.startDate, endDate: range.endDate };
  return {
    totals: { ...window, metrics: TOTAL_METRICS },
    daily: { ...window, metrics: DAILY_METRICS, dimensions: 'day', sort: 'day' },
    videos: { ...window, metrics: VIDEO_METRICS, dimensions: 'video', sort: '-views', maxResults: '10' },
    countries: { ...window, metrics: COUNTRY_METRICS, dimensions: 'country', sort: '-views', maxResults: '8' },
  };
}

export function tableRows(table: ResultTable | null | undefined): Array<Record<string, string | number>> {
  const headers = (table?.columnHeaders ?? []).map((header) => header.name || '');
  return (table?.rows ?? []).map((row) => {
    const record: Record<string, string | number> = {};
    headers.forEach((name, index) => {
      if (!name) return;
      const value = row[index];
      if (typeof value === 'number' && Number.isFinite(value)) record[name] = value;
      else if (typeof value === 'string') record[name] = value;
      else record[name] = 0;
    });
    return record;
  });
}

function num(row: Record<string, string | number> | undefined, key: string): number {
  const value = row?.[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

export function eachDate(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return dates;
  while (cursor <= end && dates.length < 400) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function buildAnalyticsReport(input: {
  range: AnalyticsDateRange;
  totals: ResultTable;
  daily: ResultTable;
  videos: ResultTable;
  countries: ResultTable;
  titles: Record<string, string>;
}): AnalyticsReport {
  const total = tableRows(input.totals)[0];
  const gained = num(total, 'subscribersGained');
  const lost = num(total, 'subscribersLost');
  const byDay = new Map(tableRows(input.daily).map((row) => [String(row.day ?? ''), row]));
  const daily = eachDate(input.range.startDate, input.range.endDate).map((date) => {
    const row = byDay.get(date);
    return {
      date,
      views: num(row, 'views'),
      watchTimeMinutes: num(row, 'estimatedMinutesWatched'),
      subscribersGained: num(row, 'subscribersGained'),
    };
  });
  const videos = tableRows(input.videos).map((row) => {
    const videoId = String(row.video ?? '');
    return {
      videoId,
      title: input.titles[videoId] || videoId,
      views: num(row, 'views'),
      watchTimeMinutes: num(row, 'estimatedMinutesWatched'),
      averageViewDurationSeconds: num(row, 'averageViewDuration'),
      likes: num(row, 'likes'),
    };
  }).filter((video) => video.videoId);
  const countries = tableRows(input.countries).map((row) => {
    const country = String(row.country ?? '');
    return {
      country,
      countryName: countryName(country),
      views: num(row, 'views'),
      watchTimeMinutes: num(row, 'estimatedMinutesWatched'),
    };
  }).filter((country) => country.country);
  return {
    range: input.range,
    totals: {
      views: num(total, 'views'),
      watchTimeMinutes: num(total, 'estimatedMinutesWatched'),
      averageViewDurationSeconds: num(total, 'averageViewDuration'),
      averageViewPercentage: num(total, 'averageViewPercentage'),
      likes: num(total, 'likes'),
      comments: num(total, 'comments'),
      subscribersGained: gained,
      subscribersLost: lost,
      netSubscribers: gained - lost,
    },
    daily,
    videos,
    countries,
  };
}

export function explainAnalyticsHttp(status: number, body: string): YoutubeUserError {
  const parsed = parseGoogleError(status, body);
  const raw = `${parsed.reason} ${body}`.toLowerCase();
  if (status === 401 || parsed.kind === 'reconnect_required') {
    return new YoutubeUserError('reconnect_required', 'YouTube refused the access token. Reconnect this channel in settings.');
  }
  if (raw.includes('accessnotconfigured') || raw.includes('service_disabled') || raw.includes('youtubeanalytics.googleapis.com')) {
    return new YoutubeUserError(
      'analytics_api_disabled',
      'Enable the YouTube Analytics API on the same Google Cloud project as the OAuth client, then reload this tab.',
    );
  }
  if (status === 403 || raw.includes('insufficient') || raw.includes('access_token_scope')) {
    return new YoutubeUserError(
      'analytics_scope_required',
      `Reconnect this channel and accept ${YOUTUBE_ANALYTICS_SCOPE}. The current connection can upload, and it cannot read Analytics yet.`,
    );
  }
  return new YoutubeUserError(parsed.reason || 'youtube_error', redactSecrets(parsed.message));
}

async function authed(url: string, token: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'manual',
    cache: 'no-store',
  });
  if (response.status >= 300 && response.status < 400) {
    throw new YoutubeUserError('upstream_redirect', 'YouTube returned a redirect. The access token was not forwarded.');
  }
  return response;
}

async function queryReport(token: string, params: Record<string, string>): Promise<ResultTable> {
  const url = new URL(ANALYTICS_API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await authed(url.toString(), token);
  const text = await response.text();
  if (!response.ok) throw explainAnalyticsHttp(response.status, text);
  return JSON.parse(text) as ResultTable;
}

async function videoTitles(token: string, videoIds: string[]): Promise<Record<string, string>> {
  const ids = videoIds.filter((id) => /^[\w-]{6,20}$/.test(id));
  if (ids.length === 0) return {};
  const url = `${DATA_API}/videos?part=snippet&id=${encodeURIComponent(ids.join(','))}`;
  const response = await authed(url, token);
  if (!response.ok) return {};
  const body = await response.json() as { items?: Array<{ id?: string; snippet?: { title?: string } }> };
  const titles: Record<string, string> = {};
  for (const item of body.items ?? []) {
    if (item.id && item.snippet?.title) titles[item.id] = item.snippet.title;
  }
  return titles;
}

export async function loadYoutubeAnalytics(accountId: string, connectionId: string | null, days: number, now = new Date()): Promise<AnalyticsView> {
  const connections = await listConnections(accountId);
  if (connections.length === 0) return { state: 'empty', connections };
  const requested = connectionId
    ? connections.find((connection) => connection.connectionId === connectionId)
    : undefined;
  const selected = requested
    ?? connections.find((connection) => connection.status === 'connected')
    ?? connections[0];
  if (!selected) {
    throw new YoutubeUserError('not_found', 'No YouTube connection with that id belongs to this account.');
  }
  if (selected.status !== 'connected') {
    return {
      state: 'reconnect',
      connection: selected,
      connections,
      message: selected.statusDetail || 'Reconnect this YouTube channel in settings.',
    };
  }
  if (!hasAnalyticsScope(selected.scopes.join(' '))) {
    return { state: 'needs_scope', connection: selected, connections };
  }

  const range = analyticsDateRange(days, now);
  const queries = analyticsQueries(selected.channelId, range);
  try {
    const token = await getValidAccessToken(accountId, selected.connectionId);
    const [totals, daily, videos, countries] = await Promise.all([
      queryReport(token, queries.totals),
      queryReport(token, queries.daily),
      queryReport(token, queries.videos),
      queryReport(token, queries.countries),
    ]);
    const ids = tableRows(videos).map((row) => String(row.video ?? '')).filter(Boolean);
    const titles = await videoTitles(token, ids);
    return {
      state: 'ready',
      connection: selected,
      connections,
      report: buildAnalyticsReport({ range, totals, daily, videos, countries, titles }),
    };
  } catch (error) {
    if (error instanceof YoutubeUserError && error.code === 'analytics_scope_required') {
      return { state: 'needs_scope', connection: selected, connections };
    }
    if (error instanceof YoutubeUserError && error.code === 'analytics_api_disabled') {
      return { state: 'unavailable', connection: selected, connections, message: error.message };
    }
    if (error instanceof YoutubeUserError && error.code === 'reconnect_required') {
      return { state: 'reconnect', connection: selected, connections, message: error.message };
    }
    throw error;
  }
}
