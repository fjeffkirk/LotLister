/**
 * Production eBay seller integration.
 *
 * One developer app (App ID, Dev ID, Cert ID, RuName) is shared by this
 * LotLister install via server environment variables (EBAY_APP_ID,
 * EBAY_DEV_ID, EBAY_CERT_ID, EBAY_RU_NAME). Each person connects their own eBay account with OAuth,
 * and listings are created with the Trading API AddItem call — the same
 * fields the File Exchange CSV already uses.
 */

import { CardImage, CardItem, ExportProfile } from '@prisma/client';
import prisma from './prisma';
import { imagePathToEbayPicUrl, isAbsoluteImageUrl } from './imageUrls';
import { renderDescription } from './card-fields';
import {
  ebayCardConditionValueId,
  ebayGradeValueId,
  ebayGraderValueId,
  ebayScheduleTimestamp,
  ebayShippingServiceCode,
  generateTitle,
} from './export-csv';
import { getCategoryEbayId, isPsaImportedCard, isSportsCategory, isTcgCategory } from './types';

const AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const IDENTITY_URL = 'https://apiz.ebay.com/commerce/identity/v1/user/';
const TRADING_URL = 'https://api.ebay.com/ws/api.dll';
const TRADING_COMPAT_LEVEL = '1193';

/** Trading API user token, plus identity so we can show which account is connected. */
export const EBAY_OAUTH_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
];

export const MAX_LISTINGS_PER_REQUEST = 25;
export const EBAY_OAUTH_STATE_COOKIE = 'ebay_oauth_state';

export interface EbayCredentials {
  appId: string;
  devId: string;
  certId: string;
  ruName: string;
}

export interface EbayPublicStatus {
  configured: boolean;
  missingEnvVars: string[];
  connected: boolean;
  ebayUserId: string | null;
}

type CardWithImages = CardItem & { images: CardImage[] };

export interface EbayListCardResult {
  cardId: string;
  title: string;
  success: boolean;
  ebayItemId?: string;
  listingUrl?: string;
  error?: string;
}

export interface EbayListSummary {
  listedCount: number;
  failedCount: number;
  skippedNotReady: number;
  skippedAlreadyListed: number;
  remainingReady: number;
  results: EbayListCardResult[];
}

export function getPublicBaseUrl(requestOrigin: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (fromEnv || requestOrigin).replace(/\/$/, '');
}

/** eBay's servers must be able to download picture URLs. localhost and plain http will not work. */
export function isEbayReachableBase(base: string): boolean {
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    return true;
  } catch {
    return false;
  }
}

const CREDENTIAL_ENV_VARS = {
  appId: 'EBAY_APP_ID',
  devId: 'EBAY_DEV_ID',
  certId: 'EBAY_CERT_ID',
  ruName: 'EBAY_RU_NAME',
} as const;

export async function getEbayCredentials(): Promise<EbayCredentials | null> {
  const appId = process.env.EBAY_APP_ID?.trim();
  const devId = process.env.EBAY_DEV_ID?.trim();
  const certId = process.env.EBAY_CERT_ID?.trim();
  const ruName = process.env.EBAY_RU_NAME?.trim();
  if (!appId || !devId || !certId || !ruName) return null;
  return { appId, devId, certId, ruName };
}

export function missingEbayEnvVars(): string[] {
  return Object.values(CREDENTIAL_ENV_VARS).filter((name) => !process.env[name]?.trim());
}

export async function getEbayPublicStatus(userEmail: string): Promise<EbayPublicStatus> {
  const connection = await prisma.ebayConnection.findUnique({ where: { userEmail } });
  const missingEnvVars = missingEbayEnvVars();

  return {
    configured: missingEnvVars.length === 0,
    missingEnvVars,
    connected: Boolean(connection),
    ebayUserId: connection?.ebayUsername ?? connection?.ebayUserId ?? null,
  };
}

export function buildEbayAuthorizeUrl(creds: EbayCredentials, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', creds.appId);
  url.searchParams.set('redirect_uri', creds.ruName);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', EBAY_OAUTH_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type?: string;
}

async function requestEbayToken(creds: EbayCredentials, body: URLSearchParams): Promise<TokenResponse> {
  const basic = Buffer.from(`${creds.appId}:${creds.certId}`).toString('base64');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const description =
      parsed && typeof parsed === 'object' && 'error_description' in parsed
        ? String((parsed as { error_description?: string }).error_description || '')
        : text.slice(0, 300);
    throw new Error(description || `eBay token request failed (${response.status})`);
  }

  const token = parsed as TokenResponse;
  if (!token?.access_token || !token.expires_in) {
    throw new Error('eBay did not return an access token');
  }
  return token;
}

export async function exchangeEbayAuthCode(creds: EbayCredentials, code: string): Promise<TokenResponse> {
  return requestEbayToken(
    creds,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: creds.ruName,
    })
  );
}

async function refreshEbayAccessToken(creds: EbayCredentials, refreshToken: string): Promise<TokenResponse> {
  return requestEbayToken(
    creds,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: EBAY_OAUTH_SCOPES.join(' '),
    })
  );
}

let cachedAppToken: { token: string; expiresAt: number } | null = null;

/** Client-credentials token for app-level calls such as the Notification API public key lookup. */
export async function getEbayApplicationToken(): Promise<string> {
  if (cachedAppToken && cachedAppToken.expiresAt > Date.now() + 60_000) {
    return cachedAppToken.token;
  }
  const creds = await getEbayCredentials();
  if (!creds) {
    throw new Error(`eBay is not configured on the server. Missing: ${missingEbayEnvVars().join(', ')}`);
  }
  const token = await requestEbayToken(
    creds,
    new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    })
  );
  cachedAppToken = { token: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  return token.access_token;
}

export interface EbayIdentity {
  userId: string | null;
  username: string | null;
}

export async function fetchEbayIdentity(accessToken: string): Promise<EbayIdentity> {
  try {
    const response = await fetch(IDENTITY_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) return { userId: null, username: null };
    const data = (await response.json()) as { username?: string; userId?: string };
    return { userId: data.userId || null, username: data.username || null };
  } catch {
    return { userId: null, username: null };
  }
}

export async function saveEbayConnection(
  userEmail: string,
  token: TokenResponse,
  identity: EbayIdentity | null
): Promise<void> {
  const existing = await prisma.ebayConnection.findUnique({ where: { userEmail } });
  const refreshToken = token.refresh_token || existing?.refreshToken;
  if (!refreshToken) {
    throw new Error('eBay did not return a refresh token');
  }

  await prisma.ebayConnection.upsert({
    where: { userEmail },
    create: {
      userEmail,
      accessToken: token.access_token,
      refreshToken,
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      ebayUserId: identity?.userId ?? null,
      ebayUsername: identity?.username ?? null,
    },
    update: {
      accessToken: token.access_token,
      refreshToken,
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      ebayUserId: identity?.userId ?? existing?.ebayUserId ?? null,
      ebayUsername: identity?.username ?? existing?.ebayUsername ?? null,
    },
  });
}

export async function getValidEbayAccessToken(userEmail: string): Promise<string> {
  const creds = await getEbayCredentials();
  if (!creds) {
    throw new Error(`eBay is not configured on the server. Missing: ${missingEbayEnvVars().join(', ')}`);
  }

  const connection = await prisma.ebayConnection.findUnique({ where: { userEmail } });
  if (!connection) {
    throw new Error('Your eBay session has ended. Sign out and sign in with eBay again.');
  }

  if (connection.accessExpiresAt.getTime() > Date.now() + 60_000) {
    return connection.accessToken;
  }

  const refreshed = await refreshEbayAccessToken(creds, connection.refreshToken);
  await saveEbayConnection(userEmail, refreshed, null);
  return refreshed.access_token;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function money(value: number): string {
  return value.toFixed(2);
}

function isCardGraded(card: CardItem): boolean {
  return card.conditionType === 'Graded: Professionally graded';
}

export function isCardReadyToList(card: CardWithImages): boolean {
  if (!card.images || card.images.length === 0) return false;
  if (!card.title?.trim()) return false;
  if (card.salePrice === null || card.salePrice === undefined) return false;
  if (card.year === null || card.year === undefined) return false;
  if (!card.conditionType?.trim()) return false;
  if (!card.category?.trim()) return false;
  if (!card.brand?.trim()) return false;
  if (!card.setName?.trim()) return false;
  if (!card.name?.trim()) return false;
  if (!card.cardNumber?.trim()) return false;
  if (!isPsaImportedCard(card) && !card.subsetParallel?.trim()) return false;

  if (isCardGraded(card)) {
    if (!card.grader?.trim()) return false;
    if (!card.grade?.trim()) return false;
  } else if (!card.condition?.trim()) {
    return false;
  }

  return true;
}

function aspectXml(name: string, value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) return '';
  return `<NameValueList><Name>${xmlEscape(name)}</Name><Value>${xmlEscape(text)}</Value></NameValueList>`;
}

function pictureUrls(card: CardWithImages, imageBaseUrl: string): string[] {
  return card.images
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => imagePathToEbayPicUrl(image.originalPath, imageBaseUrl))
    .filter((url) => /^https:\/\//i.test(url))
    .slice(0, 12);
}

function cardNeedsHostedImages(card: CardWithImages): boolean {
  return card.images.some((image) => image.originalPath && !isAbsoluteImageUrl(image.originalPath));
}

interface BuiltItem {
  xml: string;
}

function buildAddItemXml(
  card: CardWithImages,
  profile: ExportProfile,
  imageBaseUrl: string,
  scheduleIndex: number,
  clientTzOffsetMinutes: number
): BuiltItem | { error: string } {
  const title = generateTitle(card).slice(0, 80);
  const graded = isCardGraded(card);
  const cardCategory = card.category || '';
  const ebayCategory = isSportsCategory(cardCategory)
    ? profile.ebayCategory || '261328'
    : getCategoryEbayId(cardCategory);

  const descriptors: string[] = [];
  if (graded) {
    const gradeId = ebayGradeValueId(card.grade || '');
    if (!gradeId) {
      return { error: `Grade "${card.grade || ''}" is not an eBay grade` };
    }
    descriptors.push(
      `<ConditionDescriptor><Name>27501</Name><Value>${ebayGraderValueId(card.grader || '')}</Value></ConditionDescriptor>`
    );
    descriptors.push(
      `<ConditionDescriptor><Name>27502</Name><Value>${gradeId}</Value></ConditionDescriptor>`
    );
    if (card.certNo?.trim()) {
      descriptors.push(
        `<ConditionDescriptor><Name>27503</Name><AdditionalInfo>${xmlEscape(card.certNo.trim())}</AdditionalInfo></ConditionDescriptor>`
      );
    }
  } else {
    descriptors.push(
      `<ConditionDescriptor><Name>40001</Name><Value>${ebayCardConditionValueId(card.condition || '')}</Value></ConditionDescriptor>`
    );
  }

  const sport = isSportsCategory(cardCategory) ? cardCategory : '';
  const game = isTcgCategory(cardCategory) ? cardCategory : '';
  const cardType = isSportsCategory(cardCategory)
    ? 'Sports Trading Card'
    : isTcgCategory(cardCategory)
      ? 'CCG Card'
      : 'Non-Sport Trading Card';

  const aspects = [
    aspectXml('Sport', sport),
    aspectXml('Game', game),
    aspectXml('Player/Athlete', isSportsCategory(cardCategory) ? card.name : ''),
    aspectXml('Card Name', card.name),
    aspectXml('Season', card.year),
    aspectXml('Year Manufactured', card.year),
    aspectXml('Manufacturer', card.brand),
    aspectXml('Set', card.setName),
    aspectXml('Parallel/Variety', card.subsetParallel),
    aspectXml('Features', card.subsetParallel),
    aspectXml('Team', isSportsCategory(cardCategory) ? card.team : ''),
    aspectXml('Card Number', card.cardNumber),
    aspectXml('Type', cardType),
    aspectXml('Graded', graded ? 'Yes' : 'No'),
    aspectXml('Autographed', 'No'),
  ]
    .filter(Boolean)
    .join('');

  const urls = pictureUrls(card, imageBaseUrl);
  if (urls.length === 0) {
    return { error: 'No public https photo URL for this card' };
  }

  const isAuction = profile.listingType !== 'BuyItNow';
  const startPrice = isAuction
    ? card.salePrice || profile.startPriceDefault
    : card.salePrice;
  if (startPrice === null || startPrice === undefined || Number(startPrice) <= 0) {
    return { error: 'Price is missing' };
  }

  const scheduleRaw = ebayScheduleTimestamp(profile, scheduleIndex, clientTzOffsetMinutes);
  const scheduleXml = scheduleRaw ? `<ScheduleTime>${scheduleRaw}.000Z</ScheduleTime>` : '';

  const location =
    [profile.itemLocationCity, profile.itemLocationState].filter(Boolean).join(', ') || 'United States';
  const postalCode = profile.itemLocationZip?.trim() || '';
  const shippingCode = ebayShippingServiceCode(profile.shippingService);
  const free = profile.freeShipping;
  const shippingCost = free ? '0.00' : money(profile.shippingCost);
  const additional =
    !free && profile.eachAdditionalItemCost > 0
      ? `<ShippingServiceAdditionalCost>${money(profile.eachAdditionalItemCost)}</ShippingServiceAdditionalCost>`
      : '';

  const storeCategory = profile.storeCategory?.trim();
  const storeXml =
    storeCategory && storeCategory !== '0' && /^\d+$/.test(storeCategory)
      ? `<Storefront><StoreCategoryID>${storeCategory}</StoreCategoryID></Storefront>`
      : '';

  const buyItNow =
    isAuction && profile.buyItNowPrice
      ? `<BuyItNowPrice currencyID="USD">${money(profile.buyItNowPrice)}</BuyItNowPrice>`
      : '';

  const bestOffer = profile.bestOfferEnabled
    ? `<BestOfferDetails><BestOfferEnabled>true</BestOfferEnabled></BestOfferDetails>`
    : '';
  const offerPrices: string[] = [];
  if (profile.bestOfferEnabled && profile.bestOfferAutoAcceptPrice) {
    offerPrices.push(
      `<BestOfferAutoAcceptPrice currencyID="USD">${money(profile.bestOfferAutoAcceptPrice)}</BestOfferAutoAcceptPrice>`
    );
  }
  if (profile.bestOfferEnabled && profile.bestOfferMinimumPrice) {
    offerPrices.push(
      `<MinimumBestOfferPrice currencyID="USD">${money(profile.bestOfferMinimumPrice)}</MinimumBestOfferPrice>`
    );
  }
  const listingDetails = offerPrices.length > 0 ? `<ListingDetails>${offerPrices.join('')}</ListingDetails>` : '';

  const description = (renderDescription(card, title) || title).replace(/]]>/g, ']] >');
  const duration = isAuction ? `Days_${profile.durationDays}` : 'GTC';
  const listingType = isAuction ? 'Chinese' : 'FixedPriceItem';
  const returnsAccepted = profile.returnsAccepted ? 'ReturnsAccepted' : 'ReturnsNotAccepted';
  const refund = profile.refundMethod === 'Money Back' ? 'MoneyBack' : 'MoneyBackOrReplacement';
  const paidBy = profile.shippingCostPaidBy === 'Buyer' ? 'Buyer' : 'Seller';

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${xmlEscape(title)}</Title>
    <Description><![CDATA[${description}]]></Description>
    <PrimaryCategory><CategoryID>${xmlEscape(ebayCategory)}</CategoryID></PrimaryCategory>
    <Site>US</Site>
    <Country>US</Country>
    <Currency>USD</Currency>
    <SKU>${xmlEscape(card.id)}</SKU>
    <ConditionID>${graded ? '2750' : '4000'}</ConditionID>
    <ConditionDescriptors>${descriptors.join('')}</ConditionDescriptors>
    <ItemSpecifics>${aspects}</ItemSpecifics>
    <PictureDetails>${urls.map((url) => `<PictureURL>${xmlEscape(url)}</PictureURL>`).join('')}</PictureDetails>
    <ListingType>${listingType}</ListingType>
    <ListingDuration>${duration}</ListingDuration>
    <Quantity>1</Quantity>
    <StartPrice currencyID="USD">${money(Number(startPrice))}</StartPrice>
    ${buyItNow}
    ${bestOffer}
    ${listingDetails}
    ${profile.immediatePayment ? '<AutoPay>true</AutoPay>' : ''}
    ${scheduleXml}
    <Location>${xmlEscape(location)}</Location>
    ${postalCode ? `<PostalCode>${xmlEscape(postalCode)}</PostalCode>` : ''}
    <DispatchTimeMax>${profile.handlingTimeDays}</DispatchTimeMax>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>${xmlEscape(shippingCode)}</ShippingService>
        <ShippingServiceCost>${shippingCost}</ShippingServiceCost>
        ${free ? '<FreeShipping>true</FreeShipping>' : ''}
        ${additional}
      </ShippingServiceOptions>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>${returnsAccepted}</ReturnsAcceptedOption>
      <RefundOption>${refund}</RefundOption>
      <ReturnsWithinOption>Days_${profile.returnWindowDays}</ReturnsWithinOption>
      <ShippingCostPaidByOption>${paidBy}</ShippingCostPaidByOption>
    </ReturnPolicy>
    ${storeXml}
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
  </Item>
</AddItemRequest>`;

  return { xml };
}

function decodeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function parseAddItemResponse(xml: string): { ok: boolean; itemId?: string; error?: string } {
  const ack = xml.match(/<Ack>([^<]+)<\/Ack>/)?.[1] ?? '';
  const itemId = xml.match(/<ItemID>([^<]+)<\/ItemID>/)?.[1];
  const messages: string[] = [];

  for (const block of xml.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)) {
    const body = block[1];
    const severity = body.match(/<SeverityCode>([^<]+)<\/SeverityCode>/)?.[1] ?? 'Error';
    if (severity === 'Warning') continue;
    const msg =
      body.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ||
      body.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1] ||
      'eBay rejected this listing';
    messages.push(decodeXml(msg.trim()));
  }

  if ((ack === 'Success' || ack === 'Warning') && itemId) {
    return { ok: true, itemId };
  }

  return {
    ok: false,
    error: messages.join(' ') || `eBay did not create a listing (Ack: ${ack || 'none'})`,
  };
}

async function addItem(
  creds: EbayCredentials,
  accessToken: string,
  xml: string
): Promise<{ ok: boolean; itemId?: string; error?: string }> {
  const response = await fetch(TRADING_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-CALL-NAME': 'AddItem',
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-COMPATIBILITY-LEVEL': TRADING_COMPAT_LEVEL,
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'X-EBAY-API-APP-NAME': creds.appId,
      'X-EBAY-API-DEV-NAME': creds.devId,
      'X-EBAY-API-CERT-NAME': creds.certId,
    },
    body: xml,
  });

  const text = await response.text();
  if (!text.includes('<Ack>')) {
    return { ok: false, error: `eBay request failed (${response.status})` };
  }
  return parseAddItemResponse(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function listLotOnEbay(options: {
  userEmail: string;
  cards: CardWithImages[];
  profile: ExportProfile;
  imageBaseUrl: string;
  clientTzOffsetMinutes: number;
}): Promise<EbayListSummary> {
  const { userEmail, cards, profile, imageBaseUrl, clientTzOffsetMinutes } = options;
  const sorted = cards.slice().sort((a, b) => a.sortOrder - b.sortOrder);

  let skippedNotReady = 0;
  let skippedAlreadyListed = 0;
  const ready: { card: CardWithImages; index: number }[] = [];

  sorted.forEach((card, index) => {
    if (card.ebayItemId) {
      skippedAlreadyListed += 1;
      return;
    }
    if (!isCardReadyToList(card)) {
      skippedNotReady += 1;
      return;
    }
    ready.push({ card, index });
  });

  if (ready.length === 0) {
    throw new Error(
      skippedAlreadyListed > 0 && skippedNotReady === 0
        ? 'Every ready card in this lot is already listed on eBay'
        : 'No cards are ready to list. Fill the required fields first.'
    );
  }

  const hosted = ready.some(({ card }) => cardNeedsHostedImages(card));
  if (hosted && !isEbayReachableBase(imageBaseUrl)) {
    throw new Error(
      'eBay has to download photos from a public https address. Set NEXT_PUBLIC_APP_URL to this site’s public URL. localhost will not work.'
    );
  }

  if (profile.scheduleMode === 'Scheduled') {
    const tooSoon = ready.some(({ index }) => {
      const raw = ebayScheduleTimestamp(profile, index, clientTzOffsetMinutes);
      if (!raw) return true;
      return new Date(`${raw}.000Z`).getTime() < Date.now() + 5 * 60 * 1000;
    });
    if (tooSoon) {
      throw new Error('Schedule time must be at least 5 minutes in the future. Update the date and time, then list again.');
    }
  }

  if (!profile.itemLocationCity?.trim() || !profile.itemLocationState?.trim() || !profile.itemLocationZip?.trim()) {
    throw new Error('Item location (city, state, and ZIP) is required before listing');
  }

  const creds = await getEbayCredentials();
  if (!creds) {
    throw new Error(`eBay is not configured on the server. Missing: ${missingEbayEnvVars().join(', ')}`);
  }
  const accessToken = await getValidEbayAccessToken(userEmail);

  const batch = ready.slice(0, MAX_LISTINGS_PER_REQUEST);
  const remainingReady = ready.length - batch.length;
  const results: EbayListCardResult[] = [];

  for (let i = 0; i < batch.length; i++) {
    const { card, index } = batch[i];
    const title = generateTitle(card).slice(0, 80);
    const built = buildAddItemXml(card, profile, imageBaseUrl, index, clientTzOffsetMinutes);

    if ('error' in built) {
      results.push({ cardId: card.id, title, success: false, error: built.error });
    } else {
      const outcome = await addItem(creds, accessToken, built.xml);
      if (outcome.ok && outcome.itemId) {
        const listingUrl = `https://www.ebay.com/itm/${outcome.itemId}`;
        await prisma.cardItem.update({
          where: { id: card.id },
          data: {
            ebayItemId: outcome.itemId,
            ebayListedAt: new Date(),
            status: 'Exported',
            listings: listingUrl,
          },
        });
        results.push({
          cardId: card.id,
          title,
          success: true,
          ebayItemId: outcome.itemId,
          listingUrl,
        });
      } else {
        results.push({
          cardId: card.id,
          title,
          success: false,
          error: outcome.error || 'eBay rejected this listing',
        });
      }
    }

    if (i < batch.length - 1) {
      await sleep(300);
    }
  }

  const listedCount = results.filter((result) => result.success).length;
  return {
    listedCount,
    failedCount: results.length - listedCount,
    skippedNotReady,
    skippedAlreadyListed,
    remainingReady,
    results,
  };
}
