/**
 * Live seller numbers for the dashboard. Nothing here is cached except the player name
 * of a sold listing (item specifics never change), so every page load reflects eBay.
 *
 * Orders come from the Fulfillment API (sell.fulfillment.readonly); active and scheduled
 * listings from Trading GetMyeBaySelling; player names from Trading GetItem item specifics.
 */

import prisma from './prisma';
import {
  decodeXml,
  EbayCredentials,
  getEbayCredentials,
  getValidEbayAccessToken,
  tradingCall,
} from './ebay';
import { toZonedTime } from 'date-fns-tz';
import {
  DASHBOARD_RANGES,
  DashboardData,
  DashboardSection,
  ListingsData,
  PlayerStat,
  RangeStats,
  RecentSale,
  SalesData,
  ShippingData,
} from './dashboard-types';

const FULFILLMENT_URL = 'https://api.ebay.com/sell/fulfillment/v1/order';
const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_PAGE_SIZE = 200;
const MAX_ORDER_PAGES = 25;
const LISTING_PAGE_SIZE = 200;
const MAX_LISTING_PAGES = 25;
const PLAYER_LOOKUPS_PER_LOAD = 120;
const PLAYER_LOOKUP_CONCURRENCY = 6;
const TOP_PLAYERS = 10;
const RECENT_SALES = 8;
const RECONNECT_MESSAGE = 'Sign in with eBay again to let LotLister read your orders.';

/** Trading API error codes for a missing, expired, or revoked user token. */
const TRADING_AUTH_ERROR_CODES = new Set(['931', '932', '16110', '21916984', '21917053']);

class ReconnectError extends Error {}

interface Amount {
  value?: string;
}

interface OrderLineItem {
  legacyItemId?: string;
  title?: string;
  quantity?: number;
  lineItemCost?: Amount;
  lineItemFulfillmentStatus?: string;
  lineItemFulfillmentInstructions?: { shipByDate?: string };
}

interface Order {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus?: string;
  orderPaymentStatus?: string;
  cancelStatus?: { cancelState?: string };
  pricingSummary?: { priceSubtotal?: Amount; deliveryCost?: Amount; priceDiscount?: Amount };
  paymentSummary?: { refunds?: { refundStatus?: string; amount?: Amount }[] };
  totalFeeBasisAmount?: Amount;
  totalMarketplaceFee?: Amount;
  lineItems?: OrderLineItem[];
}

function amount(value: Amount | undefined): number {
  const n = Number.parseFloat(value?.value ?? '');
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function section<T>(result: PromiseSettledResult<T>, fallback: string): DashboardSection<T> {
  if (result.status === 'fulfilled') return { status: 'ok', data: result.value };
  if (result.reason instanceof ReconnectError) return { status: 'reconnect', message: result.reason.message };
  return { status: 'error', message: errorMessage(result.reason, fallback) };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Fulfillment API
// ---------------------------------------------------------------------------

async function fetchOrders(accessToken: string, filter: string): Promise<Order[]> {
  const orders: Order[] = [];
  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    const offset = page * ORDER_PAGE_SIZE;
    const response = await fetch(`${FULFILLMENT_URL}?filter=${filter}&limit=${ORDER_PAGE_SIZE}&offset=${offset}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
      cache: 'no-store',
    });

    if (response.status === 401 || response.status === 403) {
      throw new ReconnectError(RECONNECT_MESSAGE);
    }
    const body = (await response.json().catch(() => null)) as
      | { orders?: Order[]; total?: number; errors?: { message?: string }[] }
      | null;
    if (!response.ok) {
      throw new Error(body?.errors?.[0]?.message || `eBay orders request failed (${response.status})`);
    }

    const batch = body?.orders ?? [];
    orders.push(...batch);
    const total = body?.total ?? 0;
    if (batch.length < ORDER_PAGE_SIZE || offset + batch.length >= total) break;
  }
  return orders;
}

function isCountableSale(order: Order): boolean {
  if (order.cancelStatus?.cancelState === 'CANCELED') return false;
  const payment = order.orderPaymentStatus ?? '';
  return payment === 'PAID' || payment === 'PARTIALLY_REFUNDED';
}

function orderGross(order: Order): number {
  const basis = amount(order.totalFeeBasisAmount);
  if (basis > 0) return basis;
  const pricing = order.pricingSummary;
  return amount(pricing?.priceSubtotal) + amount(pricing?.deliveryCost) - Math.abs(amount(pricing?.priceDiscount));
}

function orderRefunds(order: Order): number {
  return (order.paymentSummary?.refunds ?? [])
    .filter((refund) => refund.refundStatus === 'REFUNDED')
    .reduce((sum, refund) => sum + amount(refund.amount), 0);
}

// ---------------------------------------------------------------------------
// Trading API
// ---------------------------------------------------------------------------

function tradingFailure(text: string, fallback: string): Error {
  const codes = [...text.matchAll(/<ErrorCode>([^<]+)<\/ErrorCode>/g)].map((m) => m[1].trim());
  if (codes.some((code) => TRADING_AUTH_ERROR_CODES.has(code))) {
    return new ReconnectError('Your eBay sign-in expired. Sign in with eBay again.');
  }
  const message =
    text.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1] ||
    text.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1];
  return new Error(message ? decodeXml(message.trim()) : fallback);
}

function tradingOk(text: string): boolean {
  const ack = text.match(/<Ack>([^<]+)<\/Ack>/)?.[1] ?? '';
  return ack === 'Success' || ack === 'Warning';
}

function xmlNumber(block: string, tag: string): number {
  const raw = block.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))?.[1];
  const n = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function getMyeBaySellingXml(page: number): string {
  const scheduled =
    page === 1
      ? '<ScheduledList><Include>true</Include><Pagination><EntriesPerPage>1</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ScheduledList>'
      : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <ActiveList>
    <Include>true</Include>
    <IncludeWatchCount>true</IncludeWatchCount>
    <Pagination><EntriesPerPage>${LISTING_PAGE_SIZE}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
  </ActiveList>
  ${scheduled}
  <SoldList><Include>false</Include></SoldList>
  <UnsoldList><Include>false</Include></UnsoldList>
</GetMyeBaySellingRequest>`;
}

async function fetchListings(creds: EbayCredentials, accessToken: string): Promise<ListingsData> {
  const result: ListingsData = { count: 0, value: 0, watchers: 0, scheduled: 0 };

  for (let page = 1; page <= MAX_LISTING_PAGES; page++) {
    const { text } = await tradingCall(creds, accessToken, 'GetMyeBaySelling', getMyeBaySellingXml(page));
    if (!tradingOk(text)) throw tradingFailure(text, 'eBay did not return your listings');

    if (page === 1) {
      const scheduledBlock = text.match(/<ScheduledList>([\s\S]*?)<\/ScheduledList>/)?.[1] ?? '';
      result.scheduled = xmlNumber(scheduledBlock, 'TotalNumberOfEntries');
    }

    const active = text.match(/<ActiveList>([\s\S]*?)<\/ActiveList>/)?.[1];
    if (!active) break;
    if (page === 1) result.count = xmlNumber(active, 'TotalNumberOfEntries');

    for (const match of active.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
      const item = match[1];
      const price = xmlNumber(item, 'CurrentPrice');
      const quantity = xmlNumber(item, 'QuantityAvailable') || 1;
      result.value += price * quantity;
      result.watchers += xmlNumber(item, 'WatchCount');
    }

    const pages = xmlNumber(active, 'TotalNumberOfPages');
    if (page >= pages) break;
  }

  result.value = round2(result.value);
  return result;
}

const PLAYER_SPECIFICS = ['player/athlete', 'player', 'athlete', 'character', 'card name'];

function playerFromItemSpecifics(xml: string): string | null {
  const specifics = xml.match(/<ItemSpecifics>([\s\S]*?)<\/ItemSpecifics>/)?.[1];
  if (!specifics) return null;
  const values = new Map<string, string>();
  for (const match of specifics.matchAll(/<NameValueList>([\s\S]*?)<\/NameValueList>/g)) {
    const name = match[1].match(/<Name>([\s\S]*?)<\/Name>/)?.[1];
    const value = match[1].match(/<Value>([\s\S]*?)<\/Value>/)?.[1];
    if (name && value) values.set(decodeXml(name).trim().toLowerCase(), decodeXml(value).trim());
  }
  for (const key of PLAYER_SPECIFICS) {
    const value = values.get(key);
    if (value) return value;
  }
  return null;
}

function normalizePlayer(name: string | null | undefined): string | null {
  const cleaned = (name ?? '').replace(/\s+/g, ' ').trim();
  return cleaned && cleaned.toLowerCase() !== 'n/a' ? cleaned : null;
}

/** Map eBay item id -> player, from the user's own cards first, then the lookup cache, then GetItem. */
async function resolvePlayers(
  userEmail: string,
  itemIds: string[],
  creds: EbayCredentials,
  accessToken: string
): Promise<{ players: Map<string, string | null>; pending: number }> {
  const players = new Map<string, string | null>();
  const unique = [...new Set(itemIds)];

  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const [cards, cached] = await Promise.all([
      prisma.cardItem.findMany({
        where: { ebayItemId: { in: chunk }, lot: { userEmail } },
        select: { ebayItemId: true, name: true },
      }),
      prisma.ebayItemPlayer.findMany({ where: { itemId: { in: chunk } } }),
    ]);
    for (const row of cached) players.set(row.itemId, normalizePlayer(row.player));
    for (const card of cards) {
      const name = normalizePlayer(card.name);
      if (card.ebayItemId && name) players.set(card.ebayItemId, name);
    }
  }

  const missing = unique.filter((id) => !players.has(id));
  const batch = missing.slice(0, PLAYER_LOOKUPS_PER_LOAD);

  await mapLimit(batch, PLAYER_LOOKUP_CONCURRENCY, async (itemId) => {
    try {
      const { text } = await tradingCall(
        creds,
        accessToken,
        'GetItem',
        `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId.replace(/\D/g, '')}</ItemID>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
</GetItemRequest>`
      );
      if (!text.includes('<Ack>')) return;
      const player = tradingOk(text) ? normalizePlayer(playerFromItemSpecifics(text)) : null;
      players.set(itemId, player);
      await prisma.ebayItemPlayer.upsert({
        where: { itemId },
        create: { itemId, player },
        update: { player, fetchedAt: new Date() },
      });
    } catch {
      // Network hiccup: leave it for the next load.
    }
  });

  return { players, pending: unique.filter((id) => !players.has(id)).length };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function localDay(time: number, tzOffsetMinutes: number): number {
  return Math.floor((time - tzOffsetMinutes * 60_000) / DAY_MS);
}

function buildRangeStats(
  orders: Order[],
  days: number,
  now: number,
  tzOffsetMinutes: number,
  players: Map<string, string | null>
): RangeStats {
  const since = now - days * DAY_MS;
  const today = localDay(now, tzOffsetMinutes);
  const daily = new Array<number>(days).fill(0);
  let gross = 0;
  let fees = 0;
  let refunds = 0;
  let orderCount = 0;
  let units = 0;
  let itemRevenue = 0;
  let unidentifiedUnits = 0;
  const byPlayer = new Map<string, PlayerStat>();

  for (const order of orders) {
    const created = Date.parse(order.creationDate);
    if (!Number.isFinite(created) || created < since) continue;

    const orderGrossValue = orderGross(order);
    gross += orderGrossValue;
    fees += amount(order.totalMarketplaceFee);
    refunds += orderRefunds(order);
    orderCount += 1;

    const bucket = days - 1 - (today - localDay(created, tzOffsetMinutes));
    if (bucket >= 0 && bucket < days) daily[bucket] += orderGrossValue;

    for (const line of order.lineItems ?? []) {
      const quantity = line.quantity ?? 1;
      const cost = amount(line.lineItemCost);
      units += quantity;
      itemRevenue += cost;

      const player = line.legacyItemId ? players.get(line.legacyItemId) : null;
      if (!player) {
        unidentifiedUnits += quantity;
        continue;
      }
      const key = player.toLowerCase();
      const stat = byPlayer.get(key) ?? { name: player, units: 0, revenue: 0 };
      stat.units += quantity;
      stat.revenue += cost;
      byPlayer.set(key, stat);
    }
  }

  const topPlayers = [...byPlayer.values()]
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
    .slice(0, TOP_PLAYERS)
    .map((stat) => ({ ...stat, revenue: round2(stat.revenue) }));

  return {
    summary: {
      gross: round2(gross),
      net: round2(gross - fees - refunds),
      fees: round2(fees),
      refunds: round2(refunds),
      orders: orderCount,
      units,
      avgItemPrice: units > 0 ? round2(itemRevenue / units) : 0,
      daily: daily.map(round2),
    },
    players: topPlayers,
    unidentifiedUnits,
  };
}

const NY = 'America/New_York';

function nyDay(time: number): number {
  const zoned = toZonedTime(new Date(time), NY);
  return Math.floor(Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()) / DAY_MS);
}

/** Same totals as buildRangeStats, for an arbitrary inclusive window (Today, Yesterday, or a custom range). */
function buildWindowStats(
  orders: Order[],
  from: Date,
  to: Date,
  players: Map<string, string | null>
): RangeStats {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const start = nyDay(fromMs);
  const days = Math.max(1, nyDay(toMs) - start + 1);
  const daily = new Array<number>(Math.min(days, 120)).fill(0);
  let gross = 0;
  let fees = 0;
  let refunds = 0;
  let orderCount = 0;
  let units = 0;
  let itemRevenue = 0;
  let unidentifiedUnits = 0;
  const byPlayer = new Map<string, PlayerStat>();

  for (const order of orders) {
    const created = Date.parse(order.creationDate);
    if (!Number.isFinite(created) || created < fromMs || created > toMs) continue;

    const orderGrossValue = orderGross(order);
    gross += orderGrossValue;
    fees += amount(order.totalMarketplaceFee);
    refunds += orderRefunds(order);
    orderCount += 1;

    const bucket = Math.min(nyDay(created) - start, daily.length - 1);
    if (bucket >= 0) daily[bucket] += orderGrossValue;

    for (const line of order.lineItems ?? []) {
      const quantity = line.quantity ?? 1;
      const cost = amount(line.lineItemCost);
      units += quantity;
      itemRevenue += cost;
      const player = line.legacyItemId ? players.get(line.legacyItemId) : null;
      if (!player) {
        unidentifiedUnits += quantity;
        continue;
      }
      const key = player.toLowerCase();
      const stat = byPlayer.get(key) ?? { name: player, units: 0, revenue: 0 };
      stat.units += quantity;
      stat.revenue += cost;
      byPlayer.set(key, stat);
    }
  }

  const topPlayers = [...byPlayer.values()]
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
    .slice(0, TOP_PLAYERS)
    .map((stat) => ({ ...stat, revenue: round2(stat.revenue) }));

  return {
    summary: {
      gross: round2(gross),
      net: round2(gross - fees - refunds),
      fees: round2(fees),
      refunds: round2(refunds),
      orders: orderCount,
      units,
      avgItemPrice: units > 0 ? round2(itemRevenue / units) : 0,
      daily: daily.map(round2),
    },
    players: topPlayers,
    unidentifiedUnits,
  };
}

async function fetchSales(
  userEmail: string,
  creds: EbayCredentials,
  accessToken: string,
  now: number,
  tzOffsetMinutes: number,
  window?: { from: Date; to: Date }
): Promise<SalesData> {
  const longest = Math.max(...DASHBOARD_RANGES);
  const sinceMs = Math.min(now - longest * DAY_MS, window?.from.getTime() ?? now);
  const since = new Date(sinceMs).toISOString();
  const orders = (await fetchOrders(accessToken, `creationdate:%5B${since}..%5D`)).filter(isCountableSale);

  const itemIds = orders.flatMap((order) =>
    (order.lineItems ?? []).map((line) => line.legacyItemId).filter((id): id is string => Boolean(id))
  );
  const { players, pending } = await resolvePlayers(userEmail, itemIds, creds, accessToken);

  const ranges = Object.fromEntries(
    DASHBOARD_RANGES.map((days) => [String(days), buildRangeStats(orders, days, now, tzOffsetMinutes, players)])
  ) as SalesData['ranges'];

  const focus = window ? buildWindowStats(orders, window.from, window.to, players) : ranges['30'];

  const recent: RecentSale[] = orders
    .slice()
    .sort((a, b) => Date.parse(b.creationDate) - Date.parse(a.creationDate))
    .flatMap((order) =>
      (order.lineItems ?? []).map((line) => ({
        itemId: line.legacyItemId ?? null,
        title: line.title ?? 'eBay item',
        price: round2(amount(line.lineItemCost)),
        quantity: line.quantity ?? 1,
        soldAt: order.creationDate,
        player: line.legacyItemId ? players.get(line.legacyItemId) ?? null : null,
      }))
    )
    .slice(0, RECENT_SALES);

  return { ranges, focus, recent, pendingLookups: pending };
}

async function fetchShipping(accessToken: string, now: number): Promise<ShippingData> {
  const orders = (await fetchOrders(accessToken, 'orderfulfillmentstatus:%7BNOT_STARTED%7CIN_PROGRESS%7D')).filter(
    isCountableSale
  );
  let units = 0;
  let overdue = 0;
  let nextShipBy: number | null = null;

  for (const order of orders) {
    let orderShipBy: number | null = null;
    for (const line of order.lineItems ?? []) {
      if (line.lineItemFulfillmentStatus === 'FULFILLED') continue;
      units += line.quantity ?? 1;
      const shipBy = Date.parse(line.lineItemFulfillmentInstructions?.shipByDate ?? '');
      if (Number.isFinite(shipBy)) orderShipBy = orderShipBy === null ? shipBy : Math.min(orderShipBy, shipBy);
    }
    if (orderShipBy === null) continue;
    if (orderShipBy < now) overdue += 1;
    else nextShipBy = nextShipBy === null ? orderShipBy : Math.min(nextShipBy, orderShipBy);
  }

  return {
    orders: orders.length,
    units,
    overdue,
    nextShipBy: nextShipBy === null ? null : new Date(nextShipBy).toISOString(),
  };
}

export async function getDashboardData(
  userEmail: string,
  tzOffsetMinutes: number,
  window?: { from: Date; to: Date }
): Promise<DashboardData> {
  const now = Date.now();
  const empty = { status: 'error', message: '' } as const;
  const base = { fetchedAt: new Date(now).toISOString(), sales: empty, shipping: empty, listings: empty };

  const creds = await getEbayCredentials();
  if (!creds) return { ...base, state: 'not_configured', account: null };

  const connection = await prisma.ebayConnection.findUnique({ where: { userEmail } });
  if (!connection) return { ...base, state: 'not_connected', account: null };
  const account = connection.ebayUsername ?? connection.ebayUserId ?? null;

  let accessToken: string;
  try {
    accessToken = await getValidEbayAccessToken(userEmail);
  } catch (error) {
    const reconnect = { status: 'reconnect', message: errorMessage(error, RECONNECT_MESSAGE) } as const;
    return { ...base, state: 'ok', account, sales: reconnect, shipping: reconnect, listings: reconnect };
  }

  const [sales, shipping, listings] = await Promise.allSettled([
    fetchSales(userEmail, creds, accessToken, now, tzOffsetMinutes, window),
    fetchShipping(accessToken, now),
    fetchListings(creds, accessToken),
  ]);

  return {
    ...base,
    state: 'ok',
    account,
    sales: section(sales, 'Could not load sales from eBay'),
    shipping: section(shipping, 'Could not load orders from eBay'),
    listings: section(listings, 'Could not load listings from eBay'),
  };
}
