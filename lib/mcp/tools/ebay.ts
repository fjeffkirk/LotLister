import { z } from 'zod';
import { rangeToDates, type DateRangeKey } from '../../dates';
import { getDashboardData } from '../../ebay-dashboard';
import { centsFromUsd, proposePriceChanges } from '../../ebay-price';
import { applyStoredPrices } from '../../ebay-price-apply';
import { listActiveListingPage, listActiveListings, priceGateway } from '../../ebay-price-live';
import { newPreviewId, prismaPriceStore } from '../../ebay-price-store';
import { registerTool } from '../registry';

const rangeSchema = z.object({
  range: z.enum(['1d', '7d', '30d', '90d']).optional(),
});

export const listingArgsSchema = z.object({
  limit: z.preprocess(
    (value) => (value === undefined || value === null || value === '' ? undefined : value),
    z.coerce.number().int().min(1).max(200).optional()
  ),
  cursor: z.string().min(1).max(20).optional(),
});

const listingInputSchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Page size. Optional. Defaults to 100. Maximum 200. Use 100 or 200 when walking every active listing.' },
    cursor: { type: 'string', description: 'Pass the cursor string returned by the previous call. Omit this argument on the first call. Keep calling while hasMore is true.' },
  },
  additionalProperties: false,
};

const previewSchema = z.object({
  listingIds: z.array(z.string().regex(/^\d+$/)).max(500).optional(),
  percentOff: z.coerce.number().positive().lt(100),
  minimumCurrentPrice: z.coerce.number().nonnegative(),
  tradingCardsOnly: z.boolean().optional(),
});

const previewInputSchema = {
  type: 'object',
  properties: {
    listingIds: { type: 'array', items: { type: 'string' }, description: 'Optional eBay item ids. Leave this out to scan every active listing. Do not collect ids yourself with ebay_listings_get first.' },
    percentOff: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 100, description: 'Percent to subtract from the current price. 10 means 10% off. Example: $30.00 becomes $27.00. Rounded to the nearest cent.' },
    minimumCurrentPrice: { type: 'number', minimum: 0, description: 'Only listings whose current price is this amount or higher are included. Compared before the discount. 30 includes $30.00 and excludes $29.99.' },
    tradingCardsOnly: { type: 'boolean', description: 'True limits the preview to trading-card categories from eBay category data. Uncertain categories, auctions, and non-card listings are returned in exclusions and are not changed.' },
  },
  required: ['percentOff', 'minimumCurrentPrice'],
  additionalProperties: false,
};

function listingPayload(listing: Awaited<ReturnType<typeof listActiveListingPage>>['listings'][number]) {
  return {
    listingId: listing.itemId,
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    format: listing.format,
    categoryId: listing.categoryId,
    categoryName: listing.categoryName,
    sku: listing.sku,
    variations: listing.variations.map((variation) => ({
      variationId: variation.id,
      sku: variation.sku,
      price: variation.price,
      currency: variation.currency,
    })),
    url: listing.url,
  };
}

registerTool({
  name: 'ebay_listings_get',
  description: 'Read one page of the connected seller\'s active eBay listings. Does not change prices. Arguments are limit and cursor. Call the first page with {"limit":100} and no cursor. Each response includes cursor and hasMore. If hasMore is true, call again with that cursor string, for example {"limit":100,"cursor":"2"}. Repeat until hasMore is false. Each listing includes listingId, title, price, currency, format, categoryId, categoryName, sku, variations, and url. For a price reduction, do not page through listings and do not calculate new prices. Call ebay_prices_preview instead.',
  effect: 'read',
  inputSchema: listingInputSchema,
  async handler(ctx, args) {
    const { limit, cursor } = listingArgsSchema.parse(args ?? {});
    const page = await listActiveListingPage(ctx.accountId, { limit, cursor });
    return {
      account: page.account,
      total: page.total,
      cursor: page.cursor,
      hasMore: page.hasMore,
      listings: page.listings.map(listingPayload),
    };
  },
});

registerTool({
  name: 'ebay_prices_preview',
  description: 'Build a price-change preview for the connected seller. Does not change any live price. To reduce every active fixed-price trading card priced $30 or more by 10%, call this once with {"percentOff":10,"minimumCurrentPrice":30,"tradingCardsOnly":true} and no listingIds. A $30.00 listing is included. Anything under $30 is excluded. Auctions and uncertain categories come back in exclusions. The response has previewId, changes (listingId, title, originalPrice, proposedPrice), and exclusions with reasons. Show that summary to the seller. Do not apply anything until they agree. Then pass that same previewId to ebay_prices_apply. If truncated is true, say the shop was too large to scan in one preview.',
  effect: 'read',
  inputSchema: previewInputSchema,
  async handler(ctx, args) {
    const input = previewSchema.parse(args ?? {});
    const listingIds = input.listingIds ? new Set(input.listingIds) : undefined;
    const scanned = await listActiveListings(ctx.accountId, listingIds);
    const proposed = proposePriceChanges(scanned.listings, {
      percentOff: input.percentOff,
      minimumCents: centsFromUsd(input.minimumCurrentPrice),
      tradingCardsOnly: input.tradingCardsOnly === true,
      listingIds,
    });
    const previewId = proposed.changes.length ? newPreviewId() : null;
    if (previewId) await prismaPriceStore().create(ctx.accountId, previewId, proposed.changes);
    return {
      previewId,
      percentOff: input.percentOff,
      minimumCurrentPrice: input.minimumCurrentPrice,
      tradingCardsOnly: input.tradingCardsOnly === true,
      truncated: scanned.truncated,
      changes: proposed.changes.map((change) => ({
        listingId: change.itemId,
        variationSku: change.variationSku,
        title: change.title,
        originalPrice: change.originalPrice,
        proposedPrice: change.proposedPrice,
        currency: change.currency,
      })),
      exclusions: proposed.exclusions.map((row) => ({
        listingId: row.itemId,
        variationSku: row.variationSku,
        title: row.title,
        reason: row.reason,
      })),
    };
  },
});

registerTool({
  name: 'ebay_prices_apply',
  description: 'Apply one preview created by ebay_prices_preview. Changes only the item price on the connected seller\'s listings. Shipping, quantity, offers, promotions, and descriptions stay as they are. Call it with {"previewId":"<the previewId from ebay_prices_preview>"} after the seller has agreed to that preview. Do not invent prices and do not call ebay_listings_get to decide the new price. A repeated call with the same previewId does not discount twice. The response counts updated, verified, skipped, and failed listings and gives a reason for each skip or failure. Read those reasons to the seller. Verified means eBay returned the new price after the update.',
  effect: 'price',
  inputSchema: {
    type: 'object',
    properties: { previewId: { type: 'string', description: 'The previewId string returned by ebay_prices_preview. Example: price_ followed by hex. Do not pass listing ids or prices here.' } },
    required: ['previewId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const { previewId } = z.object({ previewId: z.string().min(8).max(80) }).parse(args ?? {});
    const counts = await applyStoredPrices(
      prismaPriceStore(),
      priceGateway(ctx.accountId),
      previewId,
      ctx.accountId,
      { info: (entry) => console.info(JSON.stringify({ source: 'ebay-price', ...entry })) },
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );
    return { previewId, ...counts };
  },
});

registerTool({
  name: 'ebay_sales_get',
  description: 'Read eBay sales for a recent range: gross, net after fees, orders, and the latest sales. Does not change listings.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: { range: { type: 'string', enum: ['1d', '7d', '30d', '90d'], description: 'Defaults to 30d.' } },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const { range } = rangeSchema.pick({ range: true }).parse(args);
    const key = (range ?? '30d') as DateRangeKey;
    const window = { ...rangeToDates(key), key };
    const data = await getDashboardData(ctx.accountId, 0, window);
    if (data.sales.status !== 'ok') throw new Error(data.sales.message || 'eBay sales are not available');
    const focus = data.sales.data.focus ?? data.sales.data.ranges['30'];
    return {
      account: data.account,
      range: key,
      gross: focus.summary.gross,
      net: focus.summary.net,
      fees: focus.summary.fees,
      refunds: focus.summary.refunds,
      orders: focus.summary.orders,
      units: focus.summary.units,
      recent: data.sales.data.recent.slice(0, 8).map((sale) => ({
        title: sale.title,
        price: sale.price,
        quantity: sale.quantity,
        soldAt: sale.soldAt,
        player: sale.player,
      })),
    };
  },
});
