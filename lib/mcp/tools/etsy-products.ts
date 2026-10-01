import { z } from 'zod';
import { getEtsySettingsView } from '../../etsy';
import {
  createProductDraft,
  getProductDrafts,
  liveDraftClient,
  loadRemoteImage,
  updateDraftVariants,
  updateProductDraft,
  uploadDraftImages,
} from '../../etsy-drafts';
import { ETSY_WHEN_MADE, ETSY_WHO_MADE } from '../../etsy-product';
import { registerTool } from '../registry';

const whoMade = z.enum(ETSY_WHO_MADE);
const whenMade = z.enum(ETSY_WHEN_MADE);

const variantSchema = z.object({
  sku: z.string().max(32).optional(),
  price: z.number().positive(),
  quantity: z.number().int().positive(),
  readinessStateId: z.string().max(40).optional(),
  options: z.array(z.object({
    propertyId: z.number().int().positive().optional(),
    name: z.string().max(40).optional(),
    value: z.string().min(1).max(40),
    valueId: z.number().int().positive().optional(),
  })).max(3),
});

const imageSchema = z.object({
  url: z.string().url(),
  rank: z.number().int().min(1).max(20).optional(),
});

const productSchema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().min(1),
  price: z.number().positive(),
  quantity: z.number().int().positive(),
  sku: z.string().max(32).optional(),
  taxonomyId: z.number().int().positive().optional(),
  whoMade: whoMade,
  whenMade: whenMade,
  isSupply: z.boolean().optional(),
  tags: z.array(z.string()).max(13).optional(),
  materials: z.array(z.string()).max(13).optional(),
  shippingProfileId: z.string().max(40).optional(),
  readinessStateId: z.string().max(40).optional(),
  returnPolicyId: z.string().max(40).optional(),
  useShopDefaults: z.boolean().optional(),
  itemWeight: z.number().positive().optional(),
  itemWeightUnit: z.enum(['oz', 'lb', 'g', 'kg']).optional(),
  itemLength: z.number().positive().optional(),
  itemWidth: z.number().positive().optional(),
  itemHeight: z.number().positive().optional(),
  itemDimensionsUnit: z.enum(['in', 'ft', 'mm', 'cm', 'm', 'yd', 'inches']).optional(),
  productionPartnerIds: z.array(z.number().int().positive()).max(10).optional(),
  attributes: z.array(z.object({
    propertyId: z.number().int().positive(),
    valueIds: z.array(z.number().int().positive()).min(1),
    values: z.array(z.string().min(1)).min(1),
    scaleId: z.number().int().positive().optional(),
  })).optional(),
  variations: z.array(variantSchema).optional(),
  images: z.array(imageSchema).max(20).optional(),
});

const updateSchema = productSchema.partial().extend({
  listingId: z.string().regex(/^\d+$/),
});

registerTool({
  name: 'etsy_listing_requirements_get',
  description: 'Read what a physical Etsy draft needs: saved shipping, processing, and return profiles, plus taxonomy properties when a category id is provided. Does not invent product facts or create a listing. Card drafts still use etsy_drafts_create.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      taxonomyId: { type: 'integer', description: 'Seller taxonomy id. When set, returns the properties Etsy allows for that category, including which ones support variations.' },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const taxonomyId = z.object({ taxonomyId: z.number().int().positive().optional() }).parse(args).taxonomyId;
    const settings = await getEtsySettingsView(ctx.accountId);
    const missing: string[] = [];
    if (!settings.connected) missing.push('Etsy shop is not connected');
    if (!settings.shippingProfiles.length) missing.push('No shipping profiles were returned. Create one in the Etsy shop.');
    if (!settings.readinessStates.length) missing.push('No processing profiles were returned. Create one in the Etsy shop.');
    if (!settings.shippingProfileId) missing.push('No shipping profile is selected in LotLister settings');
    if (!settings.readinessStateId) missing.push('No processing profile is selected in LotLister settings');
    let taxonomyProperties: unknown = null;
    let taxonomyError: string | null = null;
    if (taxonomyId && settings.connected) {
      const client = await liveDraftClient(ctx.accountId);
      const response = await client.request('GET', `/application/seller-taxonomy/nodes/${taxonomyId}/properties`);
      if (response.status >= 400) taxonomyError = response.text || `Etsy taxonomy request failed (${response.status})`;
      else taxonomyProperties = response.body;
    }
    return {
      connected: settings.connected,
      shopName: settings.shopName,
      shopId: settings.shopId,
      requiredToCreate: ['title', 'description', 'price', 'quantity', 'whoMade', 'whenMade', 'taxonomyId', 'shippingProfileId', 'readinessStateId'],
      whoMade: ETSY_WHO_MADE,
      whenMade: ETSY_WHEN_MADE,
      variationLimits: {
        maxProperties: 3,
        maxProducts: { oneProperty: 70, twoProperties: 4900, threeProperties: 2500, variesByAllOnThree: 400 },
        customPropertyIds: [513, 514, 516],
      },
      images: { max: 20, types: ['image/jpeg', 'image/png', 'image/gif'], urlsMustBeHttps: true },
      saved: {
        shippingProfileId: settings.shippingProfileId || null,
        readinessStateId: settings.readinessStateId || null,
        returnPolicyId: settings.returnPolicyId || null,
        taxonomyId: settings.taxonomyId || null,
      },
      shippingProfiles: settings.shippingProfiles,
      readinessStates: settings.readinessStates,
      returnPolicies: settings.returnPolicies,
      missing,
      taxonomyId: taxonomyId ?? null,
      taxonomyProperties,
      taxonomyError,
      workflow: 'Create a physical draft with etsy_drafts_create_product. Pass useShopDefaults only when these saved profiles should be reused. Add images with etsy_draft_images_upload and variations with etsy_draft_variants_update. If a step fails, retry it with the returned listingId. Publishing, deletion, and edits to active listings are not available. Trading cards still use etsy_drafts_create.',
    };
  },
});

registerTool({
  name: 'etsy_drafts_create_product',
  description: 'Create an unpublished physical Etsy draft for a non-card product such as a stand, holder, or planter. Reuses a draft with the same SKU instead of creating a duplicate. Does not publish. Trading cards still use etsy_drafts_create.',
  effect: 'draft',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      price: { type: 'number' },
      quantity: { type: 'integer' },
      sku: { type: 'string' },
      taxonomyId: { type: 'integer' },
      whoMade: { type: 'string', enum: [...ETSY_WHO_MADE] },
      whenMade: { type: 'string', enum: [...ETSY_WHEN_MADE] },
      isSupply: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      materials: { type: 'array', items: { type: 'string' } },
      shippingProfileId: { type: 'string' },
      readinessStateId: { type: 'string' },
      returnPolicyId: { type: 'string' },
      useShopDefaults: { type: 'boolean', description: 'Reuse the shipping, processing, return, and category ids saved in LotLister when this request omits them.' },
      itemWeight: { type: 'number' },
      itemWeightUnit: { type: 'string', enum: ['oz', 'lb', 'g', 'kg'] },
      itemLength: { type: 'number' },
      itemWidth: { type: 'number' },
      itemHeight: { type: 'number' },
      itemDimensionsUnit: { type: 'string', enum: ['in', 'ft', 'mm', 'cm', 'm', 'yd', 'inches'] },
      productionPartnerIds: { type: 'array', items: { type: 'integer' } },
      attributes: { type: 'array', items: { type: 'object' } },
      variations: { type: 'array', items: { type: 'object' } },
      images: { type: 'array', items: { type: 'object' }, description: 'HTTPS image URLs. JPEG, PNG, or GIF. Rank 1 is the leftmost image.' },
    },
    required: ['title', 'description', 'price', 'quantity', 'whoMade', 'whenMade'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const input = productSchema.parse(args);
    const settings = input.useShopDefaults ? await getEtsySettingsView(ctx.accountId) : null;
    const client = await liveDraftClient(ctx.accountId);
    return createProductDraft(client, input, settings ? {
      shippingProfileId: settings.shippingProfileId,
      readinessStateId: settings.readinessStateId,
      returnPolicyId: settings.returnPolicyId,
      taxonomyId: settings.taxonomyId ? Number(settings.taxonomyId) : null,
    } : null, loadRemoteImage);
  },
});

registerTool({
  name: 'etsy_drafts_get',
  description: 'List unpublished drafts in the connected Etsy shop, or read one draft and its inventory. Does not change listings.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: { listingId: { type: 'string', description: 'When omitted, returns the shop draft list.' } },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const { listingId } = z.object({ listingId: z.string().regex(/^\d+$/).optional() }).parse(args);
    return getProductDrafts(await liveDraftClient(ctx.accountId), listingId);
  },
});

registerTool({
  name: 'etsy_drafts_update',
  description: 'Update fields on an unpublished physical draft in the connected shop. Does not publish, and does not change active listings. Omitted fields stay as they are.',
  effect: 'draft',
  inputSchema: {
    type: 'object',
    properties: {
      listingId: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      price: { type: 'number' },
      quantity: { type: 'integer' },
      taxonomyId: { type: 'integer' },
      whoMade: { type: 'string', enum: [...ETSY_WHO_MADE] },
      whenMade: { type: 'string', enum: [...ETSY_WHEN_MADE] },
      tags: { type: 'array', items: { type: 'string' } },
      materials: { type: 'array', items: { type: 'string' } },
      shippingProfileId: { type: 'string' },
      readinessStateId: { type: 'string' },
      returnPolicyId: { type: 'string' },
    },
    required: ['listingId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const { listingId, ...patch } = updateSchema.parse(args);
    return updateProductDraft(await liveDraftClient(ctx.accountId), listingId, patch);
  },
});

registerTool({
  name: 'etsy_draft_images_upload',
  description: 'Upload JPEG, PNG, or GIF images from HTTPS URLs onto an unpublished draft. Rank 1 is leftmost. A failed image does not remove images that already uploaded. Does not publish.',
  effect: 'draft',
  inputSchema: {
    type: 'object',
    properties: {
      listingId: { type: 'string' },
      images: { type: 'array', items: { type: 'object' } },
    },
    required: ['listingId', 'images'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      listingId: z.string().regex(/^\d+$/),
      images: z.array(imageSchema).min(1).max(20),
    }).parse(args);
    return uploadDraftImages(await liveDraftClient(ctx.accountId), parsed.listingId, parsed.images, loadRemoteImage);
  },
});

registerTool({
  name: 'etsy_draft_variants_update',
  description: 'Add or update variations on an unpublished draft. Existing variations that are not mentioned are kept. Send the variations to change, not a full replacement. Does not publish or edit active listings.',
  effect: 'draft',
  inputSchema: {
    type: 'object',
    properties: {
      listingId: { type: 'string' },
      variations: { type: 'array', items: { type: 'object' } },
    },
    required: ['listingId', 'variations'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const parsed = z.object({
      listingId: z.string().regex(/^\d+$/),
      variations: z.array(variantSchema).min(1),
    }).parse(args);
    return updateDraftVariants(await liveDraftClient(ctx.accountId), parsed.listingId, parsed.variations);
  },
});
