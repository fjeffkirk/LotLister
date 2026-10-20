import { createHash } from 'crypto';
import prisma from '../prisma';
import { getPublicBaseUrl } from '../ebay';
import { ENDPOINTS, createTiktokClient, type TiktokClient } from './api';
import { decryptString, encryptString, exchangeAuthCode, missingTiktokEnv, tiktokCredentials } from './oauth';
import {
  CAPABILITIES,
  PRODUCT_SCOPE,
  TiktokUserError,
  assessDailyBudget,
  assertAdvertiser,
  assertBoxBuddy,
  assertRoutineChange,
  capability,
  decideIdempotency,
  payloadHash,
  reserveDailyBudget,
  safetyPause,
  sparkPostStatus,
  type CampaignKind,
} from './policy';
import { assertReportWindow, normalizeAuctionReport, normalizeGmvMaxReport } from './reporting';

const CALLBACK_PATH = '/api/tiktok/callback';

export function tiktokCallbackUrl(origin: string): string {
  return `${getPublicBaseUrl(origin)}${CALLBACK_PATH}`;
}

function publicConnection(row: {
  id: string;
  status: string;
  statusDetail: string | null;
  scope: string;
  connectedAt: Date;
  advertisers: Array<{ advertiserId: string; name: string; currency: string | null; timezone: string | null; selected: boolean }>;
}) {
  return {
    connectionId: row.id,
    status: row.status,
    statusDetail: row.statusDetail,
    grantedScope: row.scope,
    connectedAt: row.connectedAt.toISOString(),
    advertisers: row.advertisers.map((item) => ({
      advertiserId: item.advertiserId,
      name: item.name,
      currency: item.currency,
      timezone: item.timezone,
      selected: item.selected,
    })),
    profileHandle: '@obdcollect',
    note: 'Select an advertiserId before any change. The @obdcollect profile is not an advertiser account.',
  };
}

async function ownedConnection(accountId: string) {
  const row = await prisma.tiktokConnection.findUnique({
    where: { userEmail: accountId },
    include: { advertisers: { orderBy: { name: 'asc' } } },
  });
  if (!row || row.status !== 'connected') {
    throw new TiktokUserError('reconnect_required', 'Connect a TikTok advertiser account in LotLister before using these tools.');
  }
  return row;
}

async function clientFor(accountId: string): Promise<{ client: TiktokClient; connection: Awaited<ReturnType<typeof ownedConnection>> }> {
  const connection = await ownedConnection(accountId);
  return { client: createTiktokClient(decryptString(connection.accessTokenEncrypted)), connection };
}

function selectedAdvertiser(connection: Awaited<ReturnType<typeof ownedConnection>>, advertiserId: string) {
  assertAdvertiser(
    connection.advertisers.find((item) => item.selected)?.advertiserId ?? null,
    advertiserId,
  );
  const advertiser = connection.advertisers.find((item) => item.advertiserId === advertiserId);
  if (!advertiser) throw new TiktokUserError('advertiser_required', 'That advertiser is not on this TikTok authorization.');
  return advertiser;
}

export async function settingsView(accountId: string, origin: string) {
  const connection = await prisma.tiktokConnection.findUnique({
    where: { userEmail: accountId },
    include: { advertisers: { orderBy: { name: 'asc' } } },
  });
  const policy = connection
    ? await prisma.tiktokManagementPolicy.findMany({ where: { userEmail: accountId } })
    : [];
  const changes = await prisma.tiktokChange.findMany({
    where: { userEmail: accountId },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  return {
    configured: missingTiktokEnv().length === 0,
    missingEnv: missingTiktokEnv(),
    callbackUrl: tiktokCallbackUrl(origin),
    connection: connection ? publicConnection(connection) : null,
    capabilities: CAPABILITIES,
    budget: assessDailyBudget({ requestedDailyUsd: 20, currency: 'USD', peakSpendAuthorizedUsd: null }),
    policies: policy.map(toPublicPolicy),
    recentChanges: changes.map((change) => ({
      id: change.id,
      action: change.action,
      entityType: change.entityType,
      entityId: change.entityId,
      reason: change.reason,
      status: change.status,
      createdAt: change.createdAt.toISOString(),
    })),
    scheduledReview: 'Disabled until you enable it on a saved policy. Enabling it does not make ChatGPT run continuously.',
  };
}

function toPublicPolicy(policy: {
  advertiserId: string;
  productScope: string;
  dailyBudgetUsd: { toString(): string };
  peakSpendAuthorizedUsd: { toString(): string } | null;
  totalTestCapUsd: { toString(): string } | null;
  endDate: Date | null;
  targetCpaUsd: { toString(): string };
  observationHours: number;
  reportingDelayHours: number;
  minPurchasesBeforePause: number;
  scheduledReviewEnabled: boolean;
  safetyRulesEnabled: boolean;
  emergencyPaused: boolean;
  routineAdjustments: boolean;
  managedDailyUsd: { toString(): string };
}) {
  return {
    advertiserId: policy.advertiserId,
    productScope: policy.productScope,
    dailyBudgetUsd: Number(policy.dailyBudgetUsd),
    peakSpendAuthorizedUsd: policy.peakSpendAuthorizedUsd == null ? null : Number(policy.peakSpendAuthorizedUsd),
    totalTestCapUsd: policy.totalTestCapUsd == null ? null : Number(policy.totalTestCapUsd),
    endDate: policy.endDate?.toISOString() ?? null,
    targetCpaUsd: Number(policy.targetCpaUsd),
    observationHours: policy.observationHours,
    reportingDelayHours: policy.reportingDelayHours,
    minPurchasesBeforePause: policy.minPurchasesBeforePause,
    scheduledReviewEnabled: policy.scheduledReviewEnabled,
    safetyRulesEnabled: policy.safetyRulesEnabled,
    emergencyPaused: policy.emergencyPaused,
    routineAdjustments: policy.routineAdjustments,
    managedDailyUsd: Number(policy.managedDailyUsd),
    targetCpaMeaning: 'Performance goal only. It is not a verified profitability threshold.',
  };
}

export async function saveAuthorization(accountId: string, authCode: string) {
  const token = await exchangeAuthCode(authCode);
  const encrypted = encryptString(token.accessToken);
  const client = createTiktokClient(token.accessToken);
  const { appId, secret } = tiktokCredentials();
  const listed = await client.get<{ list?: Array<{ advertiser_id: string; advertiser_name: string }> }>(ENDPOINTS.advertisers, {
    app_id: appId,
    secret,
  });
  const ids = (listed.list ?? []).map((item) => String(item.advertiser_id));
  const info = ids.length
    ? await client.get<{ list?: Array<{ advertiser_id: string; name?: string; currency?: string; timezone?: string; display_timezone?: string }> }>(
      ENDPOINTS.advertiserInfo,
      { advertiser_ids: JSON.stringify(ids) },
    )
    : { list: [] };
  const connection = await prisma.tiktokConnection.upsert({
    where: { userEmail: accountId },
    create: { userEmail: accountId, accessTokenEncrypted: encrypted, scope: token.scope, status: 'connected', statusDetail: null },
    update: { accessTokenEncrypted: encrypted, scope: token.scope, status: 'connected', statusDetail: null },
  });
  await prisma.tiktokAdvertiser.deleteMany({ where: { connectionId: connection.id } });
  for (const item of info.list ?? []) {
    await prisma.tiktokAdvertiser.create({
      data: {
        connectionId: connection.id,
        userEmail: accountId,
        advertiserId: String(item.advertiser_id),
        name: item.name || String(item.advertiser_id),
        currency: item.currency ?? null,
        timezone: item.display_timezone || item.timezone || null,
        selected: false,
      },
    });
  }
  return { advertiserCount: (info.list ?? []).length };
}

export async function disconnectTiktok(accountId: string) {
  await prisma.tiktokConnection.deleteMany({ where: { userEmail: accountId } });
  return { disconnected: true, note: 'The local token was deleted. Remove LotLister in TikTok Business Center as well if the authorization should end there.' };
}

export async function selectAdvertiser(accountId: string, advertiserId: string) {
  const connection = await ownedConnection(accountId);
  const found = connection.advertisers.find((item) => item.advertiserId === advertiserId);
  if (!found) throw new TiktokUserError('advertiser_required', 'That advertiser is not on this authorization.');
  await prisma.tiktokAdvertiser.updateMany({ where: { userEmail: accountId }, data: { selected: false } });
  await prisma.tiktokAdvertiser.update({ where: { id: found.id }, data: { selected: true } });
  return { advertiserId, name: found.name, currency: found.currency, timezone: found.timezone, selected: true };
}

export async function readPolicy(accountId: string, advertiserId: string) {
  const policy = await prisma.tiktokManagementPolicy.findUnique({ where: { userEmail_advertiserId: { userEmail: accountId, advertiserId } } });
  return policy ? toPublicPolicy(policy) : null;
}

export async function savePolicyFromUser(accountId: string, input: {
  advertiserId: string;
  dailyBudgetUsd: number;
  authorizePeak: boolean;
  targetCpaUsd: number;
  observationHours: number;
  reportingDelayHours: number;
  minPurchasesBeforePause: number;
  scheduledReviewEnabled: boolean;
  safetyRulesEnabled: boolean;
  totalTestCapUsd: number | null;
  endDate: string | null;
}) {
  const connection = await ownedConnection(accountId);
  selectedAdvertiser(connection, input.advertiserId);
  const peak = input.authorizePeak ? Math.round(input.dailyBudgetUsd * 1.25 * 100) / 100 : null;
  const assessment = assessDailyBudget({
    requestedDailyUsd: input.dailyBudgetUsd,
    currency: 'USD',
    peakSpendAuthorizedUsd: peak,
    authorizedDailyUsd: input.dailyBudgetUsd,
    managedDailyUsd: 0,
  });
  if (input.dailyBudgetUsd < 20) throw new TiktokUserError(assessment.code, assessment.message);
  const existing = await prisma.tiktokManagementPolicy.findUnique({
    where: { userEmail_advertiserId: { userEmail: accountId, advertiserId: input.advertiserId } },
  });
  if (existing && Number(existing.managedDailyUsd) > input.dailyBudgetUsd + 0.001) {
    throw new TiktokUserError('above_authorized_total', `Managed campaigns already reserve $${Number(existing.managedDailyUsd)}. The new daily total cannot be lower than that.`);
  }
  const saved = await prisma.tiktokManagementPolicy.upsert({
    where: { userEmail_advertiserId: { userEmail: accountId, advertiserId: input.advertiserId } },
    create: {
      userEmail: accountId,
      advertiserId: input.advertiserId,
      dailyBudgetUsd: input.dailyBudgetUsd,
      peakSpendAuthorizedUsd: peak,
      targetCpaUsd: input.targetCpaUsd,
      observationHours: input.observationHours,
      reportingDelayHours: input.reportingDelayHours,
      minPurchasesBeforePause: input.minPurchasesBeforePause,
      scheduledReviewEnabled: input.scheduledReviewEnabled,
      safetyRulesEnabled: input.safetyRulesEnabled,
      totalTestCapUsd: input.totalTestCapUsd,
      endDate: input.endDate ? new Date(input.endDate) : null,
    },
    update: {
      dailyBudgetUsd: input.dailyBudgetUsd,
      peakSpendAuthorizedUsd: peak,
      targetCpaUsd: input.targetCpaUsd,
      observationHours: input.observationHours,
      reportingDelayHours: input.reportingDelayHours,
      minPurchasesBeforePause: input.minPurchasesBeforePause,
      scheduledReviewEnabled: input.scheduledReviewEnabled,
      safetyRulesEnabled: input.safetyRulesEnabled,
      totalTestCapUsd: input.totalTestCapUsd,
      endDate: input.endDate ? new Date(input.endDate) : null,
    },
  });
  await prisma.tiktokChange.create({
    data: {
      userEmail: accountId,
      advertiserId: input.advertiserId,
      action: 'policy_save',
      entityType: 'policy',
      reason: 'Saved from the signed-in TikTok settings page.',
      beforeJson: existing ? JSON.stringify(toPublicPolicy(existing)) : null,
      afterJson: JSON.stringify(toPublicPolicy(saved)),
      status: 'verified',
    },
  });
  return { policy: toPublicPolicy(saved), budget: assessDailyBudget({
    requestedDailyUsd: Number(saved.dailyBudgetUsd),
    currency: 'USD',
    peakSpendAuthorizedUsd: saved.peakSpendAuthorizedUsd == null ? null : Number(saved.peakSpendAuthorizedUsd),
    authorizedDailyUsd: Number(saved.dailyBudgetUsd),
    managedDailyUsd: Number(saved.managedDailyUsd),
  }) };
}

export async function updatePolicyFromAgent(accountId: string, input: { advertiserId: string; targetCpaUsd?: number; observationHours?: number; reportingDelayHours?: number }) {
  const existing = await prisma.tiktokManagementPolicy.findUnique({ where: { userEmail_advertiserId: { userEmail: accountId, advertiserId: input.advertiserId } } });
  if (!existing) throw new TiktokUserError('policy_missing', 'Create the management policy in LotLister first. ChatGPT cannot set the budget or the advertiser.');
  const saved = await prisma.tiktokManagementPolicy.update({
    where: { id: existing.id },
    data: {
      targetCpaUsd: input.targetCpaUsd ?? undefined,
      observationHours: input.observationHours ?? undefined,
      reportingDelayHours: input.reportingDelayHours ?? undefined,
    },
  });
  await prisma.tiktokChange.create({
    data: {
      userEmail: accountId,
      advertiserId: input.advertiserId,
      action: 'policy_update',
      entityType: 'policy',
      reason: 'ChatGPT changed the target CPA, observation window, or reporting delay. Budget and product scope were not changed.',
      beforeJson: JSON.stringify(toPublicPolicy(existing)),
      afterJson: JSON.stringify(toPublicPolicy(saved)),
      status: 'verified',
    },
  });
  return toPublicPolicy(saved);
}

async function page<T>(load: (page: number) => Promise<{ list?: T[]; page_info?: { total_page?: number } }>, pageNumber: number): Promise<{ list: T[]; page: number; hasMore: boolean }> {
  const data = await load(pageNumber);
  const total = data.page_info?.total_page ?? pageNumber;
  return { list: data.list ?? [], page: pageNumber, hasMore: pageNumber < total };
}

export async function listCampaigns(accountId: string, advertiserId: string, pageNumber = 1) {
  const { client, connection } = await clientFor(accountId);
  selectedAdvertiser(connection, advertiserId);
  const managed = await prisma.tiktokManagedCampaign.findMany({ where: { userEmail: accountId, advertiserId } });
  const managedIds = new Set(managed.map((item) => item.campaignId));
  const result = await page(
    (page) => client.get(ENDPOINTS.campaigns, { advertiser_id: advertiserId, page: String(page), page_size: '20' }),
    pageNumber,
  );
  return {
    ...result,
    list: (result.list as Array<Record<string, unknown>>).map((item) => ({
      ...item,
      managed: managedIds.has(String(item.campaign_id ?? '')),
    })),
    unmanagedSpendNote: 'Spend on campaigns that are not managed is account exposure. Those campaigns are not changed by Box Buddy tools.',
  };
}

export async function getCampaign(accountId: string, advertiserId: string, campaignId: string) {
  const { client, connection } = await clientFor(accountId);
  selectedAdvertiser(connection, advertiserId);
  const data = await client.get<{ list?: unknown[] }>(ENDPOINTS.campaigns, {
    advertiser_id: advertiserId,
    filtering: JSON.stringify({ campaign_ids: [campaignId] }),
    page_size: '1',
  });
  return { campaign: data.list?.[0] ?? null };
}

export async function listAdGroups(accountId: string, advertiserId: string, campaignId: string | null, pageNumber = 1) {
  const { client, connection } = await clientFor(accountId);
  selectedAdvertiser(connection, advertiserId);
  const filtering = campaignId ? { campaign_ids: [campaignId] } : undefined;
  return page(
    (page) => client.get(ENDPOINTS.adgroups, {
      advertiser_id: advertiserId,
      page: String(page),
      page_size: '20',
      ...(filtering ? { filtering: JSON.stringify(filtering) } : {}),
    }),
    pageNumber,
  );
}

export async function listAds(accountId: string, advertiserId: string, adgroupId: string | null, pageNumber = 1) {
  const { client, connection } = await clientFor(accountId);
  selectedAdvertiser(connection, advertiserId);
  const filtering = adgroupId ? { adgroup_ids: [adgroupId] } : undefined;
  return page(
    (page) => client.get(ENDPOINTS.ads, {
      advertiser_id: advertiserId,
      page: String(page),
      page_size: '20',
      ...(filtering ? { filtering: JSON.stringify(filtering) } : {}),
    }),
    pageNumber,
  );
}

export async function performance(accountId: string, input: {
  advertiserId: string;
  startDate: string;
  endDate: string;
  breakdown: 'none' | 'day' | 'hour';
  level: 'campaign' | 'adgroup' | 'ad' | 'advertiser';
  report: 'auction' | 'gmv_max';
  managedOnly: boolean;
}) {
  assertReportWindow(input);
  const { client, connection } = await clientFor(accountId);
  const advertiser = selectedAdvertiser(connection, input.advertiserId);
  const dimensions = ['campaign_id'];
  if (input.breakdown === 'day') dimensions.push('stat_time_day');
  if (input.breakdown === 'hour') dimensions.push('stat_time_hour');
  if (input.report === 'gmv_max') {
    const data = await client.get<{ list?: Array<{ metrics?: Record<string, unknown> }> }>(ENDPOINTS.gmvReport, {
      advertiser_id: input.advertiserId,
      start_date: input.startDate,
      end_date: input.endDate,
      dimensions: JSON.stringify(dimensions),
    });
    return {
      report: 'gmv_max',
      rows: (data.list ?? []).map((row) => normalizeGmvMaxReport(row.metrics ?? {}, { currency: advertiser.currency, timezone: advertiser.timezone })),
    };
  }
  const dataLevel = input.level === 'ad' ? 'AUCTION_AD' : input.level === 'adgroup' ? 'AUCTION_ADGROUP' : input.level === 'advertiser' ? 'AUCTION_ADVERTISER' : 'AUCTION_CAMPAIGN';
  const data = await client.get<{ list?: Array<{ dimensions?: Record<string, unknown>; metrics?: Record<string, unknown> }> }>(ENDPOINTS.report, {
    advertiser_id: input.advertiserId,
    report_type: 'BASIC',
    data_level: dataLevel,
    start_date: input.startDate,
    end_date: input.endDate,
    dimensions: JSON.stringify(input.level === 'advertiser' ? dimensions.filter((item) => item.startsWith('stat_')) : dimensions),
    metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'engagements', 'video_play_actions', 'ctr', 'cpc', 'cpm', 'total_landing_page_view', 'web_event_add_to_cart', 'initiate_checkout', 'complete_payment', 'total_complete_payment_rate']),
    page_size: '100',
  });
  const managed = input.managedOnly
    ? new Set((await prisma.tiktokManagedCampaign.findMany({ where: { userEmail: accountId, advertiserId: input.advertiserId } })).map((item) => item.campaignId))
    : null;
  const rows = (data.list ?? []).filter((row) => !managed || managed.has(String(row.dimensions?.campaign_id ?? ''))).map((row) => ({
    dimensions: row.dimensions ?? {},
    metrics: normalizeAuctionReport(row.metrics ?? {}, { currency: advertiser.currency, timezone: advertiser.timezone }),
    managed: managed ? true : undefined,
  }));
  return { report: 'auction', currency: advertiser.currency, timezone: advertiser.timezone, rows };
}

export async function searchTargeting(accountId: string, advertiserId: string, query: string) {
  const { client, connection } = await clientFor(accountId);
  selectedAdvertiser(connection, advertiserId);
  const data = await client.get<unknown>(ENDPOINTS.targetingSearch, { advertiser_id: advertiserId, search_keywords: query });
  return { query, results: data, note: 'These are TikTok targeting options for this advertiser. Choosing one does not change an ad until an authorized update names an ad group.' };
}

export async function listPosts(accountId: string, advertiserId: string) {
  const { client, connection } = await clientFor(accountId);
  selectedAdvertiser(connection, advertiserId);
  const identities = await client.get<{ identity_list?: unknown[] }>(ENDPOINTS.identityGet, { advertiser_id: advertiserId });
  let videos: unknown = null;
  let videoError: string | null = null;
  try {
    videos = await client.get(ENDPOINTS.videoList, { advertiser_id: advertiserId });
  } catch (error) {
    videoError = error instanceof Error ? error.message : 'TikTok did not return posts.';
  }
  return {
    identities: identities.identity_list ?? [],
    posts: videos,
    videoError,
    note: 'Only posts TikTok marks as usable for Spark Ads, with an unexpired identity authorization, can be promoted. @obdcollect organic posts are not assumed to be eligible.',
  };
}

export async function trackingStatus(accountId: string, advertiserId: string) {
  const { client, connection } = await clientFor(accountId);
  const advertiser = selectedAdvertiser(connection, advertiserId);
  try {
    const pixels = await client.get<{ pixels?: Array<{ pixel_id?: string; pixel_name?: string; events?: Array<{ event_type?: string; optimization_event?: string }> }> }>(ENDPOINTS.pixelList, { advertiser_id: advertiserId });
    const list = pixels.pixels ?? [];
    return {
      currency: advertiser.currency,
      timezone: advertiser.timezone,
      pixels: list.map((pixel) => ({
        pixelId: pixel.pixel_id ?? null,
        name: pixel.pixel_name ?? null,
        events: (pixel.events ?? []).map((event) => event.optimization_event || event.event_type || null),
      })),
      purchaseEvent: list.some((pixel) => (pixel.events ?? []).some((event) => /complete_payment|purchase/i.test(`${event.optimization_event ?? ''} ${event.event_type ?? ''}`))),
    };
  } catch (error) {
    return {
      currency: advertiser.currency,
      timezone: advertiser.timezone,
      pixels: null,
      purchaseEvent: null,
      reason: error instanceof Error ? error.message : 'Pixel list is unavailable for this advertiser.',
    };
  }
}

export interface WebsitePreviewInput {
  advertiserId: string;
  campaignName: string;
  productUrl: string;
  dailyBudgetUsd: number;
  identityId?: string;
  postId?: string;
  pixelId?: string;
  optimizationEvent?: string;
  audienceSummary: string;
}

export async function previewWebsiteCampaign(accountId: string, input: WebsitePreviewInput) {
  const kind = capability('website_sales');
  if (!kind.create) throw new TiktokUserError('unsupported_campaign', kind.reason);
  assertBoxBuddy(`${input.campaignName} ${input.productUrl}`);
  const connection = await ownedConnection(accountId);
  const advertiser = selectedAdvertiser(connection, input.advertiserId);
  const policy = await prisma.tiktokManagementPolicy.findUnique({ where: { userEmail_advertiserId: { userEmail: accountId, advertiserId: input.advertiserId } } });
  if (!policy) throw new TiktokUserError('policy_missing', 'Save the Box Buddy policy and authorize the dynamic-budget peak before previewing a launch.');
  const budget = assessDailyBudget({
    requestedDailyUsd: input.dailyBudgetUsd,
    currency: advertiser.currency,
    peakSpendAuthorizedUsd: policy.peakSpendAuthorizedUsd == null ? null : Number(policy.peakSpendAuthorizedUsd),
    authorizedDailyUsd: Number(policy.dailyBudgetUsd),
    managedDailyUsd: Number(policy.managedDailyUsd),
  });
  const preview = {
    account: { advertiserId: advertiser.advertiserId, name: advertiser.name, currency: advertiser.currency, timezone: advertiser.timezone },
    objective: 'SALES',
    salesDestination: 'WEBSITE',
    optimizationEvent: input.optimizationEvent ?? null,
    productUrl: input.productUrl,
    audience: input.audienceSummary,
    creative: input.postId ? { format: 'spark_ad', identityId: input.identityId ?? null, postId: input.postId } : { format: 'not_selected', identityId: null, postId: null },
    budget,
    operationStatus: 'DISABLE',
    duration: policy.endDate?.toISOString() ?? null,
    totalTestCapUsd: policy.totalTestCapUsd == null ? null : Number(policy.totalTestCapUsd),
    capabilities: { promote: capability('promote'), gmvMax: capability('gmv_max'), shopSales: capability('shop_sales'), sparkAd: capability('spark_ad') },
  };
  if (!budget.allowed) return { created: false, preview, authorization: 'Launch is blocked until the budget check passes.' };
  const hash = payloadHash(preview);
  const row = await prisma.tiktokPreview.create({
    data: {
      userEmail: accountId,
      advertiserId: input.advertiserId,
      payloadHash: hash,
      payloadJson: JSON.stringify({ ...preview, campaignName: input.campaignName, pixelId: input.pixelId ?? null }),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { created: false, previewId: row.id, preview, authorization: 'This preview does not create a campaign. Authorize it in LotLister, then call tiktok_campaign_create with this previewId.' };
}

export async function authorizePreview(accountId: string, previewId: string) {
  const preview = await prisma.tiktokPreview.findFirst({ where: { id: previewId, userEmail: accountId } });
  if (!preview || preview.expiresAt.getTime() < Date.now() || preview.consumedAt) {
    throw new TiktokUserError('preview_invalid', 'That preview expired or was already used. Create a new preview.');
  }
  await prisma.tiktokPreview.update({ where: { id: preview.id }, data: { authorizedAt: new Date() } });
  return { previewId, authorized: true };
}

function requestId(idempotencyKey: string): string {
  const hex = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 15);
  return String(BigInt(`0x${hex}`));
}

export async function createAuthorizedCampaign(accountId: string, input: { previewId: string; idempotencyKey: string; reason: string }) {
  const existing = await prisma.tiktokChange.findUnique({ where: { userEmail_idempotencyKey: { userEmail: accountId, idempotencyKey: input.idempotencyKey } } });
  if (existing) return { duplicate: true, changeId: existing.id, status: existing.status, after: existing.afterJson ? JSON.parse(existing.afterJson) : null };
  const preview = await prisma.tiktokPreview.findFirst({ where: { id: input.previewId, userEmail: accountId } });
  if (!preview || !preview.authorizedAt || preview.consumedAt || preview.expiresAt.getTime() < Date.now()) {
    throw new TiktokUserError('authorization_required', 'Initial activation requires the LotLister user to authorize this preview. Text in the tool call is not authorization.');
  }
  const payload = JSON.parse(preview.payloadJson) as { campaignName: string; productUrl: string; budget: { requestedDailyUsd: number; allowed: boolean }; account: { advertiserId: string; currency: string | null } };
  if (!payload.budget.allowed) throw new TiktokUserError('budget_blocked', 'This preview is blocked by the budget policy.');
  assertBoxBuddy(`${payload.campaignName} ${payload.productUrl}`);
  const gate = await prisma.tiktokManagementPolicy.findUnique({
    where: { userEmail_advertiserId: { userEmail: accountId, advertiserId: payload.account.advertiserId } },
  });
  if (gate?.emergencyPaused) throw new TiktokUserError('emergency_pause', 'Emergency pause is on. A new campaign was not created.');
  if (gate?.endDate && gate.endDate.getTime() < Date.now()) {
    throw new TiktokUserError('test_ended', 'The management policy end date has passed. Launch is blocked.');
  }
  if (gate?.totalTestCapUsd != null && Number(gate.totalTestCapUsd) + 0.001 < payload.budget.requestedDailyUsd) {
    throw new TiktokUserError('above_authorized_total', `The total test cap is $${Number(gate.totalTestCapUsd)}, which is below this $${payload.budget.requestedDailyUsd} daily budget. Launch is blocked.`);
  }
  const reserved = await prisma.$transaction(async (tx) => {
    const policy = await tx.tiktokManagementPolicy.findUnique({
      where: { userEmail_advertiserId: { userEmail: accountId, advertiserId: payload.account.advertiserId } },
    });
    if (!policy) return null;
    const next = reserveDailyBudget(Number(policy.managedDailyUsd), payload.budget.requestedDailyUsd, Number(policy.dailyBudgetUsd));
    if (next == null) return null;
    const updated = await tx.tiktokManagementPolicy.updateMany({
      where: { id: policy.id, managedDailyUsd: policy.managedDailyUsd },
      data: { managedDailyUsd: next },
    });
    return updated.count === 1;
  });
  if (!reserved) {
    const policy = await prisma.tiktokManagementPolicy.findUnique({ where: { userEmail_advertiserId: { userEmail: accountId, advertiserId: payload.account.advertiserId } } });
    const check = assessDailyBudget({
      requestedDailyUsd: payload.budget.requestedDailyUsd,
      currency: payload.account.currency,
      peakSpendAuthorizedUsd: policy?.peakSpendAuthorizedUsd == null ? null : Number(policy.peakSpendAuthorizedUsd),
      authorizedDailyUsd: policy ? Number(policy.dailyBudgetUsd) : 0,
      managedDailyUsd: policy ? Number(policy.managedDailyUsd) : 0,
    });
    throw new TiktokUserError(check.code, check.message);
  }
  const { client } = await clientFor(accountId);
  const body = {
    advertiser_id: payload.account.advertiserId,
    objective_type: 'WEB_CONVERSIONS',
    virtual_objective_type: 'SALES',
    sales_destination: 'WEBSITE',
    campaign_name: payload.campaignName,
    budget_optimize_on: true,
    budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET',
    budget: payload.budget.requestedDailyUsd,
    operation_status: 'DISABLE',
    request_id: requestId(input.idempotencyKey),
  };
  let campaignId = '';
  try {
    const created = await client.post<{ campaign_id?: string }>(ENDPOINTS.campaignCreate, body);
    campaignId = String(created.campaign_id ?? '');
    await client.post(ENDPOINTS.campaignStatus, { advertiser_id: payload.account.advertiserId, campaign_ids: [campaignId], operation_status: 'DISABLE' });
    const verified = await client.get<{ list?: Array<{ operation_status?: string; budget?: number }> }>(ENDPOINTS.campaigns, {
      advertiser_id: payload.account.advertiserId,
      filtering: JSON.stringify({ campaign_ids: [campaignId] }),
    });
    const actual = verified.list?.[0];
    if (actual?.operation_status !== 'DISABLE') {
      throw new TiktokUserError('unverified', 'TikTok did not confirm the campaign is paused. It was not marked as launched. The daily reservation was kept so a retry does not create a second campaign.');
    }
    return recordCreatedCampaign(accountId, preview.id, input, payload, campaignId, actual.budget ?? payload.budget.requestedDailyUsd, 'verified');
  } catch (error) {
    if (campaignId) {
      await recordCreatedCampaign(accountId, preview.id, input, payload, campaignId, payload.budget.requestedDailyUsd, 'unverified').catch(() => undefined);
      if (error instanceof TiktokUserError) throw error;
      throw new TiktokUserError('unverified', 'The create call did not finish cleanly. The campaign id was recorded and a second create was not sent.');
    }
    await releaseDailyReservation(accountId, payload.account.advertiserId, payload.budget.requestedDailyUsd);
    const found = await client.get<{ list?: Array<{ campaign_id?: string; operation_status?: string }> }>(ENDPOINTS.campaigns, {
      advertiser_id: payload.account.advertiserId,
      filtering: JSON.stringify({ campaign_name: payload.campaignName }),
    }).catch(() => ({ list: [] as Array<{ campaign_id?: string }> }));
    const existingId = found.list?.[0]?.campaign_id ? String(found.list[0].campaign_id) : '';
    if (existingId) {
      await reserveAgain(accountId, payload.account.advertiserId, payload.budget.requestedDailyUsd);
      return recordCreatedCampaign(accountId, preview.id, input, payload, existingId, payload.budget.requestedDailyUsd, 'reconciled');
    }
    throw error;
  }
}

async function releaseDailyReservation(accountId: string, advertiserId: string, amount: number) {
  const policy = await prisma.tiktokManagementPolicy.findUnique({ where: { userEmail_advertiserId: { userEmail: accountId, advertiserId } } });
  if (!policy) return;
  const next = Math.max(0, Math.round((Number(policy.managedDailyUsd) - amount) * 100) / 100);
  await prisma.tiktokManagementPolicy.updateMany({
    where: { id: policy.id, managedDailyUsd: policy.managedDailyUsd },
    data: { managedDailyUsd: next },
  });
}

async function reserveAgain(accountId: string, advertiserId: string, amount: number) {
  await prisma.$transaction(async (tx) => {
    const policy = await tx.tiktokManagementPolicy.findUnique({ where: { userEmail_advertiserId: { userEmail: accountId, advertiserId } } });
    if (!policy) return;
    const next = reserveDailyBudget(Number(policy.managedDailyUsd), amount, Number(policy.dailyBudgetUsd));
    if (next == null) return;
    await tx.tiktokManagementPolicy.updateMany({
      where: { id: policy.id, managedDailyUsd: policy.managedDailyUsd },
      data: { managedDailyUsd: next },
    });
  });
}

async function recordCreatedCampaign(
  accountId: string,
  previewId: string,
  input: { idempotencyKey: string; reason: string },
  payload: { campaignName: string; budget: { requestedDailyUsd: number }; account: { advertiserId: string } },
  campaignId: string,
  budget: number,
  status: string,
) {
  await prisma.tiktokManagedCampaign.create({
    data: { userEmail: accountId, advertiserId: payload.account.advertiserId, campaignId, dailyBudget: payload.budget.requestedDailyUsd, kind: 'website_sales' },
  }).catch(() => undefined);
  await prisma.tiktokPreview.update({ where: { id: previewId }, data: { consumedAt: new Date() } });
  const change = await prisma.tiktokChange.create({
    data: {
      userEmail: accountId,
      advertiserId: payload.account.advertiserId,
      action: 'campaign_create',
      entityType: 'campaign',
      entityId: campaignId,
      reason: input.reason,
      afterJson: JSON.stringify({ campaignId, operationStatus: 'DISABLE', budget, salesDestination: 'WEBSITE', campaignName: payload.campaignName }),
      idempotencyKey: input.idempotencyKey,
      status,
    },
  });
  return { duplicate: false, reconciled: status === 'reconciled', changeId: change.id, campaignId, operationStatus: 'DISABLE', launched: false, status };
}

async function managedGate(accountId: string, advertiserId: string, campaignId: string, raisesBudget: boolean, productText?: string, pausing = false) {
  const policy = await prisma.tiktokManagementPolicy.findUnique({ where: { userEmail_advertiserId: { userEmail: accountId, advertiserId } } });
  const managed = await prisma.tiktokManagedCampaign.findMany({ where: { userEmail: accountId, advertiserId } });
  assertRoutineChange(policy ? {
    advertiserId: policy.advertiserId,
    emergencyPaused: policy.emergencyPaused,
    routineAdjustments: policy.routineAdjustments,
    dailyBudgetUsd: Number(policy.dailyBudgetUsd),
    productScope: policy.productScope,
  } : null, {
    advertiserId,
    campaignId,
    managedCampaignIds: managed.map((item) => item.campaignId),
    raisesBudget,
    productText,
    pausing,
  });
}

export async function updateAdGroup(accountId: string, input: { advertiserId: string; campaignId: string; adgroupId: string; patch: Record<string, unknown>; reason: string; idempotencyKey: string }) {
  if ('budget' in input.patch) throw new TiktokUserError('budget_authorization', 'Ad group budget changes are not accepted from ChatGPT.');
  await managedGate(accountId, input.advertiserId, input.campaignId, false);
  return mutate(accountId, input.idempotencyKey, input.advertiserId, 'adgroup_update', 'adgroup', input.adgroupId, input.reason, async (client) => {
    const before = await client.get(ENDPOINTS.adgroups, { advertiser_id: input.advertiserId, filtering: JSON.stringify({ adgroup_ids: [input.adgroupId] }) });
    const after = await client.post(ENDPOINTS.adgroupUpdate, { advertiser_id: input.advertiserId, adgroup_id: input.adgroupId, ...input.patch });
    return { before, after };
  });
}

export async function createAd(accountId: string, input: { advertiserId: string; campaignId: string; adgroupId: string; name: string; postId?: string; identityId?: string; landingPageUrl?: string; reason: string; idempotencyKey: string }) {
  assertBoxBuddy(input.name);
  if (input.landingPageUrl) assertBoxBuddy(input.landingPageUrl);
  await managedGate(accountId, input.advertiserId, input.campaignId, false, input.landingPageUrl ?? input.name);
  if (!input.postId && !input.landingPageUrl) {
    throw new TiktokUserError('creative_required', 'Pass an eligible Spark post or a Box Buddy product URL. LotLister will not invent a creative.');
  }
  if (input.postId && !input.identityId) {
    throw new TiktokUserError('spark_authorization', capability('spark_ad').reason);
  }
  return mutate(accountId, input.idempotencyKey, input.advertiserId, 'ad_create', 'ad', null, input.reason, async (client) => {
    let spark: { expiresAt: string | null; reason: string } | null = null;
    if (input.postId) {
      const videos = await client.get(ENDPOINTS.videoList, { advertiser_id: input.advertiserId });
      const status = sparkPostStatus(videos, input.postId);
      if (!status.eligible) throw new TiktokUserError('spark_authorization', status.reason);
      spark = status;
    }
    const after = await client.post(ENDPOINTS.adCreate, {
      advertiser_id: input.advertiserId,
      adgroup_id: input.adgroupId,
      creatives: [{
        ad_name: input.name,
        operation_status: 'DISABLE',
        ...(input.landingPageUrl ? { landing_page_url: input.landingPageUrl } : {}),
        ...(input.postId ? { tiktok_item_id: input.postId, identity_id: input.identityId, identity_type: 'TT_USER', ad_format: 'SINGLE_VIDEO' } : {}),
      }],
    });
    return { before: null, after: { after, spark } };
  });
}

export async function updateAd(accountId: string, input: { advertiserId: string; campaignId: string; adId: string; patch: Record<string, unknown>; reason: string; idempotencyKey: string }) {
  if ('budget' in input.patch) throw new TiktokUserError('budget_authorization', 'Ad budget changes are not accepted from ChatGPT.');
  await managedGate(accountId, input.advertiserId, input.campaignId, false);
  return mutate(accountId, input.idempotencyKey, input.advertiserId, 'ad_update', 'ad', input.adId, input.reason, async (client) => {
    const before = await client.get(ENDPOINTS.ads, { advertiser_id: input.advertiserId, filtering: JSON.stringify({ ad_ids: [input.adId] }) });
    const after = await client.post(ENDPOINTS.adUpdate, { advertiser_id: input.advertiserId, ad_id: input.adId, ...input.patch });
    return { before, after };
  });
}

export async function updateStatus(accountId: string, input: { advertiserId: string; campaignId: string; entityType: 'campaign' | 'adgroup' | 'ad'; entityId: string; operationStatus: 'ENABLE' | 'DISABLE'; reason: string; idempotencyKey: string }) {
  const policy = await prisma.tiktokManagementPolicy.findUnique({ where: { userEmail_advertiserId: { userEmail: accountId, advertiserId: input.advertiserId } } });
  if (policy?.emergencyPaused && input.operationStatus === 'ENABLE') {
    throw new TiktokUserError('emergency_pause', 'Emergency pause is on. Enabling a managed ad is blocked.');
  }
  await managedGate(accountId, input.advertiserId, input.campaignId, false, undefined, input.operationStatus === 'DISABLE');
  const endpoint = input.entityType === 'campaign' ? ENDPOINTS.campaignStatus : input.entityType === 'adgroup' ? ENDPOINTS.adgroupStatus : ENDPOINTS.adStatus;
  const idField = input.entityType === 'campaign' ? 'campaign_ids' : input.entityType === 'adgroup' ? 'adgroup_ids' : 'ad_ids';
  return mutate(accountId, input.idempotencyKey, input.advertiserId, 'status_update', input.entityType, input.entityId, input.reason, async (client) => {
    const after = await client.post(endpoint, { advertiser_id: input.advertiserId, [idField]: [input.entityId], operation_status: input.operationStatus });
    return { before: null, after };
  });
}

async function mutate(accountId: string, idempotencyKey: string, advertiserId: string, action: string, entityType: string, entityId: string | null, reason: string, run: (client: TiktokClient) => Promise<{ before: unknown; after: unknown }>) {
  const existing = await prisma.tiktokChange.findUnique({ where: { userEmail_idempotencyKey: { userEmail: accountId, idempotencyKey } } });
  const decision = decideIdempotency(existing, action);
  if (decision === 'conflict') throw new TiktokUserError('idempotency_conflict', 'That idempotency key was already used for a different change.');
  if (decision === 'duplicate' && existing) return { duplicate: true, changeId: existing.id, status: existing.status };
  const { client } = await clientFor(accountId);
  const result = await run(client);
  const change = await prisma.tiktokChange.create({
    data: {
      userEmail: accountId,
      advertiserId,
      action,
      entityType,
      entityId,
      reason,
      beforeJson: result.before == null ? null : JSON.stringify(result.before),
      afterJson: JSON.stringify(result.after),
      idempotencyKey,
      status: 'verified',
    },
  });
  return { duplicate: false, changeId: change.id, status: 'verified' };
}

export async function changeHistory(accountId: string, advertiserId: string) {
  const rows = await prisma.tiktokChange.findMany({
    where: { userEmail: accountId, advertiserId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    reason: row.reason,
    status: row.status,
    before: row.beforeJson ? JSON.parse(row.beforeJson) : null,
    after: row.afterJson ? JSON.parse(row.afterJson) : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function emergencyPause(accountId: string, advertiserId: string) {
  const connection = await ownedConnection(accountId);
  selectedAdvertiser(connection, advertiserId);
  await prisma.tiktokManagementPolicy.updateMany({ where: { userEmail: accountId, advertiserId }, data: { emergencyPaused: true } });
  const managed = await prisma.tiktokManagedCampaign.findMany({ where: { userEmail: accountId, advertiserId } });
  const { client } = await clientFor(accountId);
  const ids = managed.map((item) => item.campaignId);
  if (ids.length > 0) {
    await client.post(ENDPOINTS.campaignStatus, { advertiser_id: advertiserId, campaign_ids: ids, operation_status: 'DISABLE' });
  }
  await prisma.tiktokChange.create({
    data: { userEmail: accountId, advertiserId, action: 'emergency_pause', entityType: 'policy', reason: 'User emergency pause', afterJson: JSON.stringify({ campaignIds: ids }), status: 'verified' },
  });
  return { emergencyPaused: true, pausedCampaignIds: ids };
}

export async function runScheduledReview(accountId: string, now = new Date()) {
  const policies = await prisma.tiktokManagementPolicy.findMany({ where: { userEmail: accountId, scheduledReviewEnabled: true } });
  return reviewPolicies(policies, now);
}

export async function runAllScheduledReviews(now = new Date()) {
  const policies = await prisma.tiktokManagementPolicy.findMany({ where: { scheduledReviewEnabled: true } });
  return reviewPolicies(policies, now);
}

async function reviewPolicies(policies: Array<{
  userEmail: string;
  advertiserId: string;
  safetyRulesEnabled: boolean;
  reportingDelayHours: number;
  observationHours: number;
  minPurchasesBeforePause: number;
  targetCpaUsd: { toString(): string };
}>, now: Date) {
  const summaries: string[] = [];
  for (const policy of policies) {
    const summary = await reviewOne(policy, now);
    summaries.push(summary);
    await prisma.tiktokReviewRun.create({ data: { userEmail: policy.userEmail, advertiserId: policy.advertiserId, summary } });
  }
  if (policies.length === 0) summaries.push('Scheduled review is disabled for every advertiser. No ads were created or changed.');
  return {
    ranAt: now.toISOString(),
    scheduleTimezone: 'America/New_York',
    summaries,
    note: 'This job collects a report and can pause a managed campaign when a saved safety rule says so. It does not create ads, change audiences, or raise budgets. ChatGPT does not run because this route exists.',
  };
}

function advertiserDay(timeZone: string | null, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

async function reviewOne(policy: {
  userEmail: string;
  advertiserId: string;
  safetyRulesEnabled: boolean;
  reportingDelayHours: number;
  observationHours: number;
  minPurchasesBeforePause: number;
  targetCpaUsd: { toString(): string };
}, now: Date): Promise<string> {
  const managed = await prisma.tiktokManagedCampaign.findMany({ where: { userEmail: policy.userEmail, advertiserId: policy.advertiserId } });
  if (!policy.safetyRulesEnabled) {
    return `${policy.advertiserId}: scheduled collection is on and safety rules are off. ${managed.length} managed campaign(s) were left unchanged.`;
  }
  let client: TiktokClient;
  try {
    client = (await clientFor(policy.userEmail)).client;
  } catch (error) {
    return `${policy.advertiserId}: report skipped because ${error instanceof Error ? error.message : 'the connection is unavailable'}. Nothing was changed.`;
  }
  const advertiser = await prisma.tiktokAdvertiser.findFirst({ where: { userEmail: policy.userEmail, advertiserId: policy.advertiserId } });
  const day = advertiserDay(advertiser?.timezone ?? null, now);
  const notes: string[] = [];
  for (const campaign of managed) {
    const ageHours = (now.getTime() - campaign.createdAt.getTime()) / 3_600_000;
    let spend = 0;
    let purchases = 0;
    let reportReady = false;
    try {
      const data = await client.get<{ list?: Array<{ metrics?: Record<string, unknown> }> }>(ENDPOINTS.report, {
        advertiser_id: policy.advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        start_date: day,
        end_date: day,
        dimensions: JSON.stringify(['campaign_id']),
        metrics: JSON.stringify(['spend', 'complete_payment']),
        filtering: JSON.stringify([{ field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([campaign.campaignId]) }]),
        page_size: '10',
      });
      const metrics = data.list?.[0]?.metrics ?? {};
      if ('spend' in metrics && 'complete_payment' in metrics) {
        spend = Number(metrics.spend);
        purchases = Number(metrics.complete_payment);
        reportReady = Number.isFinite(spend) && Number.isFinite(purchases);
      }
    } catch (error) {
      notes.push(`${campaign.campaignId}: report unavailable (${error instanceof Error ? error.message : 'TikTok error'}). Not paused from a missing report.`);
      continue;
    }
    if (!reportReady) {
      notes.push(`${campaign.campaignId}: TikTok did not return spend and purchases. Missing numbers were not treated as zero, and the campaign was not paused.`);
      continue;
    }
    const decision = safetyPause({
      spend,
      purchases,
      ageHours,
      reportingDelayHours: policy.reportingDelayHours,
      observationHours: policy.observationHours,
      minPurchases: policy.minPurchasesBeforePause,
      targetCpaUsd: Number(policy.targetCpaUsd),
    }, true);
    if (!decision.pause) {
      notes.push(`${campaign.campaignId}: ${decision.reason}`);
      continue;
    }
    await client.post(ENDPOINTS.campaignStatus, { advertiser_id: policy.advertiserId, campaign_ids: [campaign.campaignId], operation_status: 'DISABLE' });
    await prisma.tiktokChange.create({
      data: {
        userEmail: policy.userEmail,
        advertiserId: policy.advertiserId,
        action: 'safety_pause',
        entityType: 'campaign',
        entityId: campaign.campaignId,
        reason: decision.reason,
        afterJson: JSON.stringify({ operationStatus: 'DISABLE' }),
        status: 'verified',
      },
    });
    notes.push(`${campaign.campaignId}: paused. ${decision.reason}`);
  }
  return notes.join(' ') || `${policy.advertiserId}: no managed campaigns.`;
}

export async function unsupported(kind: CampaignKind) {
  return capability(kind);
}

export { PRODUCT_SCOPE };
