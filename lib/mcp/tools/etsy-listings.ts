import { z } from 'zod';
import { liveDraftClient, loadRemoteImage } from '../../etsy-drafts';
import {
  getShopListing,
  listShopListings,
  updateShopListing,
  updateShopListingImages,
  updateShopListingVariants,
  ETSY_LISTING_STATES,
} from '../../etsy-listings';
import { ETSY_WHEN_MADE, ETSY_WHO_MADE } from '../../etsy-product';
import { registerTool } from '../registry';

const listingId = z.string().regex(/^\d+$/);

const variantSchema = z.object({
  sku: z.string().max(32).optional(),
  price: z.number().positive(),
  quantity: z.number().int().nonnegative(),
  readinessStateId: z.string().max(40).optional(),
  options: z.array(z.object({
    propertyId: z.number().int().positive().optional(),
    name: z.string().max(40).optional(),
    value: z.string().min(1).max(40),
    valueId: z.number().int().positive().optional(),
  })).max(3),
});

registerTool({
  name: 'etsy_listings_list',
  description: 'List listings in the connected Etsy shop. Filter by state (active, inactive, draft, expired, or sold_out) and page with limit and offset. A query matches title, tags, or SKU on the current page. Does not change listings. Existing unpublished-draft tools remain etsy_drafts_get.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: [...ETSY_LISTING_STATES] },
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      state: z.enum(ETSY_LISTING_STATES).optional(),
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().nonnegative().optional(),
    }).parse(args);
    return listShopListings(await liveDraftClient(ctx.accountId), parsed);
  },
});

registerTool({
  name: 'etsy_listings_get',
  description: 'Read one listing in the connected Etsy shop, including its state, editable fields, images, inventory, and shipping, processing, and return profile ids. Works for active, inactive, draft, expired, and sold-out listings that belong to this shop. Does not change the listing.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: { listingId: { type: 'string' } },
    required: ['listingId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({ listingId }).parse(args);
    return getShopListing(await liveDraftClient(ctx.accountId), parsed.listingId);
  },
});

registerTool({
  name: 'etsy_listings_update',
  description: 'Partially update an existing Etsy listing in the connected shop. Omitted fields stay unchanged. This does not publish, deactivate, renew, delete, or recreate the listing, and it does not send a state. Price, quantity, and SKU on a single-variant listing are written through Etsy inventory. Listings with more than one variant must use etsy_listing_variants_update. Pass expectedUpdatedTimestamp from etsy_listings_get to avoid overwriting a newer edit. Unpublished drafts can still use etsy_drafts_update.',
  effect: 'draft',
  inputSchema: {
    type: 'object',
    properties: {
      listingId: { type: 'string' },
      expectedUpdatedTimestamp: { type: 'integer' },
      title: { type: 'string' },
      description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      materials: { type: 'array', items: { type: 'string' } },
      taxonomyId: { type: 'integer' },
      whoMade: { type: 'string', enum: [...ETSY_WHO_MADE] },
      whenMade: { type: 'string', enum: [...ETSY_WHEN_MADE] },
      isSupply: { type: 'boolean' },
      shippingProfileId: { type: 'string' },
      readinessStateId: { type: 'string' },
      returnPolicyId: { type: 'string' },
      price: { type: 'number' },
      quantity: { type: 'integer' },
      sku: { type: 'string' },
      attributes: { type: 'array', items: { type: 'object' } },
    },
    required: ['listingId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      listingId,
      expectedUpdatedTimestamp: z.number().int().positive().optional(),
      title: z.string().min(1).max(140).optional(),
      description: z.string().min(1).optional(),
      tags: z.array(z.string()).max(13).optional(),
      materials: z.array(z.string()).max(13).optional(),
      taxonomyId: z.number().int().positive().optional(),
      whoMade: z.enum(ETSY_WHO_MADE).optional(),
      whenMade: z.enum(ETSY_WHEN_MADE).optional(),
      isSupply: z.boolean().optional(),
      shippingProfileId: z.string().max(40).optional(),
      readinessStateId: z.string().max(40).optional(),
      returnPolicyId: z.string().max(40).optional(),
      price: z.number().positive().optional(),
      quantity: z.number().int().nonnegative().optional(),
      sku: z.string().max(32).optional(),
      attributes: z.array(z.object({
        propertyId: z.number().int().positive(),
        valueIds: z.array(z.number().int().positive()).min(1),
        values: z.array(z.string().min(1)).min(1),
        scaleId: z.number().int().positive().optional(),
      })).optional(),
    }).parse(args);
    const { listingId: id, ...patch } = parsed;
    return updateShopListing(await liveDraftClient(ctx.accountId), id, patch);
  },
});

registerTool({
  name: 'etsy_listing_variants_update',
  description: 'Add or update variants on an existing Etsy listing. The current inventory is read first and variants you do not mention are kept, including their prices, quantities, SKUs, and property links. This sends Etsy’s full inventory payload and does not change the listing state. Draft-only variant edits remain etsy_draft_variants_update. Pass expectedUpdatedTimestamp from etsy_listings_get when you need to refuse a newer concurrent edit.',
  effect: 'draft',
  inputSchema: {
    type: 'object',
    properties: {
      listingId: { type: 'string' },
      expectedUpdatedTimestamp: { type: 'integer' },
      variations: { type: 'array', items: { type: 'object' } },
    },
    required: ['listingId', 'variations'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      listingId,
      expectedUpdatedTimestamp: z.number().int().positive().optional(),
      variations: z.array(variantSchema).min(1),
    }).parse(args);
    return updateShopListingVariants(
      await liveDraftClient(ctx.accountId),
      parsed.listingId,
      parsed.variations,
      parsed.expectedUpdatedTimestamp,
    );
  },
});

registerTool({
  name: 'etsy_listing_images_update',
  description: 'Add, replace, or reorder images on an existing Etsy listing. Replacements are identified by listingImageId and overwrite that image’s rank only after the new file loads. A failed upload does not remove the current image. Unrelated images stay. Repeating an add for the same URL does not upload a second copy. This does not publish, deactivate, or delete the listing. Draft image uploads remain etsy_draft_images_upload.',
  effect: 'draft',
  inputSchema: {
    type: 'object',
    properties: {
      listingId: { type: 'string' },
      add: { type: 'array', items: { type: 'object' } },
      replace: { type: 'array', items: { type: 'object' } },
      reorder: { type: 'array', items: { type: 'object' } },
    },
    required: ['listingId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      listingId,
      add: z.array(z.object({
        url: z.string().url(),
        rank: z.number().int().min(1).max(20).optional(),
      })).max(20).optional(),
      replace: z.array(z.object({
        listingImageId: z.string().regex(/^\d+$/),
        url: z.string().url(),
        altText: z.string().max(250).optional(),
      })).max(20).optional(),
      reorder: z.array(z.object({
        listingImageId: z.string().regex(/^\d+$/),
        rank: z.number().int().min(1).max(20),
      })).max(20).optional(),
    }).refine((value) => (value.add?.length || value.replace?.length || value.reorder?.length), {
      message: 'Provide add, replace, or reorder',
    }).parse(args);
    return updateShopListingImages(await liveDraftClient(ctx.accountId), parsed.listingId, parsed, loadRemoteImage);
  },
});
