import { z } from 'zod';
import { createShopifyListing, previewShopifyListing } from '../../ebay-shopify-flow';
import { EBAY_RETURN_DAYS, EBAY_SHIPPING_SERVICES } from '../../ebay-shopify-listing';
import {
  categoryAspects,
  categoryConditions,
  getListingDefaults,
  liveListingDeps,
  saveListingDefaults,
  suggestEbayCategories,
} from '../../ebay-shopify-live';
import { shopify } from '../../shopify/client';
import type { ProductLookup } from '../../shopify/listing-product';
import { registerTool } from '../registry';

const lookupProperties = {
  productId: { type: 'string', description: 'Shopify product id, numeric or gid://shopify/Product/…' },
  handle: { type: 'string', description: 'Shopify product handle, the last part of the product URL.' },
  sku: { type: 'string', description: 'Any variant SKU on the product.' },
};

const lookupSchema = z.object({
  productId: z.string().min(1).max(80).optional(),
  handle: z.string().min(1).max(255).optional(),
  sku: z.string().min(1).max(255).optional(),
});

function toLookup(input: z.infer<typeof lookupSchema>): ProductLookup {
  const given = [input.productId, input.handle, input.sku].filter(Boolean).length;
  if (given !== 1) throw new Error('Pass exactly one of productId, handle, or sku');
  if (input.productId) return { productId: input.productId };
  if (input.handle) return { handle: input.handle };
  return { sku: input.sku! };
}

registerTool({
  name: 'shopify_product_get',
  description: 'Read one product from the Shopify store connected to LotLister: title, HTML description, photos, options, variants with SKU, price, barcode, and stock, product type, tags, and status. Find it by productId, handle, or SKU. Does not change Shopify. Use this as the source when copying a product to eBay or Etsy.',
  effect: 'read',
  inputSchema: { type: 'object', properties: lookupProperties, additionalProperties: false },
  async handler(_ctx, args) {
    return shopify.productForListing(toLookup(lookupSchema.parse(args ?? {})));
  },
});

registerTool({
  name: 'ebay_category_suggest',
  description: 'Find the eBay category for a product. With query, returns eBay\'s suggested leaf categories, best first. With categoryId, returns that category\'s item specifics (required ones flagged, with allowed values) and the condition ids it accepts. Does not change anything.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Product title or keywords, for example the Shopify title.' },
      categoryId: { type: 'string', description: 'A leaf category id from a previous suggestion.' },
    },
    additionalProperties: false,
  },
  async handler(_ctx, args) {
    const input = z.object({ query: z.string().min(2).max(350).optional(), categoryId: z.string().regex(/^\d+$/).optional() }).parse(args ?? {});
    if (!input.query && !input.categoryId) throw new Error('Pass query or categoryId');
    if (input.categoryId) {
      const [aspects, conditions] = await Promise.all([
        categoryAspects(input.categoryId),
        categoryConditions(input.categoryId).catch((error) => ({ conditionRequired: null, conditions: [], error: error instanceof Error ? error.message : 'Conditions unavailable' })),
      ]);
      return {
        categoryId: input.categoryId,
        requiredSpecifics: aspects.filter((aspect) => aspect.required),
        recommendedSpecifics: aspects.filter((aspect) => !aspect.required).slice(0, 25),
        ...conditions,
      };
    }
    return { query: input.query, suggestions: await suggestEbayCategories(input.query!) };
  },
});

registerTool({
  name: 'ebay_listing_defaults_get',
  description: 'Read the eBay shipping, handling time, returns, and item location LotLister uses when it lists a Shopify product on eBay. Card lots keep their own settings. Does not change anything.',
  effect: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(ctx) {
    const defaults = await getListingDefaults(ctx.accountId);
    return { saved: Boolean(defaults), defaults, shippingServices: EBAY_SHIPPING_SERVICES, returnDays: EBAY_RETURN_DAYS };
  },
});

registerTool({
  name: 'ebay_listing_defaults_update',
  description: 'Save the eBay shipping, handling time, returns, and item location used for Shopify products listed on eBay. Send every field. Use the values the seller gave you; do not invent a ZIP code or shipping price. Does not change any listing.',
  effect: 'listing',
  idempotent: true,
  inputSchema: {
    type: 'object',
    properties: {
      postalCode: { type: 'string', description: 'US ZIP where the item ships from.' },
      location: { type: 'string', description: 'City and state, for example "Austin, TX".' },
      shippingService: { type: 'string', enum: [...EBAY_SHIPPING_SERVICES], description: 'USPSParcel is USPS Ground Advantage.' },
      shippingCost: { type: 'number', minimum: 0, description: 'Buyer shipping charge in USD. Ignored when freeShipping is true.' },
      freeShipping: { type: 'boolean' },
      additionalItemCost: { type: 'number', minimum: 0, description: 'Shipping for each extra unit in the same order.' },
      handlingDays: { type: 'integer', minimum: 0, maximum: 30, description: 'Business days before the item ships.' },
      returnsAccepted: { type: 'boolean' },
      returnDays: { type: 'integer', enum: [...EBAY_RETURN_DAYS] },
      returnShippingPaidBy: { type: 'string', enum: ['Buyer', 'Seller'] },
      bestOfferEnabled: { type: 'boolean' },
    },
    required: ['postalCode', 'location', 'shippingService', 'shippingCost', 'freeShipping', 'handlingDays', 'returnsAccepted', 'returnDays', 'returnShippingPaidBy'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    return { saved: true, defaults: await saveListingDefaults(ctx.accountId, args ?? {}) };
  },
});

const specificSchema = z.object({ name: z.string().min(1).max(65), values: z.array(z.string().min(1).max(65)).min(1).max(30) });

registerTool({
  name: 'ebay_listing_preview',
  description: 'Build an eBay fixed-price listing from one Shopify product and have eBay check it with VerifyAddFixedPriceItem. Nothing goes live. Uses the Shopify title, description, photos, price, stock, SKUs, and variants, plus the saved eBay shipping and returns defaults. Leave categoryId out to use eBay\'s top suggestion. conditionId defaults to 1000 (New). Pass itemSpecifics for any required specifics the response lists. On success it returns previewId, the exact listing summary, and eBay\'s fees. Show that summary to the seller before calling ebay_listing_create.',
  effect: 'listing',
  inputSchema: {
    type: 'object',
    properties: {
      ...lookupProperties,
      categoryId: { type: 'string', description: 'eBay leaf category id from ebay_category_suggest.' },
      conditionId: { type: 'integer', description: 'eBay condition id. 1000 is New. ebay_category_suggest with categoryId lists the allowed ids.' },
      title: { type: 'string', maxLength: 80, description: 'Override the Shopify title. eBay allows 80 characters.' },
      descriptionHtml: { type: 'string', description: 'Override the Shopify description.' },
      itemSpecifics: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } },
          required: ['name', 'values'],
          additionalProperties: false,
        },
        description: 'eBay item specifics such as Brand, Type, or Material. Brand defaults to the Shopify vendor.',
      },
      quantity: { type: 'integer', minimum: 1, description: 'Only used for variants whose stock Shopify does not track.' },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const input = lookupSchema.extend({
      categoryId: z.string().regex(/^\d+$/).optional(),
      conditionId: z.number().int().positive().optional(),
      title: z.string().min(1).max(80).optional(),
      descriptionHtml: z.string().min(1).max(500_000).optional(),
      itemSpecifics: z.array(specificSchema).max(45).optional(),
      quantity: z.number().int().positive().max(10_000).optional(),
    }).parse(args ?? {});
    const { productId, handle, sku, ...choices } = input;
    return previewShopifyListing(ctx.accountId, { lookup: toLookup({ productId, handle, sku }), ...choices }, liveListingDeps(ctx.accountId));
  },
});

registerTool({
  name: 'ebay_listing_create',
  description: 'Create the live eBay listing from a preview made by ebay_listing_preview. Call it only after the seller has seen that preview and agreed, with {"previewId":"…","sellerApproved":true}. It sends exactly the listing eBay verified. A repeated call with the same previewId returns the same eBay item instead of listing it twice, and a Shopify product that is already on eBay is not listed again. The result gives itemId, url, and whether a fresh eBay read matched the preview. This never ends, revises, or deletes a listing.',
  effect: 'listing',
  idempotent: true,
  openWorld: true,
  inputSchema: {
    type: 'object',
    properties: {
      previewId: { type: 'string', description: 'The previewId returned by ebay_listing_preview.' },
      sellerApproved: { type: 'boolean', const: true, description: 'Must be true. Set it only after the seller agreed to the preview.' },
    },
    required: ['previewId', 'sellerApproved'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const input = z.object({ previewId: z.string().regex(/^ebl_[0-9a-f]{24}$/), sellerApproved: z.boolean() }).parse(args ?? {});
    return createShopifyListing(ctx.accountId, input.previewId, input.sellerApproved, liveListingDeps(ctx.accountId));
  },
});
