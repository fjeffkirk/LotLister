import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from './prisma';
import { getEbayApplicationToken, getEbayCredentials, getValidEbayAccessToken, missingEbayEnvVars, tradingCall } from './ebay';
import { EBAY_RETURN_DAYS, EBAY_SHIPPING_SERVICES, type EbayListingDefaultsInput, type EbayListingSummary } from './ebay-shopify-listing';
import type { ListingDeps, ListingRow, ListingStore } from './ebay-shopify-flow';
import { shopify } from './shopify/client';

const TAXONOMY = 'https://api.ebay.com/commerce/taxonomy/v1/category_tree/0';
const METADATA = 'https://api.ebay.com/sell/metadata/v1/marketplace/EBAY_US';

export const listingDefaultsSchema = z.object({
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'postalCode must be a US ZIP code'),
  location: z.string().trim().min(2).max(45),
  shippingService: z.enum(EBAY_SHIPPING_SERVICES),
  shippingCost: z.number().min(0).max(1000),
  freeShipping: z.boolean(),
  additionalItemCost: z.number().min(0).max(1000).default(0),
  handlingDays: z.number().int().min(0).max(30),
  returnsAccepted: z.boolean(),
  returnDays: z.number().int().refine((days) => (EBAY_RETURN_DAYS as readonly number[]).includes(days), 'returnDays must be 14, 30, or 60'),
  returnShippingPaidBy: z.enum(['Buyer', 'Seller']),
  bestOfferEnabled: z.boolean().default(false),
});

export async function getListingDefaults(userEmail: string): Promise<EbayListingDefaultsInput | null> {
  const row = await prisma.ebayListingDefaults.findUnique({ where: { userEmail } });
  if (!row) return null;
  return {
    postalCode: row.postalCode,
    location: row.location,
    shippingService: row.shippingService,
    shippingCost: row.shippingCost,
    freeShipping: row.freeShipping,
    additionalItemCost: row.additionalItemCost,
    handlingDays: row.handlingDays,
    returnsAccepted: row.returnsAccepted,
    returnDays: row.returnDays,
    returnShippingPaidBy: row.returnShippingPaidBy,
    bestOfferEnabled: row.bestOfferEnabled,
  };
}

export async function saveListingDefaults(userEmail: string, input: unknown): Promise<EbayListingDefaultsInput> {
  const data = listingDefaultsSchema.parse(input);
  await prisma.ebayListingDefaults.upsert({ where: { userEmail }, create: { userEmail, ...data }, update: data });
  return data;
}

async function ebayJson(url: string): Promise<unknown> {
  const token = await getEbayApplicationToken();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Language': 'en-US' },
    cache: 'no-store',
  });
  if (response.status === 204) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`eBay request failed (${response.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

interface SuggestionBody {
  categorySuggestions?: {
    category?: { categoryId?: string; categoryName?: string };
    categoryTreeNodeAncestors?: { categoryName?: string }[];
  }[];
}

export async function suggestEbayCategories(query: string): Promise<{ categoryId: string; categoryName: string; path: string }[]> {
  const body = await ebayJson(`${TAXONOMY}/get_category_suggestions?q=${encodeURIComponent(query.slice(0, 350))}`) as SuggestionBody | null;
  return (body?.categorySuggestions ?? []).slice(0, 8).flatMap((suggestion) => {
    const id = suggestion.category?.categoryId;
    const name = suggestion.category?.categoryName ?? '';
    if (!id) return [];
    const ancestors = (suggestion.categoryTreeNodeAncestors ?? []).map((node) => node.categoryName ?? '').filter(Boolean).reverse();
    return [{ categoryId: id, categoryName: name, path: [...ancestors, name].join(' > ') }];
  });
}

interface AspectsBody {
  aspects?: {
    localizedAspectName?: string;
    aspectConstraint?: { aspectRequired?: boolean; aspectUsage?: string; aspectMode?: string; aspectEnabledForVariations?: boolean; itemToAspectCardinality?: string };
    aspectValues?: { localizedValue?: string }[];
  }[];
}

export async function categoryAspects(categoryId: string) {
  if (!/^\d+$/.test(categoryId)) throw new Error('categoryId must be numeric');
  const body = await ebayJson(`${TAXONOMY}/get_item_aspects_for_category?category_id=${categoryId}`) as AspectsBody | null;
  return (body?.aspects ?? []).flatMap((aspect) => {
    if (!aspect.localizedAspectName) return [];
    const constraint = aspect.aspectConstraint ?? {};
    return [{
      name: aspect.localizedAspectName,
      required: constraint.aspectRequired === true,
      usage: constraint.aspectUsage ?? null,
      mode: constraint.aspectMode ?? null,
      multipleValues: constraint.itemToAspectCardinality === 'MULTI',
      usableForVariations: constraint.aspectEnabledForVariations === true,
      values: (aspect.aspectValues ?? []).slice(0, 30).map((value) => value.localizedValue).filter(Boolean),
    }];
  });
}

interface ConditionsBody {
  itemConditionPolicies?: { itemConditionRequired?: boolean; itemConditions?: { conditionId?: string; conditionDescription?: string; usage?: string }[] }[];
}

export async function categoryConditions(categoryId: string) {
  const body = await ebayJson(`${METADATA}/get_item_condition_policies?filter=${encodeURIComponent(`categoryIds:{${categoryId}}`)}`) as ConditionsBody | null;
  const policy = body?.itemConditionPolicies?.[0];
  return {
    conditionRequired: policy?.itemConditionRequired ?? null,
    conditions: (policy?.itemConditions ?? [])
      .filter((condition) => condition.usage !== 'RESTRICTED')
      .map((condition) => ({ conditionId: Number(condition.conditionId), description: condition.conditionDescription ?? '' })),
  };
}

function toRow(record: {
  previewId: string;
  userEmail: string;
  shopifyProductId: string;
  uuid: string;
  itemXml: string;
  summary: Prisma.JsonValue;
  status: string;
  ebayItemId: string | null;
  error: string | null;
  createdAt: Date;
}): ListingRow {
  return {
    ...record,
    summary: record.summary as unknown as EbayListingSummary,
    status: record.status as ListingRow['status'],
  };
}

export function prismaListingStore(): ListingStore {
  return {
    async create(row) {
      await prisma.ebayProductListing.create({
        data: { ...row, summary: row.summary as unknown as Prisma.InputJsonValue },
      });
    },
    async find(previewId) {
      const record = await prisma.ebayProductListing.findUnique({ where: { previewId } });
      return record ? toRow(record) : null;
    },
    async findActive(userEmail, shopifyProductId) {
      const record = await prisma.ebayProductListing.findFirst({
        where: { userEmail, shopifyProductId, status: { in: ['listed', 'creating'] } },
        orderBy: { createdAt: 'desc' },
      });
      return record ? toRow(record) : null;
    },
    async claim(previewId, userEmail) {
      const claimed = await prisma.ebayProductListing.updateMany({
        where: { previewId, userEmail, status: { in: ['previewed', 'failed', 'creating'] } },
        data: { status: 'creating', error: null },
      });
      return claimed.count === 1;
    },
    async finish(previewId, data) {
      await prisma.ebayProductListing.update({ where: { previewId }, data });
    },
  };
}

export function liveListingDeps(userEmail: string): ListingDeps {
  return {
    product: (lookup) => shopify.productForListing(lookup),
    defaults: () => getListingDefaults(userEmail),
    suggestCategories: suggestEbayCategories,
    async requiredAspects(categoryId) {
      return (await categoryAspects(categoryId)).filter((aspect) => aspect.required).map((aspect) => aspect.name);
    },
    async trading(callName, xml) {
      const creds = await getEbayCredentials();
      if (!creds) throw new Error(`eBay is not configured on the server. Missing: ${missingEbayEnvVars().join(', ')}`);
      const token = await getValidEbayAccessToken(userEmail);
      const { status, text } = await tradingCall(creds, token, callName, xml);
      if (!text.includes('<Ack>')) throw new Error(`eBay ${callName} failed (${status})`);
      return text;
    },
    async seller() {
      const connection = await prisma.ebayConnection.findUnique({ where: { userEmail } });
      return connection?.ebayUsername ?? null;
    },
    store: prismaListingStore(),
    newPreviewId: () => `ebl_${randomBytes(12).toString('hex')}`,
    newUuid: () => randomBytes(16).toString('hex').toUpperCase(),
    now: () => new Date(),
  };
}
