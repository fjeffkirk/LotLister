import { z } from 'zod';
import { registerTool } from '../registry';
import { publicOrigin } from '../oauth';
import { capability, type CampaignKind } from '../../tiktok/policy';
import {
  changeHistory,
  createAd,
  createAuthorizedCampaign,
  getCampaign,
  listAdGroups,
  listAds,
  listCampaigns,
  listPosts,
  performance,
  previewWebsiteCampaign,
  readPolicy,
  searchTargeting,
  settingsView,
  trackingStatus,
  unsupported,
  updateAd,
  updateAdGroup,
  updatePolicyFromAgent,
  updateStatus,
} from '../../tiktok/service';

const advertiserId = z.string().regex(/^\d{4,30}$/);
const page = z.number().int().min(1).max(100).default(1);
const reason = z.string().trim().min(3).max(500);
const idempotencyKey = z.string().trim().min(8).max(80);

function origin(): string {
  return publicOrigin(process.env.NEXT_PUBLIC_APP_URL || 'https://lotlister.onrender.com');
}

registerTool({
  name: 'tiktok_connection_status',
  description: 'Read the TikTok advertiser connection for this LotLister account: status, granted permissions, currency, timezone, selected advertiser, and which campaign types this integration can create. Does not return tokens.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    return settingsView(ctx.accountId, origin());
  },
});

registerTool({
  name: 'tiktok_accounts_list',
  description: 'List advertiser accounts returned by the TikTok authorization. The selected flag is the only account LotLister will modify. The @obdcollect profile is not an advertiser id.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    const settings = await settingsView(ctx.accountId, origin());
    return {
      advertisers: settings.connection?.advertisers ?? [],
      grantedScope: settings.connection?.grantedScope ?? null,
      status: settings.connection?.status ?? 'disconnected',
    };
  },
});

registerTool({
  name: 'tiktok_campaigns_list',
  description: 'List campaigns for one advertiserId, one page at a time. Managed Box Buddy campaigns are marked. Unmanaged campaigns are included for spend visibility and are not changed.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: { advertiserId: { type: 'string' }, page: { type: 'integer', minimum: 1 } },
    required: ['advertiserId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ advertiserId, page }).strict().parse(args);
    return listCampaigns(ctx.accountId, parsed.advertiserId, parsed.page);
  },
});

registerTool({
  name: 'tiktok_campaign_get',
  description: 'Read one campaign by advertiserId and campaignId. Does not change it.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: { advertiserId: { type: 'string' }, campaignId: { type: 'string' } },
    required: ['advertiserId', 'campaignId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ advertiserId, campaignId: z.string().min(1).max(40) }).strict().parse(args);
    return getCampaign(ctx.accountId, parsed.advertiserId, parsed.campaignId);
  },
});

registerTool({
  name: 'tiktok_adgroups_list',
  description: 'List ad groups for one advertiser. Pass campaignId to limit the page to one campaign.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: { advertiserId: { type: 'string' }, campaignId: { type: 'string' }, page: { type: 'integer', minimum: 1 } },
    required: ['advertiserId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ advertiserId, campaignId: z.string().min(1).max(40).optional(), page }).strict().parse(args);
    return listAdGroups(ctx.accountId, parsed.advertiserId, parsed.campaignId ?? null, parsed.page);
  },
});

registerTool({
  name: 'tiktok_ads_list',
  description: 'List ads for one advertiser. Pass adgroupId to limit the page to one ad group.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: { advertiserId: { type: 'string' }, adgroupId: { type: 'string' }, page: { type: 'integer', minimum: 1 } },
    required: ['advertiserId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ advertiserId, adgroupId: z.string().min(1).max(40).optional(), page }).strict().parse(args);
    return listAds(ctx.accountId, parsed.advertiserId, parsed.adgroupId ?? null, parsed.page);
  },
});

registerTool({
  name: 'tiktok_performance_get',
  description: 'Read TikTok-attributed delivery for a date range in the advertiser timezone. Daily breakdowns cover at most 30 days. Hourly breakdowns cover one day. Missing metrics stay null. GMV Max revenue includes organic sales and is not paid ROAS. Store orders are not joined.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      advertiserId: { type: 'string' },
      startDate: { type: 'string', description: 'YYYY-MM-DD in the advertiser timezone' },
      endDate: { type: 'string' },
      breakdown: { type: 'string', enum: ['none', 'day', 'hour'] },
      level: { type: 'string', enum: ['campaign', 'adgroup', 'ad', 'advertiser'] },
      report: { type: 'string', enum: ['auction', 'gmv_max'] },
      managedOnly: { type: 'boolean' },
    },
    required: ['advertiserId', 'startDate', 'endDate'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      advertiserId,
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      breakdown: z.enum(['none', 'day', 'hour']).default('none'),
      level: z.enum(['campaign', 'adgroup', 'ad', 'advertiser']).default('campaign'),
      report: z.enum(['auction', 'gmv_max']).default('auction'),
      managedOnly: z.boolean().default(false),
    }).strict().parse(args);
    return performance(ctx.accountId, parsed);
  },
});

registerTool({
  name: 'tiktok_targeting_search',
  description: 'Search targeting options TikTok returns for this advertiser. Searching does not change an ad group.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: { advertiserId: { type: 'string' }, query: { type: 'string' } },
    required: ['advertiserId', 'query'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ advertiserId, query: z.string().trim().min(1).max(80) }).strict().parse(args);
    return searchTargeting(ctx.accountId, parsed.advertiserId, parsed.query);
  },
});

registerTool({
  name: 'tiktok_posts_list',
  description: 'List identities and posts TikTok returns for Spark Ads on this advertiser. A missing post is not eligible. Organic posts are not assumed to be authorized, and authorization can expire.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: { advertiserId: { type: 'string' } },
    required: ['advertiserId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ advertiserId }).strict().parse(args);
    return listPosts(ctx.accountId, parsed.advertiserId);
  },
});

registerTool({
  name: 'tiktok_tracking_status',
  description: 'Read pixels and optimization events TikTok returns for website campaigns. A failed pixel list is a reason, not zero events.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: { advertiserId: { type: 'string' } },
    required: ['advertiserId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ advertiserId }).strict().parse(args);
    return trackingStatus(ctx.accountId, parsed.advertiserId);
  },
});

registerTool({
  name: 'tiktok_campaign_preview',
  description: 'Preview a paused website-sales Box Buddy campaign. Promote, TikTok Shop, and GMV Max previews return an explicit unsupported result and do not create a website campaign instead. This tool does not spend money. Launch still requires the signed-in user to authorize the preview in LotLister.',
  effect: 'tiktok',
  readOnly: false,
  idempotent: false,
  openWorld: false,
  inputSchema: {
    type: 'object',
    properties: {
      advertiserId: { type: 'string' },
      kind: { type: 'string', enum: ['promote', 'gmv_max', 'shop_sales', 'website_sales', 'spark_ad'] },
      campaignName: { type: 'string' },
      productUrl: { type: 'string' },
      dailyBudgetUsd: { type: 'number' },
      audienceSummary: { type: 'string' },
      identityId: { type: 'string' },
      postId: { type: 'string' },
      pixelId: { type: 'string' },
      optimizationEvent: { type: 'string' },
    },
    required: ['advertiserId', 'kind'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      advertiserId,
      kind: z.enum(['promote', 'gmv_max', 'shop_sales', 'website_sales', 'spark_ad']),
      campaignName: z.string().trim().min(1).max(120).optional(),
      productUrl: z.string().trim().url().max(500).optional(),
      dailyBudgetUsd: z.number().positive().max(100000).optional(),
      audienceSummary: z.string().trim().min(1).max(500).optional(),
      identityId: z.string().max(80).optional(),
      postId: z.string().max(80).optional(),
      pixelId: z.string().max(40).optional(),
      optimizationEvent: z.string().max(80).optional(),
    }).strict().parse(args);
    if (parsed.kind !== 'website_sales') {
      const support = parsed.kind === 'spark_ad' ? await unsupported('spark_ad') : capability(parsed.kind as CampaignKind);
      return { created: false, supported: support, note: 'No other campaign type was created in its place.' };
    }
    return previewWebsiteCampaign(ctx.accountId, {
      advertiserId: parsed.advertiserId,
      campaignName: parsed.campaignName ?? '',
      productUrl: parsed.productUrl ?? '',
      dailyBudgetUsd: parsed.dailyBudgetUsd ?? 0,
      audienceSummary: parsed.audienceSummary ?? '',
      identityId: parsed.identityId,
      postId: parsed.postId,
      pixelId: parsed.pixelId,
      optimizationEvent: parsed.optimizationEvent,
    });
  },
});

registerTool({
  name: 'tiktok_campaign_create',
  description: 'Create the website campaign from a preview the LotLister user already authorized. The campaign is created paused. A tool argument is not authorization. The same idempotency key returns the first result instead of creating another campaign.',
  effect: 'tiktok',
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      previewId: { type: 'string' },
      idempotencyKey: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['previewId', 'idempotencyKey', 'reason'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ previewId: z.string().min(8).max(40), idempotencyKey, reason }).strict().parse(args);
    return createAuthorizedCampaign(ctx.accountId, parsed);
  },
});

registerTool({
  name: 'tiktok_adgroup_update',
  description: 'Update a managed Box Buddy ad group. Budget fields are rejected. Unmanaged campaigns are not changed. Pass an idempotency key.',
  effect: 'tiktok',
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      advertiserId: { type: 'string' },
      campaignId: { type: 'string' },
      adgroupId: { type: 'string' },
      patch: { type: 'object' },
      reason: { type: 'string' },
      idempotencyKey: { type: 'string' },
    },
    required: ['advertiserId', 'campaignId', 'adgroupId', 'patch', 'reason', 'idempotencyKey'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      advertiserId,
      campaignId: z.string().min(1).max(40),
      adgroupId: z.string().min(1).max(40),
      patch: z.record(z.string(), z.unknown()),
      reason,
      idempotencyKey,
    }).strict().parse(args);
    return updateAdGroup(ctx.accountId, parsed);
  },
});

registerTool({
  name: 'tiktok_ad_create',
  description: 'Create a paused ad on a managed Box Buddy campaign. A Spark post is used only when TikTok lists it as eligible. A product URL must match Box Buddies. This does not enable the ad.',
  effect: 'tiktok',
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      advertiserId: { type: 'string' },
      campaignId: { type: 'string' },
      adgroupId: { type: 'string' },
      name: { type: 'string' },
      postId: { type: 'string' },
      identityId: { type: 'string' },
      landingPageUrl: { type: 'string' },
      reason: { type: 'string' },
      idempotencyKey: { type: 'string' },
    },
    required: ['advertiserId', 'campaignId', 'adgroupId', 'name', 'reason', 'idempotencyKey'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      advertiserId,
      campaignId: z.string().min(1).max(40),
      adgroupId: z.string().min(1).max(40),
      name: z.string().trim().min(1).max(120),
      postId: z.string().max(80).optional(),
      identityId: z.string().max(80).optional(),
      landingPageUrl: z.string().url().max(500).optional(),
      reason,
      idempotencyKey,
    }).strict().parse(args);
    return createAd(ctx.accountId, parsed);
  },
});

registerTool({
  name: 'tiktok_ad_update',
  description: 'Update a managed Box Buddy ad. Budget fields are rejected. Pass an idempotency key and the reason for the change.',
  effect: 'tiktok',
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      advertiserId: { type: 'string' },
      campaignId: { type: 'string' },
      adId: { type: 'string' },
      patch: { type: 'object' },
      reason: { type: 'string' },
      idempotencyKey: { type: 'string' },
    },
    required: ['advertiserId', 'campaignId', 'adId', 'patch', 'reason', 'idempotencyKey'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      advertiserId,
      campaignId: z.string().min(1).max(40),
      adId: z.string().min(1).max(40),
      patch: z.record(z.string(), z.unknown()),
      reason,
      idempotencyKey,
    }).strict().parse(args);
    return updateAd(ctx.accountId, parsed);
  },
});

registerTool({
  name: 'tiktok_status_update',
  description: 'Pause or enable a managed campaign, ad group, or ad. ENABLE is blocked while emergency pause is on. This does not change unmanaged campaigns. operationStatus is ENABLE or DISABLE.',
  effect: 'tiktok',
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      advertiserId: { type: 'string' },
      campaignId: { type: 'string' },
      entityType: { type: 'string', enum: ['campaign', 'adgroup', 'ad'] },
      entityId: { type: 'string' },
      operationStatus: { type: 'string', enum: ['ENABLE', 'DISABLE'] },
      reason: { type: 'string' },
      idempotencyKey: { type: 'string' },
    },
    required: ['advertiserId', 'campaignId', 'entityType', 'entityId', 'operationStatus', 'reason', 'idempotencyKey'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      advertiserId,
      campaignId: z.string().min(1).max(40),
      entityType: z.enum(['campaign', 'adgroup', 'ad']),
      entityId: z.string().min(1).max(40),
      operationStatus: z.enum(['ENABLE', 'DISABLE']),
      reason,
      idempotencyKey,
    }).strict().parse(args);
    return updateStatus(ctx.accountId, parsed);
  },
});

registerTool({
  name: 'tiktok_change_history',
  description: 'Read LotLister audit rows for this advertiser: action, previous and new values, and the reason. Tokens are not included.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: false,
  inputSchema: {
    type: 'object',
    properties: { advertiserId: { type: 'string' } },
    required: ['advertiserId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ advertiserId }).strict().parse(args);
    return { changes: await changeHistory(ctx.accountId, parsed.advertiserId) };
  },
});

registerTool({
  name: 'tiktok_management_policy_get',
  description: 'Read the saved Box Buddy management policy for one advertiser, including the authorized daily total, peak authorization, target CPA, and whether scheduled review is enabled.',
  effect: 'tiktok',
  readOnly: true,
  idempotent: true,
  openWorld: false,
  inputSchema: {
    type: 'object',
    properties: { advertiserId: { type: 'string' } },
    required: ['advertiserId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ advertiserId }).strict().parse(args);
    return { policy: await readPolicy(ctx.accountId, parsed.advertiserId) };
  },
});

registerTool({
  name: 'tiktok_management_policy_update',
  description: 'Change only the target CPA, observation window, or reporting delay. Budget, product scope, advertiser, peak authorization, and scheduled review stay as saved in LotLister. Target CPA is a performance goal, not a profitability threshold.',
  effect: 'tiktok',
  readOnly: false,
  idempotent: true,
  openWorld: false,
  inputSchema: {
    type: 'object',
    properties: {
      advertiserId: { type: 'string' },
      targetCpaUsd: { type: 'number' },
      observationHours: { type: 'integer' },
      reportingDelayHours: { type: 'integer' },
    },
    required: ['advertiserId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      advertiserId,
      targetCpaUsd: z.number().positive().max(10000).optional(),
      observationHours: z.number().int().min(24).max(24 * 30).optional(),
      reportingDelayHours: z.number().int().min(1).max(72).optional(),
    }).strict().parse(args);
    return updatePolicyFromAgent(ctx.accountId, parsed);
  },
});
