import { describe, expect, it } from 'vitest';
import { createTiktokClient } from '../lib/tiktok/api';
import { decryptString, encryptString, sealState, openState } from '../lib/tiktok/oauth';
import {
  assessDailyBudget,
  assertAdvertiser,
  assertBoxBuddy,
  assertRoutineChange,
  capability,
  decideIdempotency,
  redactSecrets,
  reserveDailyBudget,
  safetyPause,
  sparkPostStatus,
} from '../lib/tiktok/policy';
import { assertReportWindow, normalizeAuctionReport, normalizeGmvMaxReport } from '../lib/tiktok/reporting';

const key = Buffer.alloc(32, 7);

describe('TikTok budget policy', () => {
  it('does not raise a budget below the TikTok minimum', () => {
    const result = assessDailyBudget({ requestedDailyUsd: 15, currency: 'USD' });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('below_minimum');
    expect(result.requestedDailyUsd).toBe(15);
    expect(result.averageDailyUsd).toBeNull();
  });

  it('blocks a $20 dynamic budget until the 125% peak is authorized', () => {
    const blocked = assessDailyBudget({ requestedDailyUsd: 20, currency: 'USD', peakSpendAuthorizedUsd: null });
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe('peak_not_authorized');
    expect(blocked.averageDailyUsd).toBe(20);
    expect(blocked.peakDailyUsd).toBe(25);
    expect(blocked.weeklyCeilingUsd).toBe(140);
    expect(blocked.hardDailyCap).toBe(false);

    const allowed = assessDailyBudget({
      requestedDailyUsd: 20,
      currency: 'USD',
      peakSpendAuthorizedUsd: 25,
      authorizedDailyUsd: 20,
      managedDailyUsd: 0,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.averageDailyUsd).toBe(20);
    expect(allowed.hardDailyCap).toBe(false);
  });

  it('rejects a second reservation that would pass the authorized total', () => {
    expect(reserveDailyBudget(0, 20, 20)).toBe(20);
    expect(reserveDailyBudget(20, 20, 20)).toBeNull();
  });

  it('blocks a non-USD advertiser instead of converting the budget', () => {
    expect(assessDailyBudget({ requestedDailyUsd: 20, currency: 'EUR', peakSpendAuthorizedUsd: 25 }).code).toBe('currency');
  });
});

describe('TikTok authorization boundaries', () => {
  const policy = {
    advertiserId: '100',
    emergencyPaused: false,
    routineAdjustments: true,
    dailyBudgetUsd: 20,
    productScope: 'Box Buddies',
  };

  it('requires the selected advertiser and a Box Buddy product', () => {
    expect(() => assertAdvertiser('100', '200')).toThrow(/advertiserId/);
    expect(() => assertBoxBuddy('https://obdcollect.shop/products/other')).toThrow(/Box Buddies/);
    expect(() => assertBoxBuddy('https://obdcollect.shop/products/box-buddy')).not.toThrow();
  });

  it('blocks emergency changes, unmanaged campaigns, and budget increases', () => {
    expect(() => assertRoutineChange({ ...policy, emergencyPaused: true }, {
      advertiserId: '100', campaignId: 'c1', managedCampaignIds: ['c1'], raisesBudget: false,
    })).toThrow(/Emergency pause/);
    expect(() => assertRoutineChange({ ...policy, emergencyPaused: true }, {
      advertiserId: '100', campaignId: 'c1', managedCampaignIds: ['c1'], raisesBudget: false, pausing: true,
    })).not.toThrow();
    expect(() => assertRoutineChange(policy, {
      advertiserId: '100', campaignId: 'other', managedCampaignIds: ['c1'], raisesBudget: false,
    })).toThrow(/not in the Box Buddy/);
    expect(() => assertRoutineChange(policy, {
      advertiserId: '100', campaignId: 'c1', managedCampaignIds: ['c1'], raisesBudget: true,
    })).toThrow(/Raising the budget/);
  });

  it('keeps Promote and GMV Max creation unsupported', () => {
    expect(capability('promote').create).toBe(false);
    expect(capability('gmv_max').create).toBe(false);
    expect(capability('shop_sales').create).toBe(false);
    expect(capability('website_sales').create).toBe(true);
    expect(capability('gmv_max').reason).toMatch(/organic/i);
  });

  it('treats a reused idempotency key as a duplicate only for the same action', () => {
    expect(decideIdempotency(null, 'ad_create')).toBe('run');
    expect(decideIdempotency({ action: 'ad_create' }, 'ad_create')).toBe('duplicate');
    expect(decideIdempotency({ action: 'ad_create' }, 'status_update')).toBe('conflict');
  });
});

describe('TikTok reporting', () => {
  it('leaves missing auction metrics null', () => {
    const report = normalizeAuctionReport({ spend: '20', impressions: '1000' }, { currency: 'USD', timezone: 'America/New_York' });
    expect(report.spend.value).toBe(20);
    expect(report.videoViews.value).toBeNull();
    expect(report.videoViews.reason).toMatch(/video_play_actions/);
    expect(report.purchases.value).toBeNull();
    expect(report.cpa.value).toBeNull();
    expect(report.verifiedStoreOrders.value).toBeNull();
    expect(report.allClicks.value).toBeNull();
  });

  it('does not present GMV Max revenue as paid ROAS', () => {
    const report = normalizeGmvMaxReport({ spend: '20', gross_revenue: '80' }, { currency: 'USD' });
    expect(report.includesOrganicSales).toBe(true);
    expect(report.purchaseRevenue.value).toBe(80);
    expect(report.paidOnlyRoas.value).toBeNull();
    expect(report.roas.value).toBeNull();
    expect(report.paidOnlyRoas.reason).toMatch(/organic/);
  });

  it('rejects an hourly report that covers more than one day', () => {
    expect(() => assertReportWindow({ startDate: '2026-10-01', endDate: '2026-10-02', breakdown: 'hour' })).toThrow(/one advertiser-timezone day/);
  });
});

describe('TikTok token handling', () => {
  it('round-trips the access token and redacts it from errors', () => {
    const sealed = encryptString('secret-access-token', key);
    expect(sealed).not.toContain('secret-access-token');
    expect(decryptString(sealed, key)).toBe('secret-access-token');
    const noisy = 'access_token=super-secret-token-value-that-is-long-enough&ok=1';
    expect(redactSecrets(noisy)).not.toContain('super-secret-token-value-that-is-long-enough');
  });

  it('binds the OAuth state to the signed-in account', () => {
    const token = sealState({ nonce: 'abc', accountId: 'seller', exp: 2_000 }, 'state-secret');
    expect(openState(token, 'state-secret', 1_000)?.accountId).toBe('seller');
    expect(openState(token, 'other-secret', 1_000)).toBeNull();
  });

  it('returns a TikTok error without forwarding the access token', async () => {
    const token = 'this-is-the-access-token-value-which-is-quite-long';
    const client = createTiktokClient(token, async () => new Response(JSON.stringify({
      code: 40002,
      message: `bad request access_token=${token}`,
    }), { status: 200 }));
    await expect(client.get('/campaign/get/', {})).rejects.toThrow(/\[redacted\]|refused|bad request/i);
    try {
      await client.get('/campaign/get/', {});
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain(token);
    }
  });

  it('asks for a reconnect when TikTok rejects the token', async () => {
    const client = createTiktokClient('token', async () => new Response(JSON.stringify({
      code: 40100,
      message: 'Access token is invalid',
    }), { status: 401 }));
    await expect(client.get('/advertiser/info/', {})).rejects.toMatchObject({ code: 'reconnect_required' });
  });
});

describe('Spark eligibility', () => {
  it('rejects a post TikTok did not list', () => {
    const status = sparkPostStatus({ list: [{ item_id: '999', auth_status: 'AUTHORIZED' }] }, '123');
    expect(status.eligible).toBe(false);
  });

  it('rejects an expired authorization', () => {
    const status = sparkPostStatus({ list: [{ item_id: '123', auth_end_time: '2020-01-01T00:00:00Z' }] }, '123');
    expect(status.eligible).toBe(false);
    expect(status.expiresAt).toContain('2020');
  });
});

describe('safety rules', () => {
  it('does not pause a small or young sample', () => {
    const young = safetyPause({
      spend: 40, purchases: 1, ageHours: 10, reportingDelayHours: 6, observationHours: 72, minPurchases: 5, targetCpaUsd: 15,
    }, true);
    expect(young.pause).toBe(false);
    const small = safetyPause({
      spend: 40, purchases: 1, ageHours: 100, reportingDelayHours: 6, observationHours: 72, minPurchases: 5, targetCpaUsd: 15,
    }, true);
    expect(small.pause).toBe(false);
    const off = safetyPause({
      spend: 100, purchases: 5, ageHours: 100, reportingDelayHours: 6, observationHours: 72, minPurchases: 5, targetCpaUsd: 15,
    }, false);
    expect(off.pause).toBe(false);
  });
});
