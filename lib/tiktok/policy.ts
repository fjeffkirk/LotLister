import { createHash } from 'crypto';

/**
 * Budget and campaign rules checked against TikTok Marketing API v1.3 docs on 2026-10-20.
 * Campaign create: https://business-api.tiktok.com/portal/docs/create-a-campaign/v1.3
 * Currency daily budget range is linked from that page. Auction campaign daily and lifetime
 * budgets are at least $20 USD except PRODUCT_SALES with a store source, which is $10.
 * Website Sales with Campaign Budget Optimization uses BUDGET_MODE_DYNAMIC_DAILY_BUDGET.
 * That mode is an average: a day can spend 125% of the average, and a week stays within average * 7.
 * It is not a hard daily cap.
 */

export const CAMPAIGN_DAILY_MINIMUM_USD = 20;
export const DYNAMIC_DAILY_PEAK_FACTOR = 1.25;
export const PRODUCT_SCOPE = 'Box Buddies';
export const BOX_BUDDY = /\bbox[\s-]*budd(?:y|ies)\b/i;

export class TiktokUserError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TiktokUserError';
    this.code = code;
  }
}

export type CampaignKind = 'promote' | 'gmv_max' | 'website_sales' | 'shop_sales' | 'spark_ad';

export interface Capability {
  kind: CampaignKind;
  read: boolean;
  create: boolean;
  reason: string;
}

export const CAPABILITIES: Capability[] = [
  {
    kind: 'promote',
    read: false,
    create: false,
    reason: 'Promote, including “More product purchases,” is created in the TikTok app. Marketing API v1.3 campaign/create does not create Promote campaigns. LotLister will not create a website or Shop campaign in its place.',
  },
  {
    kind: 'gmv_max',
    read: true,
    create: false,
    reason: 'GMV Max can be read at /gmv_max/report/get/. Creating one uses /gmv_max/campaign/create/ and requires a TikTok Shop, exclusive advertiser authorization, and a minimum ROAS bid. Those campaigns count organic sales in revenue. This policy does not create them.',
  },
  {
    kind: 'shop_sales',
    read: true,
    create: false,
    reason: 'PRODUCT_SALES with campaign_product_source STORE is an allowlisted TikTok Shop objective. It is a different purchase destination from the website. LotLister does not create it.',
  },
  {
    kind: 'website_sales',
    read: true,
    create: true,
    reason: 'Website Sales uses campaign/create with virtual_objective_type SALES and sales_destination WEBSITE. Campaigns are created paused. With Campaign Budget Optimization, TikTok requires BUDGET_MODE_DYNAMIC_DAILY_BUDGET, which can spend 125% of the average on one day. From January 1, 2027, TikTok stops accepting this legacy manual create call for Sales objectives. This integration does not silently switch the call to Smart+.',
  },
  {
    kind: 'spark_ad',
    read: true,
    create: true,
    reason: 'Spark Ads are a creative format on an existing auction ad, using an authorized TikTok identity and an eligible post id. A normal video on @obdcollect is not eligible until TikTok says that post can be used as a Spark Ad and the authorization has not expired.',
  },
];

export function capability(kind: CampaignKind): Capability {
  const found = CAPABILITIES.find((item) => item.kind === kind);
  if (!found) throw new TiktokUserError('unsupported_campaign', 'That campaign type is not part of this integration.');
  return found;
}

export interface BudgetAssessment {
  allowed: boolean;
  requestedDailyUsd: number;
  minimumDailyUsd: number;
  budgetMode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET';
  hardDailyCap: false;
  averageDailyUsd: number | null;
  peakDailyUsd: number | null;
  weeklyCeilingUsd: number | null;
  code: 'ok' | 'below_minimum' | 'peak_not_authorized' | 'above_authorized_total' | 'currency';
  message: string;
}

export function assessDailyBudget(input: {
  requestedDailyUsd: number;
  currency?: string | null;
  peakSpendAuthorizedUsd?: number | null;
  authorizedDailyUsd?: number;
  managedDailyUsd?: number;
}): BudgetAssessment {
  const currency = (input.currency || 'USD').toUpperCase();
  const base = {
    requestedDailyUsd: input.requestedDailyUsd,
    minimumDailyUsd: CAMPAIGN_DAILY_MINIMUM_USD,
    budgetMode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET' as const,
    hardDailyCap: false as const,
  };
  if (currency !== 'USD') {
    return {
      ...base,
      allowed: false,
      averageDailyUsd: null,
      peakDailyUsd: null,
      weeklyCeilingUsd: null,
      code: 'currency',
      message: `This advertiser currency is ${currency}. The $20 policy is USD. LotLister will not convert or raise the budget.`,
    };
  }
  if (!(input.requestedDailyUsd > 0) || input.requestedDailyUsd < CAMPAIGN_DAILY_MINIMUM_USD) {
    return {
      ...base,
      allowed: false,
      averageDailyUsd: null,
      peakDailyUsd: null,
      weeklyCeilingUsd: null,
      code: 'below_minimum',
      message: `TikTok’s auction campaign minimum is $${CAMPAIGN_DAILY_MINIMUM_USD} USD per day. $${input.requestedDailyUsd} was not raised to that minimum. Launch stays blocked.`,
    };
  }
  const peak = Math.round(input.requestedDailyUsd * DYNAMIC_DAILY_PEAK_FACTOR * 100) / 100;
  const weekly = Math.round(input.requestedDailyUsd * 7 * 100) / 100;
  const authorizedPeak = input.peakSpendAuthorizedUsd ?? null;
  if (authorizedPeak == null || authorizedPeak + 0.001 < peak) {
    return {
      ...base,
      allowed: false,
      averageDailyUsd: input.requestedDailyUsd,
      peakDailyUsd: peak,
      weeklyCeilingUsd: weekly,
      code: 'peak_not_authorized',
      message: `A $${input.requestedDailyUsd} dynamic daily budget is an average, not a hard cap. One day can spend $${peak} (125%). Weekly spend stays within $${weekly}. Authorize that peak in LotLister before launch. The budget sent to TikTok stays $${input.requestedDailyUsd}.`,
    };
  }
  const authorizedDaily = input.authorizedDailyUsd ?? input.requestedDailyUsd;
  const managed = input.managedDailyUsd ?? 0;
  if (managed + input.requestedDailyUsd > authorizedDaily + 0.001) {
    return {
      ...base,
      allowed: false,
      averageDailyUsd: input.requestedDailyUsd,
      peakDailyUsd: peak,
      weeklyCeilingUsd: weekly,
      code: 'above_authorized_total',
      message: `Managed Box Buddy campaigns already reserve $${managed} of the $${authorizedDaily} daily total. Adding $${input.requestedDailyUsd} would exceed it. Existing campaigns were not changed.`,
    };
  }
  return {
    ...base,
    allowed: true,
    averageDailyUsd: input.requestedDailyUsd,
    peakDailyUsd: peak,
    weeklyCeilingUsd: weekly,
    code: 'ok',
    message: `Budget stays $${input.requestedDailyUsd} as a dynamic daily average. A single day can still reach $${peak}. This is not a hard $20 spending cap.`,
  };
}

/** Apply a reservation only when the new total still fits. Returns null when the second caller loses. */
export function reserveDailyBudget(currentManagedUsd: number, addUsd: number, authorizedDailyUsd: number): number | null {
  const next = Math.round((currentManagedUsd + addUsd) * 100) / 100;
  if (next > authorizedDailyUsd + 0.001) return null;
  return next;
}

export function assertBoxBuddy(text: string): void {
  if (!BOX_BUDDY.test(text)) {
    throw new TiktokUserError(
      'product_scope',
      `This management policy only covers ${PRODUCT_SCOPE}. The name or URL did not match. Other products and existing campaigns were not changed.`,
    );
  }
}

export function assertAdvertiser(selectedAdvertiserId: string | null, requestedAdvertiserId: string): void {
  if (!selectedAdvertiserId || selectedAdvertiserId !== requestedAdvertiserId) {
    throw new TiktokUserError(
      'advertiser_required',
      'Pass the advertiserId selected in LotLister. The TikTok profile @obdcollect is not an advertiser account, and LotLister will not guess which ad account to change.',
    );
  }
}

export interface PolicyGate {
  advertiserId: string;
  emergencyPaused: boolean;
  routineAdjustments: boolean;
  dailyBudgetUsd: number;
  productScope: string;
}

export function assertRoutineChange(policy: PolicyGate | null, input: { advertiserId: string; campaignId: string; managedCampaignIds: string[]; raisesBudget: boolean; productText?: string; pausing?: boolean }): void {
  if (!policy || policy.advertiserId !== input.advertiserId) {
    throw new TiktokUserError('policy_missing', 'Save a Box Buddy management policy for this advertiser in LotLister before changing ads.');
  }
  if (policy.emergencyPaused && !input.pausing) {
    throw new TiktokUserError('emergency_pause', 'Emergency pause is on. Managed campaigns can be paused, and other changes are blocked.');
  }
  if (!policy.routineAdjustments && !input.pausing) {
    throw new TiktokUserError('adjustments_disabled', 'Routine adjustments are off for this advertiser.');
  }
  if (!input.managedCampaignIds.includes(input.campaignId)) {
    throw new TiktokUserError('not_managed', 'That campaign is not in the Box Buddy managed set. Unrelated campaigns are left untouched.');
  }
  if (input.raisesBudget) {
    throw new TiktokUserError('budget_authorization', 'Raising the budget needs a new authorization in LotLister. ChatGPT cannot approve a higher budget from the tool call.');
  }
  if (input.productText) assertBoxBuddy(input.productText);
}

export function payloadHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function decideIdempotency(existing: { action: string } | null, action: string): 'run' | 'duplicate' | 'conflict' {
  if (!existing) return 'run';
  return existing.action === action ? 'duplicate' : 'conflict';
}

export function sparkPostStatus(payload: unknown, postId: string): { eligible: boolean; expiresAt: string | null; reason: string } {
  const rows = collectObjects(payload).filter((row) => {
    const id = row.item_id ?? row.tiktok_item_id ?? row.video_id ?? row.id;
    return id != null && String(id) === postId;
  });
  if (rows.length === 0) {
    return {
      eligible: false,
      expiresAt: null,
      reason: 'TikTok did not return that post in the authorized Spark Ad video list. An organic post is not usable until it appears there with an unexpired identity authorization.',
    };
  }
  const row = rows[0];
  const expiry = firstString(row, ['auth_end_time', 'auth_expire_time', 'authorization_expire_time', 'expire_time']);
  if (expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) < Date.now()) {
    return { eligible: false, expiresAt: expiry, reason: 'The Spark Ad authorization for this post has expired.' };
  }
  const status = String(row.auth_status ?? row.authorization_status ?? '').toUpperCase();
  if (status && /EXPIRED|REJECT|REVOKE|UNAUTHORIZED/.test(status)) {
    return { eligible: false, expiresAt: expiry, reason: `TikTok marked this post ${status}.` };
  }
  return {
    eligible: true,
    expiresAt: expiry,
    reason: expiry
      ? `TikTok listed this post for Spark Ads. The authorization end time is ${expiry}.`
      : 'TikTok listed this post for Spark Ads. The response did not include an authorization end time.',
  };
}

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof row[key] === 'string' && row[key]) return String(row[key]);
  }
  return null;
}

function collectObjects(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    out.push(value as Record<string, unknown>);
    for (const child of Object.values(value as Record<string, unknown>)) collectObjects(child, out);
  }
  return out;
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(access_token|auth_code|secret|app_secret)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]');
}

export interface PerformanceSample {
  spend: number;
  purchases: number;
  ageHours: number;
  reportingDelayHours: number;
  observationHours: number;
  minPurchases: number;
  targetCpaUsd: number;
}

/** A pause suggestion only. It does not change a bid, audience, or budget. */
export function safetyPause(sample: PerformanceSample, enabled: boolean): { pause: boolean; reason: string } {
  if (!enabled) return { pause: false, reason: 'Scheduled safety rules are off.' };
  if (sample.ageHours < sample.observationHours + sample.reportingDelayHours) {
    return { pause: false, reason: `Observation window is ${sample.observationHours} hours plus ${sample.reportingDelayHours} hours of reporting delay. No change yet.` };
  }
  if (sample.purchases < sample.minPurchases) {
    return { pause: false, reason: `Only ${sample.purchases} TikTok-attributed purchases. The minimum sample is ${sample.minPurchases}. Audience and budget stay as they are.` };
  }
  const cpa = sample.spend / sample.purchases;
  if (cpa <= sample.targetCpaUsd) return { pause: false, reason: `CPA ${cpa.toFixed(2)} is within the $${sample.targetCpaUsd} goal.` };
  return {
    pause: true,
    reason: `TikTok-attributed CPA ${cpa.toFixed(2)} is above the $${sample.targetCpaUsd} goal after the observation window. This pauses the ad. It does not prove the order was unprofitable, and reporting delay can mean spend already passed the figure used here.`,
  };
}
