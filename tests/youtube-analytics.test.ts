import { describe, expect, it } from 'vitest';
import { YOUTUBE_ANALYTICS_SCOPE, YOUTUBE_SCOPES, hasAnalyticsScope } from '../lib/youtube/config';
import {
  analyticsDateRange,
  analyticsQueries,
  buildAnalyticsReport,
  eachDate,
  explainAnalyticsHttp,
  tableRows,
} from '../lib/youtube/analytics';
import { assertGrantedScopes } from '../lib/youtube/oauth';

const NOW = new Date('2026-10-13T16:00:00.000Z');
const CHANNEL = 'UCaiChannelExample1234567';

describe('YouTube analytics reports', () => {
  it('requests the read-only analytics scope and leaves revenue out of the consent screen', () => {
    expect(YOUTUBE_SCOPES).toContain(YOUTUBE_ANALYTICS_SCOPE);
    expect(YOUTUBE_SCOPES.join(' ')).not.toContain('yt-analytics-monetary.readonly');
    expect(hasAnalyticsScope(`https://www.googleapis.com/auth/youtube.readonly ${YOUTUBE_ANALYTICS_SCOPE}`)).toBe(true);
    expect(hasAnalyticsScope('https://www.googleapis.com/auth/youtube.upload')).toBe(false);
  });

  it('keeps an upload token usable when analytics has not been granted yet', () => {
    expect(() => assertGrantedScopes([
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/youtube.readonly',
    ].join(' '))).not.toThrow();
    expect(() => assertGrantedScopes('https://www.googleapis.com/auth/youtube.readonly')).toThrow(/Reconnect/);
  });

  it('ends the range on the previous UTC day and rejects other lengths', () => {
    expect(analyticsDateRange(28, NOW)).toEqual({ startDate: '2026-09-15', endDate: '2026-10-12', days: 28 });
    expect(analyticsDateRange(7, NOW).startDate).toBe('2026-10-06');
    expect(() => analyticsDateRange(30, NOW)).toThrow(/7, 28, or 90/);
    expect(eachDate('2026-10-10', '2026-10-12')).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
  });

  it('queries the selected channel and does not ask for monetary metrics', () => {
    const queries = analyticsQueries(CHANNEL, analyticsDateRange(7, NOW));
    for (const query of Object.values(queries)) {
      expect(query.ids).toBe(`channel==${CHANNEL}`);
      expect(query.metrics).not.toMatch(/[Rr]evenue|cpm/);
      expect(query.ids).not.toContain('MINE');
    }
    expect(() => analyticsQueries('UC-other', analyticsDateRange(7, NOW))).toThrow(/channel id/);
    expect(queries.daily.dimensions).toBe('day');
    expect(queries.videos.sort).toBe('-views');
  });

  it('preserves zero-view days and uses the returned video title', () => {
    const range = analyticsDateRange(7, new Date('2026-10-08T12:00:00.000Z'));
    const report = buildAnalyticsReport({
      range,
      totals: {
        columnHeaders: [
          { name: 'views' },
          { name: 'estimatedMinutesWatched' },
          { name: 'averageViewDuration' },
          { name: 'averageViewPercentage' },
          { name: 'likes' },
          { name: 'comments' },
          { name: 'subscribersGained' },
          { name: 'subscribersLost' },
        ],
        rows: [[120, 90, 45, 32.5, 8, 2, 5, 1]],
      },
      daily: {
        columnHeaders: [{ name: 'day' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'subscribersGained' }],
        rows: [['2026-10-05', 40, 20, 2]],
      },
      videos: {
        columnHeaders: [{ name: 'video' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'averageViewDuration' }, { name: 'likes' }],
        rows: [['abcdefghijk', 40, 20, 30, 3]],
      },
      countries: {
        columnHeaders: [{ name: 'country' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }],
        rows: [['US', 30, 15]],
      },
      titles: { abcdefghijk: 'Shop update' },
    });
    expect(report.totals.netSubscribers).toBe(4);
    expect(report.totals.views).toBe(120);
    expect(report.daily).toHaveLength(7);
    expect(report.daily.find((day) => day.date === '2026-10-05')?.views).toBe(40);
    expect(report.daily.find((day) => day.date === '2026-10-04')?.views).toBe(0);
    expect(report.videos[0]).toMatchObject({ title: 'Shop update', views: 40 });
    expect(report.countries[0].countryName).toBe('United States');
    expect(tableRows({ columnHeaders: [{ name: 'views' }], rows: undefined })).toEqual([]);
  });

  it('turns a missing analytics permission and a disabled API into actionable errors', () => {
    const scope = explainAnalyticsHttp(403, JSON.stringify({
      error: { status: 'PERMISSION_DENIED', message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] },
    }));
    expect(scope.code).toBe('analytics_scope_required');
    const disabled = explainAnalyticsHttp(403, JSON.stringify({
      error: { status: 'PERMISSION_DENIED', message: 'YouTube Analytics API has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] },
    }));
    expect(disabled.code).toBe('analytics_api_disabled');
    expect(explainAnalyticsHttp(401, '{"error":"invalid_grant"}').code).toBe('reconnect_required');
  });
});
