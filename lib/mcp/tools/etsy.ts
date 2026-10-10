import { z } from 'zod';
import { rangeToDates, type DateRangeKey } from '../../dates';
import { createEtsyDraftForCard, getEtsyDashboard, getEtsySettingsView } from '../../etsy';
import { registerTool } from '../registry';

const rangeSchema = z.object({ range: z.enum(['1d', '7d', '30d', '90d']).optional() });
const draftSchema = z.object({ cardId: z.string().uuid() });

registerTool({
  name: 'etsy_shop_get',
  description: 'Read the connected Etsy shop name and which shipping, processing, and category profiles are selected. Does not change the shop.',
  effect: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    const settings = await getEtsySettingsView(ctx.accountId);
    return {
      connected: settings.connected,
      shopName: settings.shopName,
      shopId: settings.shopId,
      shippingProfileId: settings.shippingProfileId || null,
      readinessStateId: settings.readinessStateId || null,
      returnPolicyId: settings.returnPolicyId || null,
      taxonomyId: settings.taxonomyId || null,
      shippingProfiles: settings.shippingProfiles,
      readinessStates: settings.readinessStates,
      loadError: 'loadError' in settings ? settings.loadError : null,
    };
  },
});

registerTool({
  name: 'etsy_receipts_get',
  description: 'Read paid Etsy orders for a recent range: sales, profit after shipping, Etsy ads, and item cost, order count, and the latest receipts. Does not refund or ship anything.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: { range: { type: 'string', enum: ['1d', '7d', '30d', '90d'], description: 'Defaults to 30d.' } },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const { range } = rangeSchema.parse(args);
    const key = (range ?? '30d') as DateRangeKey;
    const section = await getEtsyDashboard(ctx.accountId, { ...rangeToDates(key), key });
    if (section.status !== 'ok') throw new Error(section.message);
    return {
      shop: section.data.shop,
      connected: section.data.state === 'ok',
      range: key,
      revenue: section.data.revenue,
      profit: section.data.profit,
      fees: section.data.fees,
      orders: section.data.orders,
      units: section.data.units,
      unshipped: section.data.unshipped,
      recent: section.data.recent,
    };
  },
});

registerTool({
  name: 'etsy_drafts_create',
  description: 'Create one unpublished Etsy draft from a ready card. The listing stays a draft. This does not publish it, renew it, or mark the card as listed.',
  effect: 'draft',
  inputSchema: {
    type: 'object',
    properties: { cardId: { type: 'string', description: 'Card id from lots_get' } },
    required: ['cardId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const { cardId } = draftSchema.parse(args);
    const draft = await createEtsyDraftForCard(ctx.accountId, cardId);
    return { ...draft, published: false };
  },
});
