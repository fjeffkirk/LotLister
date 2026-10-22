import { z } from 'zod';
import { rangeToDates, type DateRangeKey } from '../../dates';
import { getShopifyDashboard } from '../../shopify-dashboard';
import { registerTool } from '../registry';

registerTool({
  name: 'shopify_summary_get',
  description: 'Read the Shopify store connected to this LotLister install: sales, estimated profit, orders, items, and unfulfilled orders. Does not change products or orders.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: { range: { type: 'string', enum: ['1d', '7d', '30d', '90d'], description: 'Defaults to 30d.' } },
    additionalProperties: false,
  },
  async handler(_ctx, args) {
    const { range } = z.object({ range: z.enum(['1d', '7d', '30d', '90d']).optional() }).parse(args);
    const key = (range ?? '30d') as DateRangeKey;
    const section = await getShopifyDashboard({ ...rangeToDates(key), key });
    if (section.status !== 'ok') throw new Error(section.message);
    const focus = section.data.focus;
    return {
      shop: section.data.shop,
      connected: section.data.state === 'ok',
      range: key,
      revenue: focus?.revenue ?? 0,
      estimatedProfit: focus?.net ?? 0,
      orders: focus?.orders ?? 0,
      units: focus?.units ?? 0,
      unfulfilled: section.data.unfulfilled,
      lowStock: section.data.lowStock,
      recent: section.data.recent.slice(0, 8),
    };
  },
});
