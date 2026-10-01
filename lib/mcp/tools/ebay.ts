import { z } from 'zod';
import { rangeToDates, type DateRangeKey } from '../../dates';
import { getDashboardData, getEbayActiveListings } from '../../ebay-dashboard';
import { registerTool } from '../registry';

const rangeSchema = z.object({
  range: z.enum(['1d', '7d', '30d', '90d']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

registerTool({
  name: 'ebay_listings_get',
  description: 'Read active eBay listings for the connected seller account: title, price, quantity, watchers, and link. Does not create or end listings.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many active listings to return. Default 25.' } },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const { limit } = rangeSchema.pick({ limit: true }).parse(args);
    return getEbayActiveListings(ctx.accountId, limit ?? 25);
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
