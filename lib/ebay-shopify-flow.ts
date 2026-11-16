import {
  EBAY_CONDITION_NEW,
  addRequestXml,
  buildEbayItem,
  compareReadback,
  parseGetItem,
  parseTradingListingResponse,
  verifyRequestXml,
  type EbayItemSpecific,
  type EbayListingDefaultsInput,
  type EbayListingSummary,
  type ShopifyListingProduct,
} from './ebay-shopify-listing';
import type { ProductLookup } from './shopify/listing-product';

export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export interface ListingRow {
  previewId: string;
  userEmail: string;
  shopifyProductId: string;
  uuid: string;
  itemXml: string;
  summary: EbayListingSummary;
  status: 'previewed' | 'creating' | 'listed' | 'failed';
  ebayItemId: string | null;
  error: string | null;
  createdAt: Date;
}

export interface ListingStore {
  create(row: ListingRow): Promise<void>;
  find(previewId: string): Promise<ListingRow | null>;
  /** A listed or in-progress row for this product from any preview. */
  findActive(userEmail: string, shopifyProductId: string): Promise<ListingRow | null>;
  /** Moves previewed, failed, or creating to creating. False when another state already holds it. */
  claim(previewId: string, userEmail: string): Promise<boolean>;
  finish(previewId: string, data: { status: 'listed' | 'failed'; ebayItemId?: string | null; error?: string | null }): Promise<void>;
}

export interface ListingDeps {
  product(lookup: ProductLookup): Promise<ShopifyListingProduct>;
  defaults(): Promise<EbayListingDefaultsInput | null>;
  suggestCategories(query: string): Promise<{ categoryId: string; categoryName: string; path: string }[]>;
  requiredAspects(categoryId: string): Promise<string[]>;
  trading(callName: 'VerifyAddFixedPriceItem' | 'AddFixedPriceItem' | 'GetItem', xml: string): Promise<string>;
  seller(): Promise<string | null>;
  store: ListingStore;
  newPreviewId(): string;
  newUuid(): string;
  now(): Date;
}

export interface PreviewInput {
  lookup: ProductLookup;
  categoryId?: string;
  conditionId?: number;
  title?: string;
  descriptionHtml?: string;
  itemSpecifics?: EbayItemSpecific[];
  quantity?: number;
}

function itemUrl(itemId: string): string {
  return `https://www.ebay.com/itm/${itemId}`;
}

export async function previewShopifyListing(userEmail: string, input: PreviewInput, deps: ListingDeps) {
  const product = await deps.product(input.lookup);
  const existing = await deps.store.findActive(userEmail, product.id);
  const base = {
    published: false as const,
    product: { id: product.id, title: product.title, status: product.status },
  };
  if (existing?.ebayItemId) {
    return {
      ...base,
      ok: false,
      previewId: null,
      alreadyListed: { itemId: existing.ebayItemId, url: itemUrl(existing.ebayItemId) },
      problems: [`This Shopify product is already on eBay as item ${existing.ebayItemId}. LotLister does not create a second listing for it.`],
    };
  }

  const defaults = await deps.defaults();
  if (!defaults) {
    return {
      ...base,
      ok: false,
      previewId: null,
      problems: ['Save eBay listing defaults (location, shipping, handling time, and returns) in LotLister settings or with ebay_listing_defaults_update first.'],
    };
  }

  let category: { categoryId: string; categoryName: string | null; chosenBy: 'request' | 'suggestion' } | null = input.categoryId
    ? { categoryId: input.categoryId, categoryName: null, chosenBy: 'request' }
    : null;
  const notes: string[] = [];
  if (!category) {
    const suggestions = await deps.suggestCategories(product.productType ? `${product.title} ${product.productType}` : product.title);
    const top = suggestions[0];
    if (!top) {
      return { ...base, ok: false, previewId: null, problems: ['eBay did not suggest a category. Pass categoryId from ebay_category_suggest.'] };
    }
    category = { categoryId: top.categoryId, categoryName: top.path || top.categoryName, chosenBy: 'suggestion' };
    notes.push(`eBay's top suggested category was used: ${top.path || top.categoryName} (${top.categoryId}). Pass categoryId to choose another.`);
  }

  const conditionId = input.conditionId ?? EBAY_CONDITION_NEW;
  if (input.conditionId == null) notes.push('Condition is New (1000). Pass conditionId for anything else.');

  const built = buildEbayItem(product, defaults, {
    categoryId: category.categoryId,
    conditionId,
    title: input.title,
    descriptionHtml: input.descriptionHtml,
    itemSpecifics: input.itemSpecifics,
    quantity: input.quantity,
  });
  notes.push(...built.notes);

  let missingRequiredSpecifics: string[] = [];
  try {
    const required = await deps.requiredAspects(category.categoryId);
    const have = new Set([
      ...built.summary.itemSpecifics.map((specific) => specific.name.toLowerCase()),
      ...built.summary.variations.flatMap((variation) => Object.keys(variation.options).map((name) => name.toLowerCase())),
    ]);
    missingRequiredSpecifics = required.filter((name) => !have.has(name.toLowerCase()));
  } catch {
    notes.push('eBay did not return the required item specifics for this category. The verify step still checks them.');
  }
  const problems = [...built.problems];
  if (missingRequiredSpecifics.length) {
    problems.push(`eBay requires these item specifics for category ${category.categoryId}: ${missingRequiredSpecifics.join(', ')}. Pass them in itemSpecifics.`);
  }
  if (problems.length) {
    return { ...base, ok: false, previewId: null, category, summary: built.summary, missingRequiredSpecifics, problems, notes };
  }

  const verified = parseTradingListingResponse(await deps.trading('VerifyAddFixedPriceItem', verifyRequestXml(built.itemXml)));
  if (!verified.ok) {
    return {
      ...base,
      ok: false,
      previewId: null,
      category,
      summary: built.summary,
      problems: verified.errors,
      warnings: verified.warnings,
      notes,
    };
  }

  const previewId = deps.newPreviewId();
  await deps.store.create({
    previewId,
    userEmail,
    shopifyProductId: product.id,
    uuid: deps.newUuid(),
    itemXml: built.itemXml,
    summary: built.summary,
    status: 'previewed',
    ebayItemId: null,
    error: null,
    createdAt: deps.now(),
  });
  return {
    ...base,
    ok: true,
    previewId,
    expiresAt: new Date(deps.now().getTime() + PREVIEW_TTL_MS).toISOString(),
    category,
    summary: built.summary,
    fees: verified.fees,
    warnings: verified.warnings,
    notes,
    problems: [],
    next: 'Show this summary to the seller. After they agree, call ebay_listing_create with this previewId and sellerApproved true. eBay checked this listing but nothing is live yet.',
  };
}

export function getItemXml(itemId: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <ItemID>${itemId}</ItemID>
  <IncludeItemSpecifics>false</IncludeItemSpecifics>
  <OutputSelector>Item.ItemID</OutputSelector>
  <OutputSelector>Item.Title</OutputSelector>
  <OutputSelector>Item.SellingStatus.ListingStatus</OutputSelector>
  <OutputSelector>Item.Seller.UserID</OutputSelector>
  <OutputSelector>Item.StartPrice</OutputSelector>
  <OutputSelector>Item.Quantity</OutputSelector>
  <OutputSelector>Item.Variations</OutputSelector>
  <OutputSelector>Item.ListingDetails.ViewItemURL</OutputSelector>
</GetItemRequest>`;
}

export async function createShopifyListing(userEmail: string, previewId: string, sellerApproved: boolean, deps: ListingDeps) {
  if (sellerApproved !== true) {
    return { ok: false, published: false, errors: ['Set sellerApproved to true only after the seller agrees to the preview.'] };
  }
  const row = await deps.store.find(previewId);
  if (!row || row.userEmail !== userEmail) {
    return { ok: false, published: false, errors: ['That preview was not found for this seller. Run ebay_listing_preview again.'] };
  }
  if (row.status === 'listed' && row.ebayItemId) {
    return {
      ok: true,
      published: true,
      alreadyCreated: true,
      itemId: row.ebayItemId,
      url: itemUrl(row.ebayItemId),
      title: row.summary.title,
      verification: { status: 'verified' as const, mismatches: [] },
    };
  }
  if (row.status === 'previewed' && deps.now().getTime() - row.createdAt.getTime() > PREVIEW_TTL_MS) {
    return { ok: false, published: false, errors: ['This preview is more than 24 hours old. Run ebay_listing_preview again so eBay checks the current listing.'] };
  }
  const other = await deps.store.findActive(userEmail, row.shopifyProductId);
  if (other && other.previewId !== previewId) {
    return {
      ok: false,
      published: false,
      errors: [other.ebayItemId
        ? `This Shopify product is already on eBay as item ${other.ebayItemId}.`
        : `Another preview (${other.previewId}) for this product is being listed. Retry that previewId instead.`],
      ...(other.ebayItemId ? { alreadyListed: { itemId: other.ebayItemId, url: itemUrl(other.ebayItemId) } } : {}),
    };
  }
  if (!(await deps.store.claim(previewId, userEmail))) {
    return { ok: false, published: false, errors: ['This preview cannot be listed from its current state. Run ebay_listing_preview again.'] };
  }

  const outcome = parseTradingListingResponse(await deps.trading('AddFixedPriceItem', addRequestXml(row.itemXml, row.uuid)));
  const itemId = outcome.ok ? outcome.itemId : outcome.duplicateItemId;
  if (!itemId) {
    const error = outcome.errors.join('\n') || 'eBay did not create the listing';
    await deps.store.finish(previewId, { status: 'failed', error });
    return { ok: false, published: false, errors: outcome.errors, warnings: outcome.warnings };
  }

  await deps.store.finish(previewId, { status: 'listed', ebayItemId: itemId, error: null });
  let mismatches: string[] = [];
  let verification: 'verified' | 'mismatch' | 'not_run' = 'not_run';
  let url = itemUrl(itemId);
  try {
    const readback = parseGetItem(await deps.trading('GetItem', getItemXml(itemId)));
    if (readback) {
      mismatches = compareReadback(row.summary, readback, await deps.seller());
      verification = mismatches.length ? 'mismatch' : 'verified';
      url = readback.url || url;
    }
  } catch {
    verification = 'not_run';
  }
  return {
    ok: verification === 'verified',
    published: true,
    alreadyCreated: !outcome.ok,
    itemId,
    url,
    title: row.summary.title,
    verification: { status: verification, mismatches },
    fees: outcome.fees,
    warnings: outcome.warnings,
  };
}
