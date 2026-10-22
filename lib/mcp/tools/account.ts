import prisma from '../../prisma';
import { registerTool } from '../registry';

registerTool({
  name: 'account_get',
  description: 'Read which eBay seller, Etsy shop, and Shopify store this account can use. Does not return tokens or secrets.',
  effect: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    const [ebay, etsy, settings] = await Promise.all([
      prisma.ebayConnection.findUnique({ where: { userEmail: ctx.accountId }, select: { ebayUsername: true } }),
      prisma.etsyConnection.findUnique({ where: { userEmail: ctx.accountId }, select: { shopName: true, shopId: true } }),
      prisma.appSetting.findFirst({ select: { shopifyShopName: true, shopifyShopDomain: true } }),
    ]);
    return {
      ebay: ebay ? { username: ebay.ebayUsername, connected: true } : { username: null, connected: false },
      etsy: etsy?.shopId ? { shopName: etsy.shopName, connected: true } : { shopName: null, connected: false },
      shopify: {
        shop: settings?.shopifyShopName || settings?.shopifyShopDomain || null,
        connected: Boolean(settings?.shopifyShopDomain),
      },
    };
  },
});
