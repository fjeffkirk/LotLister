import prisma from './prisma';
import { getEbayCredentials, getValidEbayAccessToken, tradingCall } from './ebay';
import {
  inventoryPriceBody,
  pageFromCursor,
  parseActiveListingsXml,
  parseItemPriceXml,
  reviseInventoryStatusXml,
  nextPageCursor,
  type ActiveListing,
} from './ebay-price';
import type { ListedPrice, PriceGateway, ReviseResult } from './ebay-price-apply';

const INVENTORY_API = 'https://api.ebay.com/sell/inventory/v1';
const PAGE_CAP = 50;

function tradingFailure(text: string): { message: string; inventoryManaged: boolean } {
  const code = text.match(/<ErrorCode>([^<]+)<\/ErrorCode>/)?.[1] ?? '';
  const message = text.match(/<LongMessage>([\s\S]*?)<\/LongMessage>/)?.[1]?.trim()
    || text.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1]?.trim()
    || 'eBay rejected the request';
  const inventoryManaged = code === '21919474' || /inventory api/i.test(message);
  return { message: code ? `eBay error ${code}: ${message}` : message, inventoryManaged };
}

function ackOk(text: string): boolean {
  const ack = text.match(/<Ack>([^<]+)<\/Ack>/)?.[1] ?? '';
  return ack === 'Success' || ack === 'Warning';
}

async function session(userEmail: string): Promise<{ token: string; appId: string; devId: string; certId: string }> {
  const creds = await getEbayCredentials();
  if (!creds) throw new Error('eBay is not configured on the server');
  const connection = await prisma.ebayConnection.findUnique({ where: { userEmail } });
  if (!connection) throw new Error('Sign in with eBay in LotLister before changing listing prices');
  const token = await getValidEbayAccessToken(userEmail);
  return { token, appId: creds.appId, devId: creds.devId, certId: creds.certId };
}

export async function listActiveListingPage(
  userEmail: string,
  options: { limit?: number; cursor?: string | null }
): Promise<{ account: string | null; total: number; cursor: string | null; hasMore: boolean; listings: ActiveListing[] }> {
  const creds = await getEbayCredentials();
  if (!creds) throw new Error('eBay is not configured on the server');
  const connection = await prisma.ebayConnection.findUnique({ where: { userEmail } });
  if (!connection) throw new Error('Sign in with eBay in LotLister before reading listings');
  const token = await getValidEbayAccessToken(userEmail);
  const page = pageFromCursor(options.cursor);
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <DetailLevel>ReturnAll</DetailLevel>
  <ActiveList>
    <Include>true</Include>
    <Pagination><EntriesPerPage>${limit}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
  </ActiveList>
  <SoldList><Include>false</Include></SoldList>
  <UnsoldList><Include>false</Include></UnsoldList>
</GetMyeBaySellingRequest>`;
  const { text } = await tradingCall(creds, token, 'GetMyeBaySelling', xml);
  if (!ackOk(text)) throw new Error(tradingFailure(text).message);
  const parsed = parseActiveListingsXml(text);
  const pageInfo = nextPageCursor(page, parsed.totalPages);
  return {
    account: connection.ebayUsername ?? connection.ebayUserId,
    total: parsed.total,
    cursor: pageInfo.cursor,
    hasMore: pageInfo.hasMore,
    listings: parsed.listings,
  };
}

export async function listActiveListings(
  userEmail: string,
  listingIds?: Set<string>
): Promise<{ listings: ActiveListing[]; truncated: boolean }> {
  const listings: ActiveListing[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const batch = await listActiveListingPage(userEmail, { limit: 200, cursor });
    listings.push(...batch.listings.filter((listing) => !listingIds || listingIds.has(listing.itemId)));
    if (!batch.hasMore || !batch.cursor) return { listings, truncated: false };
    if (listingIds && [...listingIds].every((id) => listings.some((listing) => listing.itemId === id))) {
      return { listings, truncated: false };
    }
    if (page === PAGE_CAP - 1) return { listings, truncated: true };
    cursor = batch.cursor;
  }
  return { listings, truncated: true };
}

export function priceGateway(userEmail: string): PriceGateway {
  return {
    async readPrice(itemId, variationSku): Promise<ListedPrice> {
      if (!/^\d+$/.test(itemId)) throw new Error('Listing id is not an eBay item id');
      const creds = await session(userEmail);
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <ItemID>${itemId}</ItemID>
  <IncludeItemSpecifics>false</IncludeItemSpecifics>
  <OutputSelector>Item.ListingType</OutputSelector>
  <OutputSelector>Item.SellingStatus.CurrentPrice</OutputSelector>
  <OutputSelector>Item.StartPrice</OutputSelector>
  <OutputSelector>Item.Variations</OutputSelector>
</GetItemRequest>`;
      const { text } = await tradingCall(
        { appId: creds.appId, devId: creds.devId, certId: creds.certId, ruName: '' },
        creds.token,
        'GetItem',
        xml
      );
      if (!ackOk(text)) throw new Error(tradingFailure(text).message);
      const price = parseItemPriceXml(text, variationSku);
      return { cents: price.cents, currency: price.currency, format: price.format };
    },
    async reviseTrading(itemId, variationSku, priceCents): Promise<ReviseResult> {
      const creds = await session(userEmail);
      const xml = reviseInventoryStatusXml([{ itemId, sku: variationSku, priceCents }]);
      if (xml.includes('<Quantity>') || xml.includes('<Description>') || xml.includes('<Shipping')) {
        return { ok: false, error: 'Refusing to send a price update that changes more than price' };
      }
      const { text } = await tradingCall(
        { appId: creds.appId, devId: creds.devId, certId: creds.certId, ruName: '' },
        creds.token,
        'ReviseInventoryStatus',
        xml
      );
      if (ackOk(text)) return { ok: true };
      const failure = tradingFailure(text);
      return { ok: false, error: failure.message, inventoryManaged: failure.inventoryManaged };
    },
    async reviseInventory(_itemId, sku, priceCents): Promise<ReviseResult> {
      const creds = await session(userEmail);
      const offers = await fetch(`${INVENTORY_API}/offer?sku=${encodeURIComponent(sku)}`, {
        headers: { Authorization: `Bearer ${creds.token}`, Accept: 'application/json' },
        cache: 'no-store',
      });
      if (offers.status === 403) {
        return {
          ok: false,
          error: 'This listing is managed by the Inventory API. Reconnect eBay after LotLister asks for sell.inventory permission.',
        };
      }
      if (!offers.ok) return { ok: false, error: `eBay Inventory API did not return offers (${offers.status})` };
      const body = await offers.json() as { offers?: { offerId?: string }[] };
      const offerId = body.offers?.find((offer) => offer.offerId)?.offerId;
      if (!offerId) return { ok: false, error: 'eBay did not return an Inventory API offer for this SKU' };
      const updated = await fetch(`${INVENTORY_API}/bulk_update_price_quantity`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: inventoryPriceBody(sku, offerId, priceCents),
        cache: 'no-store',
      });
      if (updated.status === 403) {
        return {
          ok: false,
          error: 'This listing is managed by the Inventory API. Reconnect eBay after LotLister asks for sell.inventory permission.',
        };
      }
      if (!updated.ok) return { ok: false, error: `eBay Inventory API rejected the price (${updated.status})` };
      return { ok: true };
    },
  };
}
