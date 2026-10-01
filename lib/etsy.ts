/**
 * Etsy shop connection and listing.
 *
 * One app (ETSY_KEYSTRING and ETSY_SHARED_SECRET) is shared by this install.
 * Each seller connects their own shop. Listings are fixed-price physical
 * items: draft, photos, then active. Etsy has no auction format.
 */

import { createHash, randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { CardImage, CardItem, ExportProfile } from '@prisma/client';
import prisma from './prisma';
import { isCardReadyToList } from './ebay';
import { renderDescription } from './card-fields';
import { generateTitle } from './export-csv';
import { isAbsoluteImageUrl } from './imageUrls';
import { resolveImagePath } from './storage';
import { getComparisonDates, type DateRangeKey } from './dates';
import type { DashboardSection, EtsyData } from './dashboard-types';
import type { EbayListEvent } from './list-progress';
import { etsyErrorText, etsyLedgerProfit, etsyMoney, etsyTags, etsyTitle, plainDescription, shopFromEtsyPayload, whenMadeFromYear } from './etsy-listing';

const API = 'https://api.etsy.com/v3';
const AUTH_URL = 'https://www.etsy.com/oauth/connect';
const TOKEN_URL = `${API}/public/oauth/token`;
const SCOPES = ['listings_r', 'listings_w', 'shops_r', 'transactions_r'];

export const ETSY_OAUTH_STATE_COOKIE = 'etsy_oauth_state';
export const ETSY_OAUTH_VERIFIER_COOKIE = 'etsy_oauth_verifier';

type CardWithImages = CardItem & { images: CardImage[] };

interface EtsyCreds {
  keystring: string;
  sharedSecret: string;
}

interface EtsyTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function missingEtsyEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.ETSY_KEYSTRING?.trim()) missing.push('ETSY_KEYSTRING');
  if (!process.env.ETSY_SHARED_SECRET?.trim()) missing.push('ETSY_SHARED_SECRET');
  return missing;
}

export function getEtsyCredentials(): EtsyCreds | null {
  const keystring = process.env.ETSY_KEYSTRING?.trim();
  const sharedSecret = process.env.ETSY_SHARED_SECRET?.trim();
  if (!keystring || !sharedSecret) return null;
  return { keystring, sharedSecret };
}

export function etsyApiKey(creds: EtsyCreds): string {
  return `${creds.keystring}:${creds.sharedSecret}`;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildEtsyAuthorizeUrl(creds: EtsyCreds, redirectUri: string, state: string, challenge: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', creds.keystring);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function tokenRequest(creds: EtsyCreds, body: URLSearchParams): Promise<EtsyTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  const text = await response.text();
  if (!response.ok) throw new Error(etsyErrorText(response.status, text));
  return JSON.parse(text) as EtsyTokenResponse;
}

export async function exchangeEtsyCode(creds: EtsyCreds, redirectUri: string, code: string, verifier: string): Promise<EtsyTokenResponse> {
  return tokenRequest(
    creds,
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: creds.keystring,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    })
  );
}

function userIdFromToken(accessToken: string): string | null {
  const id = accessToken.split('.')[0];
  return /^\d+$/.test(id) ? id : null;
}

async function etsyFetch(creds: EtsyCreds, accessToken: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-api-key', etsyApiKey(creds));
  headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(`${API}${path}`, { ...init, headers, cache: 'no-store' });
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw new Error(etsyErrorText(response.status, text));
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function getValidEtsyAccessToken(userEmail: string): Promise<{ creds: EtsyCreds; accessToken: string; shopId: string }> {
  const creds = getEtsyCredentials();
  if (!creds) throw new Error(`Etsy is not configured on the server. Missing: ${missingEtsyEnvVars().join(', ')}`);
  const connection = await prisma.etsyConnection.findUnique({ where: { userEmail } });
  if (!connection) throw new Error('Connect your Etsy shop in Settings before listing');
  if (!connection.shopId) throw new Error('Etsy did not return a shop. Connect the shop again from Settings.');

  const fresh = connection.accessExpiresAt.getTime() > Date.now() + 60_000;
  if (fresh) return { creds, accessToken: connection.accessToken, shopId: connection.shopId };

  const refreshed = await tokenRequest(
    creds,
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.keystring,
      refresh_token: connection.refreshToken,
    })
  );
  await prisma.etsyConnection.update({
    where: { userEmail },
    data: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || connection.refreshToken,
      accessExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      etsyUserId: userIdFromToken(refreshed.access_token) ?? connection.etsyUserId,
    },
  });
  return { creds, accessToken: refreshed.access_token, shopId: connection.shopId };
}

export async function saveEtsyConnection(userEmail: string, token: EtsyTokenResponse): Promise<{ shopId: string; shopName: string }> {
  const creds = getEtsyCredentials();
  if (!creds) throw new Error('Etsy is not configured on the server');
  const etsyUserId = userIdFromToken(token.access_token);
  if (!etsyUserId) throw new Error('Etsy did not include a user id on the access token');
  const shops = await readJson<unknown>(
    await etsyFetch(creds, token.access_token, `/application/users/${etsyUserId}/shops`)
  );
  const shop = shopFromEtsyPayload(shops);
  if (!shop) throw new Error('This Etsy account does not have a shop yet');
  await prisma.etsyConnection.upsert({
    where: { userEmail },
    create: {
      userEmail,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      etsyUserId,
      shopId: shop.shopId,
      shopName: shop.shopName,
    },
    update: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      etsyUserId,
      shopId: shop.shopId,
      shopName: shop.shopName,
    },
  });
  return shop;
}

export interface EtsyOption {
  id: string;
  label: string;
}

function optionId(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' || (typeof value === 'string' && value.trim())) return String(value);
  }
  return null;
}

function optionLabel(row: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

async function shopOptions(creds: EtsyCreds, accessToken: string, shopId: string, path: string): Promise<Record<string, unknown>[]> {
  const body = await readJson<{ results?: Record<string, unknown>[] }>(
    await etsyFetch(creds, accessToken, `/application/shops/${shopId}${path}`)
  );
  return body.results ?? [];
}

let cardTaxonomyCache: EtsyOption[] | null = null;

export async function etsyCardTaxonomies(creds: EtsyCreds): Promise<EtsyOption[]> {
  if (cardTaxonomyCache) return cardTaxonomyCache;
  const response = await fetch(`${API}/application/seller-taxonomy/nodes`, {
    headers: { 'x-api-key': etsyApiKey(creds) },
    cache: 'no-store',
  });
  const body = await readJson<{ results?: TaxonomyNode[] }>(response);
  const found: EtsyOption[] = [];
  walkTaxonomy(body.results ?? [], '', found);
  cardTaxonomyCache = found;
  return found;
}

interface TaxonomyNode {
  id?: number;
  name?: string;
  children?: TaxonomyNode[];
}

function walkTaxonomy(nodes: TaxonomyNode[], prefix: string, out: EtsyOption[]) {
  for (const node of nodes) {
    const name = node.name?.trim() || '';
    const label = prefix && name ? `${prefix} › ${name}` : name;
    const children = node.children ?? [];
    if (children.length === 0 && node.id && /card/i.test(name)) {
      out.push({ id: String(node.id), label });
    } else if (children.length > 0) {
      walkTaxonomy(children, label, out);
    }
  }
}

export async function getEtsySettingsView(userEmail: string) {
  const missing = missingEtsyEnvVars();
  const connection = await prisma.etsyConnection.findUnique({ where: { userEmail } });
  const base = {
    configured: missing.length === 0,
    missingEnv: missing,
    connected: Boolean(connection?.shopId),
    shopId: connection?.shopId ?? null,
    shopName: connection?.shopName ?? null,
    shippingProfileId: connection?.shippingProfileId ?? '',
    readinessStateId: connection?.readinessStateId ?? '',
    returnPolicyId: connection?.returnPolicyId ?? '',
    taxonomyId: connection?.taxonomyId ? String(connection.taxonomyId) : '',
    shippingProfiles: [] as EtsyOption[],
    readinessStates: [] as EtsyOption[],
    returnPolicies: [] as EtsyOption[],
    taxonomies: [] as EtsyOption[],
  };
  if (!connection?.shopId || missing.length > 0) return base;
  try {
    const { creds, accessToken, shopId } = await getValidEtsyAccessToken(userEmail);
    const load = (path: string) => shopOptions(creds, accessToken, shopId, path).catch(() => [] as Record<string, unknown>[]);
    const [shipping, readiness, returns, taxonomies] = await Promise.all([
      load('/shipping-profiles'),
      load('/readiness-state-definitions'),
      load('/policies/return'),
      etsyCardTaxonomies(creds).catch(() => [] as EtsyOption[]),
    ]);
    base.shippingProfiles = shipping.flatMap((row) => {
      const id = optionId(row, ['shipping_profile_id']);
      return id ? [{ id, label: optionLabel(row, ['title', 'name'], `Profile ${id}`) }] : [];
    });
    base.readinessStates = readiness.flatMap((row) => {
      const id = optionId(row, ['readiness_state_id']);
      if (!id) return [];
      const days = [row.min_processing_days, row.max_processing_days].filter((value) => value !== undefined && value !== null).join('–');
      const state = optionLabel(row, ['readiness_state', 'processing_days_display_label'], 'Processing');
      return [{ id, label: days ? `${state} · ${days} days` : state }];
    });
    base.returnPolicies = returns.flatMap((row) => {
      const id = optionId(row, ['return_policy_id']);
      return id ? [{ id, label: optionLabel(row, ['title', 'name'], row.accepts_returns ? 'Accepts returns' : 'No returns') }] : [];
    });
    base.taxonomies = taxonomies;
  } catch (error) {
    return { ...base, loadError: error instanceof Error ? error.message : 'Could not load Etsy shop settings' };
  }
  return base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function imageBytes(image: CardImage): Promise<{ bytes: Buffer; filename: string; type: string } | null> {
  const source = image.originalPath?.trim();
  if (!source) return null;
  const filename = image.filename || path.basename(source.split('?')[0]) || 'card.jpg';
  const type = filename.toLowerCase().endsWith('.png') ? 'image/png' : filename.toLowerCase().endsWith('.gif') ? 'image/gif' : 'image/jpeg';
  if (isAbsoluteImageUrl(source)) {
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) return null;
    return { bytes: Buffer.from(await response.arrayBuffer()), filename, type };
  }
  const bytes = await readFile(resolveImagePath(source));
  return { bytes, filename, type };
}

async function publishCard(
  creds: EtsyCreds,
  accessToken: string,
  shopId: string,
  card: CardWithImages,
  profile: ExportProfile | null,
  settings: { shippingProfileId: string; readinessStateId: string; returnPolicyId: string | null; taxonomyId: number },
  publish: boolean
): Promise<{ listingId: string; photosUploaded: number }> {
  const title = etsyTitle(generateTitle(card));
  const description = plainDescription(renderDescription(card, title), title);
  const form = new URLSearchParams();
  form.set('quantity', '1');
  form.set('title', title);
  form.set('description', description);
  form.set('price', Number(card.salePrice).toFixed(2));
  form.set('who_made', 'someone_else');
  form.set('when_made', whenMadeFromYear(card.year));
  form.set('taxonomy_id', String(settings.taxonomyId));
  form.set('shipping_profile_id', settings.shippingProfileId);
  form.set('readiness_state_id', settings.readinessStateId);
  if (settings.returnPolicyId) form.set('return_policy_id', settings.returnPolicyId);
  form.set('type', 'physical');
  form.set('is_supply', 'false');
  form.set('should_auto_renew', publish ? 'true' : 'false');
  const tags = etsyTags([card.year, card.brand, card.setName, card.name, card.category, card.grader, 'trading card']);
  if (tags.length) form.set('tags', tags.join(','));
  if (profile?.packageWeightOz) {
    form.set('item_weight', String(profile.packageWeightOz));
    form.set('item_weight_unit', 'oz');
  }
  if (profile?.packageLengthIn && profile.packageWidthIn && profile.packageHeightIn) {
    form.set('item_length', String(profile.packageLengthIn));
    form.set('item_width', String(profile.packageWidthIn));
    form.set('item_height', String(profile.packageHeightIn));
    form.set('item_dimensions_unit', 'in');
  }

  const created = await readJson<{ listing_id?: number }>(
    await etsyFetch(creds, accessToken, `/application/shops/${shopId}/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    })
  );
  if (!created.listing_id) throw new Error('Etsy did not return a listing id');
  const listingId = String(created.listing_id);

  const images = card.images.slice().sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 10);
  let uploaded = 0;
  for (let index = 0; index < images.length; index += 1) {
    await sleep(150);
    const file = await imageBytes(images[index]);
    if (!file) continue;
    const body = new FormData();
    body.append('image', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.filename);
    body.append('rank', String(index + 1));
    const response = await etsyFetch(creds, accessToken, `/application/shops/${shopId}/listings/${listingId}/images`, {
      method: 'POST',
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${etsyErrorText(response.status, text)} Draft ${listingId} is still in your Etsy shop.`);
    }
    uploaded += 1;
  }
  if (uploaded === 0 && publish) throw new Error(`Etsy draft ${listingId} has no photos, so it was not published.`);
  if (!publish) return { listingId, photosUploaded: uploaded };

  await sleep(150);
  const activate = new URLSearchParams();
  activate.set('state', 'active');
  const published = await etsyFetch(creds, accessToken, `/application/shops/${shopId}/listings/${listingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: activate,
  });
  if (!published.ok) {
    const text = await published.text();
    throw new Error(`${etsyErrorText(published.status, text)} Draft ${listingId} is still in your Etsy shop.`);
  }
  return { listingId, photosUploaded: uploaded };
}

export async function createEtsyDraftForCard(userEmail: string, cardId: string): Promise<{
  listingId: string;
  title: string;
  state: 'draft';
  lotId: string;
  photosUploaded: boolean;
}> {
  const card = await prisma.cardItem.findFirst({
    where: { id: cardId, lot: { userEmail } },
    include: { images: { orderBy: { sortOrder: 'asc' } }, lot: { include: { exportProfile: true } } },
  });
  if (!card) throw new Error('That card is not in your lots');
  if (!isCardReadyToList(card)) throw new Error('Fill the required card fields before creating an Etsy draft');
  const connection = await prisma.etsyConnection.findUnique({ where: { userEmail } });
  if (!connection?.shippingProfileId || !connection.readinessStateId || !connection.taxonomyId) {
    throw new Error('Choose an Etsy shipping profile, processing profile, and category in Settings first');
  }
  const { creds, accessToken, shopId } = await getValidEtsyAccessToken(userEmail);
  const draft = await publishCard(
    creds,
    accessToken,
    shopId,
    card,
    card.lot.exportProfile,
    {
      shippingProfileId: connection.shippingProfileId,
      readinessStateId: connection.readinessStateId,
      returnPolicyId: connection.returnPolicyId,
      taxonomyId: connection.taxonomyId,
    },
    false
  );
  return {
    listingId: draft.listingId,
    title: etsyTitle(generateTitle(card)),
    state: 'draft',
    lotId: card.lotId,
    photosUploaded: draft.photosUploaded > 0,
  };
}

export async function listLotOnEtsy(options: {
  userEmail: string;
  cards: CardWithImages[];
  profile: ExportProfile | null;
  onEvent?: (event: EbayListEvent) => void;
}): Promise<void> {
  const { userEmail, cards, profile, onEvent } = options;
  const connection = await prisma.etsyConnection.findUnique({ where: { userEmail } });
  if (!connection?.shippingProfileId || !connection.readinessStateId || !connection.taxonomyId) {
    throw new Error('Choose an Etsy shipping profile, processing profile, and category in Settings before listing.');
  }
  const { creds, accessToken, shopId } = await getValidEtsyAccessToken(userEmail);
  const settings = {
    shippingProfileId: connection.shippingProfileId,
    readinessStateId: connection.readinessStateId,
    returnPolicyId: connection.returnPolicyId,
    taxonomyId: connection.taxonomyId,
  };

  let skippedNotReady = 0;
  let skippedAlreadyListed = 0;
  const ready: CardWithImages[] = [];
  for (const card of cards.slice().sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (card.etsyListingId) {
      skippedAlreadyListed += 1;
      continue;
    }
    if (!isCardReadyToList(card)) {
      skippedNotReady += 1;
      continue;
    }
    ready.push(card);
  }
  if (ready.length === 0) {
    throw new Error(
      skippedAlreadyListed > 0 && skippedNotReady === 0
        ? 'Every ready card in this lot is already listed on Etsy'
        : 'No cards are ready to list. Fill the required fields first.'
    );
  }

  onEvent?.({
    type: 'start',
    channel: 'Etsy',
    total: ready.length,
    skippedNotReady,
    skippedAlreadyListed,
    remainingReady: 0,
    cards: ready.map((card) => ({
      cardId: card.id,
      title: etsyTitle(generateTitle(card)),
      format: 'Buy Now',
      price: card.salePrice === null || card.salePrice === undefined ? null : Number(card.salePrice),
      category: card.category?.trim() || '',
    })),
  });

  const results = [];
  for (let index = 0; index < ready.length; index += 1) {
    const card = ready[index];
    const title = etsyTitle(generateTitle(card));
    onEvent?.({ type: 'sending', cardId: card.id, index: index + 1, total: ready.length });
    try {
      const published = await publishCard(creds, accessToken, shopId, card, profile, settings, true);
      const listingUrl = `https://www.etsy.com/listing/${published.listingId}`;
      await prisma.cardItem.update({
        where: { id: card.id },
        data: {
          etsyListingId: published.listingId,
          etsyListedAt: new Date(),
          status: 'Exported',
          listings: card.listings?.trim() ? card.listings : listingUrl,
        },
      });
      results.push({ cardId: card.id, title, success: true, listingUrl });
    } catch (error) {
      results.push({
        cardId: card.id,
        title,
        success: false,
        error: error instanceof Error ? error.message : 'Etsy rejected this listing',
      });
    }
    const latest = results[results.length - 1];
    onEvent?.({ type: 'result', index: index + 1, total: ready.length, result: latest });
    if (index < ready.length - 1) await sleep(200);
  }

  const listedCount = results.filter((result) => result.success).length;
  onEvent?.({
    type: 'done',
    summary: {
      listedCount,
      failedCount: results.length - listedCount,
      skippedNotReady,
      skippedAlreadyListed,
      remainingReady: 0,
      results,
    },
  });
}

interface EtsyReceipt {
  receipt_id?: number;
  created_timestamp?: number;
  is_shipped?: boolean;
  was_paid?: boolean;
  subtotal?: { amount?: number; divisor?: number };
  total_shipping_cost?: { amount?: number; divisor?: number };
  grandtotal?: { amount?: number; divisor?: number };
  transactions?: { title?: string; quantity?: number }[];
}

function receiptRevenue(receipt: EtsyReceipt): number {
  const items = etsyMoney(receipt.subtotal);
  const shipping = etsyMoney(receipt.total_shipping_cost);
  if (items || shipping) return items + shipping;
  return etsyMoney(receipt.grandtotal);
}

function receiptUnits(receipt: EtsyReceipt): number {
  const units = (receipt.transactions ?? []).reduce((sum, line) => sum + (line.quantity || 0), 0);
  return units || 1;
}

async function fetchReceipts(creds: EtsyCreds, accessToken: string, shopId: string, from: Date, to: Date): Promise<EtsyReceipt[]> {
  const receipts: EtsyReceipt[] = [];
  for (let page = 0; page < 15; page += 1) {
    const query = new URLSearchParams({
      min_created: String(Math.floor(from.getTime() / 1000)),
      max_created: String(Math.floor(to.getTime() / 1000)),
      limit: '100',
      offset: String(page * 100),
      sort_on: 'created',
      sort_order: 'desc',
    });
    const body = await readJson<{ results?: EtsyReceipt[] }>(
      await etsyFetch(creds, accessToken, `/application/shops/${shopId}/receipts?${query}`)
    );
    const batch = body.results ?? [];
    receipts.push(...batch.filter((receipt) => receipt.was_paid !== false));
    if (batch.length < 100) break;
    await sleep(120);
  }
  return receipts;
}

function dailyRevenue(from: Date, to: Date, receipts: EtsyReceipt[]): number[] {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const days: string[] = [];
  for (let time = from.getTime(); time <= to.getTime(); time += 24 * 60 * 60 * 1000) {
    const key = format.format(new Date(time));
    if (days[days.length - 1] !== key) days.push(key);
  }
  const end = format.format(to);
  if (days[days.length - 1] !== end) days.push(end);
  const totals = new Map(days.map((day) => [day, 0]));
  for (const receipt of receipts) {
    if (!receipt.created_timestamp) continue;
    const key = format.format(new Date(receipt.created_timestamp * 1000));
    if (!totals.has(key)) continue;
    totals.set(key, (totals.get(key) ?? 0) + receiptRevenue(receipt));
  }
  return days.map((day) => Math.round((totals.get(day) ?? 0) * 100) / 100);
}

function summarize(receipts: EtsyReceipt[]) {
  return receipts.reduce(
    (totals, receipt) => {
      totals.revenue += receiptRevenue(receipt);
      totals.orders += 1;
      totals.units += receiptUnits(receipt);
      return totals;
    },
    { revenue: 0, orders: 0, units: 0 }
  );
}

interface EtsyLedgerEntry {
  amount?: number;
  ledger_type?: string;
}

async function fetchLedger(creds: EtsyCreds, accessToken: string, shopId: string, from: Date, to: Date): Promise<EtsyLedgerEntry[]> {
  const entries: EtsyLedgerEntry[] = [];
  for (let page = 0; page < 15; page += 1) {
    const query = new URLSearchParams({
      min_created: String(Math.floor(from.getTime() / 1000)),
      max_created: String(Math.floor(to.getTime() / 1000)),
      limit: '100',
      offset: String(page * 100),
    });
    const body = await readJson<{ results?: EtsyLedgerEntry[] }>(
      await etsyFetch(creds, accessToken, `/application/shops/${shopId}/payment-account/ledger-entries?${query}`)
    );
    const batch = body.results ?? [];
    entries.push(...batch);
    if (batch.length < 100) break;
    await sleep(120);
  }
  return entries;
}

function emptyEtsy(state: EtsyData['state'], shop: string | null = null): EtsyData {
  return { state, shop, revenue: 0, profit: null, fees: null, orders: 0, units: 0, unshipped: 0, daily: [], recent: [] };
}

export async function getEtsyDashboard(
  userEmail: string,
  window: { from: Date; to: Date; key: DateRangeKey | null }
): Promise<DashboardSection<EtsyData>> {
  try {
    const connection = await prisma.etsyConnection.findUnique({ where: { userEmail } });
    if (!connection?.shopId) return { status: 'ok', data: emptyEtsy('not_connected') };
    const { creds, accessToken, shopId } = await getValidEtsyAccessToken(userEmail);
    const { prevFrom, prevTo } = getComparisonDates(window.key, window.from, window.to);
    const [current, prior, open, currentLedger, priorLedger] = await Promise.all([
      fetchReceipts(creds, accessToken, shopId, window.from, window.to),
      fetchReceipts(creds, accessToken, shopId, prevFrom, prevTo),
      readJson<{ count?: number; results?: EtsyReceipt[] }>(
        await etsyFetch(creds, accessToken, `/application/shops/${shopId}/receipts?was_shipped=false&was_paid=true&limit=100`)
      ).catch((): { count?: number; results?: EtsyReceipt[] } => ({ results: [] })),
      fetchLedger(creds, accessToken, shopId, window.from, window.to).catch(() => null),
      fetchLedger(creds, accessToken, shopId, prevFrom, prevTo).catch(() => null),
    ]);
    const totals = summarize(current);
    const previous = summarize(prior);
    const profit = currentLedger ? etsyLedgerProfit(currentLedger) : null;
    const priorProfit = priorLedger ? etsyLedgerProfit(priorLedger) : null;
    return {
      status: 'ok',
      data: {
        state: 'ok',
        shop: connection.shopName,
        revenue: Math.round(totals.revenue * 100) / 100,
        profit: profit?.profit ?? null,
        fees: profit?.fees ?? null,
        orders: totals.orders,
        units: totals.units,
        unshipped: open.results?.length ?? open.count ?? 0,
        daily: dailyRevenue(window.from, window.to, current),
        prior: {
          revenue: Math.round(previous.revenue * 100) / 100,
          profit: priorProfit?.profit ?? null,
          orders: previous.orders,
          units: previous.units,
        },
        recent: current.slice(0, 8).map((receipt) => ({
          id: String(receipt.receipt_id ?? ''),
          title: receipt.transactions?.[0]?.title || `Receipt ${receipt.receipt_id ?? ''}`,
          total: Math.round(receiptRevenue(receipt) * 100) / 100,
          soldAt: new Date((receipt.created_timestamp ?? 0) * 1000).toISOString(),
          href: 'https://www.etsy.com/your/orders/sold',
        })),
      },
    };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not load Etsy sales' };
  }
}
