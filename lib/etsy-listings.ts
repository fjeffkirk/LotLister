import { createHash } from 'crypto';
import { etsyErrorText, etsyTags, etsyTitle } from './etsy-listing';
import {
  ETSY_IMAGE_MAX_BYTES,
  ETSY_IMAGE_TYPES,
  ETSY_WHEN_MADE,
  ETSY_WHO_MADE,
  InventoryBody,
  ProductAttribute,
  ProductImageInput,
  VariantInput,
  buildInventoryBody,
  draftEditorUrl,
} from './etsy-product';
import type { EtsyDraftClient, EtsyDraftResponse, RemoteImage } from './etsy-drafts';

export const ETSY_LISTING_STATES = ['active', 'inactive', 'draft', 'expired', 'sold_out'] as const;
export type EtsyListingState = (typeof ETSY_LISTING_STATES)[number];

const EDITABLE = new Set<string>(ETSY_LISTING_STATES);

export interface ListingContentPatch {
  title?: string;
  description?: string;
  tags?: string[];
  materials?: string[];
  taxonomyId?: number;
  whoMade?: string;
  whenMade?: string;
  isSupply?: boolean;
  shippingProfileId?: string;
  readinessStateId?: string;
  returnPolicyId?: string;
  price?: number;
  quantity?: number;
  sku?: string;
  attributes?: ProductAttribute[];
  expectedUpdatedTimestamp?: number;
}

export interface ListingEditResult {
  ok: boolean;
  published: false;
  listingId: string;
  url: string | null;
  state: string | null;
  fieldsChanged: string[];
  verification: { status: 'verified' | 'mismatch' | 'not_run'; mismatches: string[] };
  partialFailures: string[];
  errors: string[];
}

type ImageLoader = (url: string) => Promise<RemoteImage>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function errorText(response: EtsyDraftResponse): string {
  return etsyErrorText(response.status, response.text || JSON.stringify(response.body ?? ''));
}

export function missingEtsyScope(status: number, body: string, needed: 'listings_r' | 'listings_w'): string | null {
  if (status !== 401 && status !== 403) return null;
  const text = `${status} ${body}`;
  if (status === 401 || /token|oauth|unauthorized/i.test(text)) {
    return 'The Etsy connection needs to be refreshed. Reconnect the shop in LotLister settings.';
  }
  if (/scope|permission|not permitted|forbidden/i.test(text) || status === 403) {
    return `The connected Etsy account is missing the ${needed} permission. Disconnect and reconnect Etsy in LotLister settings so the shop grants ${needed}.`;
  }
  return null;
}

function fail(listingId: string, errors: string[], partialFailures: string[] = []): ListingEditResult {
  return {
    ok: false,
    published: false,
    listingId,
    url: null,
    state: null,
    fieldsChanged: [],
    verification: { status: 'not_run', mismatches: [] },
    partialFailures,
    errors,
  };
}

function listingUrl(listingId: string, state: string | null): string {
  if (state === 'active' || state === 'sold_out') return `https://www.etsy.com/listing/${listingId}`;
  return draftEditorUrl(listingId);
}

function timestampOf(listing: Record<string, unknown>): number | null {
  const value = Number(listing.updated_timestamp ?? listing.last_modified_timestamp ?? listing.updated_tsz);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function moneyAmount(price: unknown): number | null {
  if (typeof price === 'number' && Number.isFinite(price)) return price;
  const record = asRecord(price);
  const amount = Number(record.amount);
  const divisor = Number(record.divisor);
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor === 0) return null;
  return amount / divisor;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim());
  return [];
}

export function contentUpdateForm(patch: ListingContentPatch): { form: URLSearchParams; errors: string[]; fields: string[] } {
  const errors: string[] = [];
  const form = new URLSearchParams();
  const fields: string[] = [];
  if (patch.title?.trim()) {
    const title = etsyTitle(patch.title);
    for (const symbol of ['%', ':', '&', '+']) {
      if (title.split(symbol).length > 2) errors.push(`Title can use "${symbol}" only once`);
    }
    form.set('title', title);
    fields.push('title');
  }
  if (patch.description?.trim()) {
    form.set('description', patch.description.trim());
    fields.push('description');
  }
  if (patch.whoMade) {
    if (!ETSY_WHO_MADE.includes(patch.whoMade as (typeof ETSY_WHO_MADE)[number])) errors.push('whoMade must be i_did, someone_else, or collective');
    else {
      form.set('who_made', patch.whoMade);
      fields.push('whoMade');
    }
  }
  if (patch.whenMade) {
    if (!ETSY_WHEN_MADE.includes(patch.whenMade as (typeof ETSY_WHEN_MADE)[number])) errors.push('whenMade is not one of the eras Etsy accepts');
    else {
      form.set('when_made', patch.whenMade);
      fields.push('whenMade');
    }
  }
  if (patch.taxonomyId) {
    form.set('taxonomy_id', String(patch.taxonomyId));
    fields.push('taxonomyId');
  }
  if (patch.shippingProfileId) {
    form.set('shipping_profile_id', patch.shippingProfileId);
    fields.push('shippingProfileId');
  }
  if (patch.readinessStateId) {
    form.set('readiness_state_id', patch.readinessStateId);
    fields.push('readinessStateId');
  }
  if (patch.returnPolicyId) {
    form.set('return_policy_id', patch.returnPolicyId);
    fields.push('returnPolicyId');
  }
  if (patch.isSupply != null) {
    form.set('is_supply', patch.isSupply ? 'true' : 'false');
    fields.push('isSupply');
  }
  if (patch.tags) {
    const tags = etsyTags(patch.tags);
    if (!tags.length) errors.push('tags did not include a usable tag');
    else {
      form.set('tags', tags.join(','));
      fields.push('tags');
    }
  }
  if (patch.materials) {
    const materials = patch.materials.map((item) => item.trim()).filter(Boolean);
    if (materials.some((item) => /[^\p{L}\p{Nd}\p{Zs}]/u.test(item))) errors.push('Materials can only contain letters, numbers, and spaces');
    else if (!materials.length) errors.push('materials did not include a usable value');
    else {
      form.set('materials', materials.slice(0, 13).join(','));
      fields.push('materials');
    }
  }
  return { form, errors, fields };
}

async function readOwned(client: EtsyDraftClient, listingId: string): Promise<{ listing: Record<string, unknown> } | { error: string }> {
  const response = await client.request('GET', `/application/listings/${encodeURIComponent(listingId)}`);
  if (response.status >= 400) {
    return { error: missingEtsyScope(response.status, response.text, 'listings_r') ?? errorText(response) };
  }
  const listing = asRecord(response.body);
  if (String(listing.shop_id ?? '') !== client.shopId) {
    return { error: 'That listing is not in the connected Etsy shop' };
  }
  const state = String(listing.state ?? '');
  if (!EDITABLE.has(state)) {
    return { error: `Etsy state "${state || 'unknown'}" cannot be edited with these tools.` };
  }
  return { listing };
}

function publicListing(listing: Record<string, unknown>, inventory: unknown, images: unknown) {
  const listingId = String(listing.listing_id ?? '');
  const state = String(listing.state ?? '');
  return {
    listingId,
    shopId: String(listing.shop_id ?? ''),
    state,
    url: listingUrl(listingId, state),
    updatedTimestamp: timestampOf(listing),
    editable: {
      title: listing.title ?? null,
      description: listing.description ?? null,
      tags: stringList(listing.tags),
      materials: stringList(listing.materials),
      taxonomyId: listing.taxonomy_id ?? null,
      whoMade: listing.who_made ?? null,
      whenMade: listing.when_made ?? null,
      isSupply: listing.is_supply ?? null,
      shippingProfileId: listing.shipping_profile_id ?? null,
      readinessStateId: listing.readiness_state_id ?? null,
      returnPolicyId: listing.return_policy_id ?? null,
      price: moneyAmount(listing.price),
      quantity: listing.quantity ?? null,
      skus: listing.skus ?? null,
    },
    images,
    inventory,
    profiles: {
      shippingProfileId: listing.shipping_profile_id ?? null,
      readinessStateId: listing.readiness_state_id ?? null,
      returnPolicyId: listing.return_policy_id ?? null,
    },
  };
}

export async function listShopListings(client: EtsyDraftClient, input: {
  state?: EtsyListingState;
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<Record<string, unknown>> {
  const state = input.state ?? 'active';
  const limit = Math.min(100, Math.max(1, input.limit ?? 25));
  const offset = Math.max(0, input.offset ?? 0);
  const response = await client.request(
    'GET',
    `/application/shops/${client.shopId}/listings?state=${encodeURIComponent(state)}&limit=${limit}&offset=${offset}`,
  );
  if (response.status >= 400) {
    return { ok: false, errors: [missingEtsyScope(response.status, response.text, 'listings_r') ?? errorText(response)] };
  }
  const body = asRecord(response.body);
  const results = Array.isArray(body.results) ? body.results.map((item) => asRecord(item)) : [];
  const query = input.query?.trim().toLowerCase();
  const listings = results
    .filter((listing) => String(listing.shop_id ?? client.shopId) === client.shopId)
    .filter((listing) => {
      if (!query) return true;
      const products = asRecord(listing.inventory).products;
      const skus = Array.isArray(products) ? products.map((product) => String(asRecord(product).sku ?? '')) : stringList(listing.skus);
      const haystack = [listing.title, ...stringList(listing.tags), ...skus].join(' ').toLowerCase();
      return haystack.includes(query);
    })
    .map((listing) => ({
      listingId: String(listing.listing_id ?? ''),
      title: listing.title ?? null,
      state: listing.state ?? state,
      url: listingUrl(String(listing.listing_id ?? ''), String(listing.state ?? state)),
      updatedTimestamp: timestampOf(listing),
    }));
  const count = Number(body.count ?? results.length);
  return {
    ok: true,
    shopId: client.shopId,
    state,
    query: input.query ?? null,
    limit,
    offset,
    count: Number.isFinite(count) ? count : results.length,
    nextOffset: offset + limit < count ? offset + limit : null,
    listings,
    note: query ? 'The query filters titles, tags, and SKUs on this page. Page with nextOffset to keep searching.' : null,
  };
}

export async function getShopListing(client: EtsyDraftClient, listingId: string): Promise<Record<string, unknown>> {
  const owned = await readOwned(client, listingId);
  if ('error' in owned) return { ok: false, listingId, errors: [owned.error] };
  const [inventory, images] = await Promise.all([
    client.request('GET', `/application/listings/${listingId}/inventory`),
    client.request('GET', `/application/listings/${listingId}/images`),
  ]);
  return {
    ok: true,
    ...publicListing(
      owned.listing,
      inventory.status < 400 ? inventory.body : null,
      images.status < 400 ? images.body : null,
    ),
    inventoryError: inventory.status >= 400 ? (missingEtsyScope(inventory.status, inventory.text, 'listings_r') ?? errorText(inventory)) : null,
    imagesError: images.status >= 400 ? (missingEtsyScope(images.status, images.text, 'listings_r') ?? errorText(images)) : null,
  };
}

function sameList(actual: unknown, expected: string[]): boolean {
  const left = stringList(actual).map((item) => item.toLowerCase()).sort();
  const right = expected.map((item) => item.toLowerCase()).sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function mismatchesFor(before: Record<string, unknown>, after: Record<string, unknown>, patch: ListingContentPatch, fields: string[]): string[] {
  const mismatches: string[] = [];
  if (String(after.state ?? '') !== String(before.state ?? '')) {
    mismatches.push(`state changed from ${String(before.state)} to ${String(after.state)}`);
  }
  if (String(after.listing_id ?? '') !== String(before.listing_id ?? '')) mismatches.push('listing id changed');
  const checks: Record<string, () => boolean> = {
    title: () => String(after.title ?? '') === etsyTitle(patch.title ?? ''),
    description: () => String(after.description ?? '') === patch.description?.trim(),
    tags: () => sameList(after.tags, etsyTags(patch.tags ?? [])),
    materials: () => sameList(after.materials, patch.materials ?? []),
    taxonomyId: () => String(after.taxonomy_id ?? '') === String(patch.taxonomyId),
    whoMade: () => String(after.who_made ?? '') === patch.whoMade,
    whenMade: () => String(after.when_made ?? '') === patch.whenMade,
    shippingProfileId: () => String(after.shipping_profile_id ?? '') === patch.shippingProfileId,
    readinessStateId: () => String(after.readiness_state_id ?? '') === patch.readinessStateId,
    returnPolicyId: () => String(after.return_policy_id ?? '') === patch.returnPolicyId,
    isSupply: () => String(after.is_supply) === String(patch.isSupply),
  };
  for (const field of fields) {
    const check = checks[field];
    if (check && !check()) mismatches.push(field);
  }
  return mismatches;
}

async function applyAttributes(client: EtsyDraftClient, listingId: string, attributes: ProductAttribute[]): Promise<string[]> {
  const failures: string[] = [];
  for (const attribute of attributes) {
    const form = new URLSearchParams();
    for (const id of attribute.valueIds) form.append('value_ids', String(id));
    for (const value of attribute.values) form.append('values', value);
    if (attribute.scaleId) form.set('scale_id', String(attribute.scaleId));
    const response = await client.request('PUT', `/application/shops/${client.shopId}/listings/${listingId}/properties/${attribute.propertyId}`, form);
    if (response.status >= 400) {
      failures.push(missingEtsyScope(response.status, response.text, 'listings_w') ?? `attribute ${attribute.propertyId}: ${errorText(response)}`);
    }
  }
  return failures;
}

function productsOf(body: unknown): Record<string, unknown>[] {
  const products = asRecord(body).products;
  return Array.isArray(products) ? products.map((product) => asRecord(product)) : [];
}

function inventoryInput(body: unknown): Parameters<typeof buildInventoryBody>[0] {
  return productsOf(body) as Parameters<typeof buildInventoryBody>[0];
}

const FORM_KEYS: Record<string, string> = {
  title: 'title',
  description: 'description',
  tags: 'tags',
  materials: 'materials',
  taxonomyId: 'taxonomy_id',
  whoMade: 'who_made',
  whenMade: 'when_made',
  isSupply: 'is_supply',
  shippingProfileId: 'shipping_profile_id',
  readinessStateId: 'readiness_state_id',
  returnPolicyId: 'return_policy_id',
};

function alreadyOnListing(listing: Record<string, unknown>, patch: ListingContentPatch, field: string): boolean {
  if (field === 'title') return String(listing.title ?? '') === etsyTitle(patch.title ?? '');
  if (field === 'description') return String(listing.description ?? '') === patch.description?.trim();
  if (field === 'tags') return sameList(listing.tags, etsyTags(patch.tags ?? []));
  if (field === 'materials') return sameList(listing.materials, patch.materials ?? []);
  if (field === 'taxonomyId') return String(listing.taxonomy_id ?? '') === String(patch.taxonomyId);
  if (field === 'whoMade') return String(listing.who_made ?? '') === patch.whoMade;
  if (field === 'whenMade') return String(listing.when_made ?? '') === patch.whenMade;
  if (field === 'shippingProfileId') return String(listing.shipping_profile_id ?? '') === patch.shippingProfileId;
  if (field === 'readinessStateId') return String(listing.readiness_state_id ?? '') === patch.readinessStateId;
  if (field === 'returnPolicyId') return String(listing.return_policy_id ?? '') === patch.returnPolicyId;
  if (field === 'isSupply') return Boolean(listing.is_supply) === patch.isSupply;
  return false;
}

export async function updateShopListing(client: EtsyDraftClient, listingId: string, patch: ListingContentPatch): Promise<ListingEditResult> {
  const owned = await readOwned(client, listingId);
  if ('error' in owned) return fail(listingId, [owned.error]);
  const before = owned.listing;
  const state = String(before.state ?? '');
  const revision = timestampOf(before);
  if (patch.expectedUpdatedTimestamp != null && revision != null && patch.expectedUpdatedTimestamp !== revision) {
    return fail(listingId, [`The listing changed since it was read (updated timestamp ${revision}). Read it again before editing.`]);
  }
  const { form, errors, fields } = contentUpdateForm(patch);
  if (errors.length) return fail(listingId, errors);
  const inventoryFields = [patch.price != null, patch.quantity != null, patch.sku != null].some(Boolean);
  const attributeFields = Boolean(patch.attributes?.length);
  if (!fields.length && !inventoryFields && !attributeFields) return fail(listingId, ['No listing fields were provided to update']);

  const partialFailures: string[] = [];
  const contentFields = fields.filter((field) => !alreadyOnListing(before, patch, field));
  for (const field of fields) {
    if (!contentFields.includes(field)) form.delete(FORM_KEYS[field] ?? field);
  }
  if ([...form.keys()].length) {
    const response = await client.request('PATCH', `/application/shops/${client.shopId}/listings/${listingId}`, form);
    if (response.status >= 400) {
      return fail(listingId, [missingEtsyScope(response.status, response.text, 'listings_w') ?? errorText(response)]);
    }
  }
  if (inventoryFields) {
    const current = await client.request('GET', `/application/listings/${listingId}/inventory`);
    const products = current.status < 400 ? productsOf(current.body) : [];
    if (current.status >= 400) partialFailures.push(missingEtsyScope(current.status, current.text, 'listings_r') ?? errorText(current));
    else if (products.length > 1) {
      partialFailures.push('This listing has more than one variant. Change price, quantity, or SKU with etsy_listing_variants_update so the other variants stay in the payload.');
    }
    const product = products[0] ?? {};
    if (current.status < 400 && products.length <= 1) {
    const offering = asRecord((Array.isArray(product.offerings) ? product.offerings[0] : null));
    const propertyValues = Array.isArray(product.property_values) ? product.property_values.map((item) => asRecord(item)) : [];
    const variant: VariantInput = {
      sku: patch.sku ?? (product.sku ? String(product.sku) : undefined),
      price: patch.price ?? moneyAmount(offering.price) ?? moneyAmount(before.price) ?? 0,
      quantity: patch.quantity ?? Number(offering.quantity ?? before.quantity ?? 0),
      readinessStateId: offering.readiness_state_id ? String(offering.readiness_state_id) : undefined,
      options: propertyValues.flatMap((property) => {
        if (!property.property_id) return [];
        return [{
          propertyId: Number(property.property_id),
          name: property.property_name ? String(property.property_name) : undefined,
          value: stringList(property.values)[0] ?? '',
          valueId: Array.isArray(property.value_ids) ? Number(property.value_ids[0]) : undefined,
        }];
      }).filter((option) => option.value),
    };
    try {
      const body = buildInventoryBody(inventoryInput(current.body), [variant]);
      const saved = await client.request('PUT', `/application/listings/${listingId}/inventory`, JSON.stringify(body));
      if (saved.status >= 400) partialFailures.push(missingEtsyScope(saved.status, saved.text, 'listings_w') ?? errorText(saved));
      else contentFields.push(...(['price', 'quantity', 'sku'] as const).filter((field) => patch[field] != null));
    } catch (error) {
      partialFailures.push(error instanceof Error ? error.message : 'Could not update inventory');
    }
    }
  }
  if (patch.attributes?.length) {
    partialFailures.push(...await applyAttributes(client, listingId, patch.attributes));
    if (!partialFailures.some((item) => item.startsWith('attribute'))) contentFields.push('attributes');
  }

  const after = await client.request('GET', `/application/listings/${listingId}`);
  if (after.status >= 400) {
    return {
      ...fail(listingId, [missingEtsyScope(after.status, after.text, 'listings_r') ?? errorText(after)], partialFailures),
      fieldsChanged: contentFields,
      state,
      url: listingUrl(listingId, state),
    };
  }
  const verified = asRecord(after.body);
  const mismatches = mismatchesFor(before, verified, patch, contentFields.filter((field) => field !== 'price' && field !== 'quantity' && field !== 'sku' && field !== 'attributes'));
  if (contentFields.some((field) => field === 'price' || field === 'quantity' || field === 'sku')) {
    const inventory = await client.request('GET', `/application/listings/${listingId}/inventory`);
    const products = inventory.status < 400 ? productsOf(inventory.body) : [];
    const offering = asRecord(Array.isArray(products[0]?.offerings) ? products[0].offerings[0] : null);
    if (patch.price != null && moneyAmount(offering.price)?.toFixed(2) !== patch.price.toFixed(2)) mismatches.push('price');
    if (patch.quantity != null && Number(offering.quantity) !== patch.quantity) mismatches.push('quantity');
    if (patch.sku != null && String(products[0]?.sku ?? '') !== patch.sku) mismatches.push('sku');
    if (inventory.status >= 400) partialFailures.push(errorText(inventory));
  }
  return {
    ok: mismatches.length === 0 && partialFailures.length === 0,
    published: false,
    listingId,
    url: listingUrl(listingId, String(verified.state ?? state)),
    state: String(verified.state ?? state),
    fieldsChanged: contentFields,
    verification: { status: mismatches.length ? 'mismatch' : 'verified', mismatches },
    partialFailures,
    errors: [],
  };
}

export async function updateShopListingVariants(client: EtsyDraftClient, listingId: string, variations: VariantInput[], expectedUpdatedTimestamp?: number): Promise<ListingEditResult> {
  const owned = await readOwned(client, listingId);
  if ('error' in owned) return fail(listingId, [owned.error]);
  const revision = timestampOf(owned.listing);
  if (expectedUpdatedTimestamp != null && revision != null && expectedUpdatedTimestamp !== revision) {
    return fail(listingId, [`The listing changed since it was read (updated timestamp ${revision}). Read it again before editing.`]);
  }
  const current = await client.request('GET', `/application/listings/${listingId}/inventory`);
  if (current.status >= 400) return fail(listingId, [missingEtsyScope(current.status, current.text, 'listings_r') ?? errorText(current)]);
  let body: InventoryBody;
  try {
    body = buildInventoryBody(inventoryInput(current.body), variations);
  } catch (error) {
    return fail(listingId, [error instanceof Error ? error.message : 'Could not build inventory']);
  }
  const saved = await client.request('PUT', `/application/listings/${listingId}/inventory`, JSON.stringify(body));
  if (saved.status >= 400) return fail(listingId, [missingEtsyScope(saved.status, saved.text, 'listings_w') ?? errorText(saved)]);
  const readback = await client.request('GET', `/application/listings/${listingId}/inventory`);
  const returned = readback.status < 400 ? productsOf(readback.body) : [];
  const mismatches: string[] = [];
  for (const variant of variations) {
    const sku = variant.sku?.trim();
    const match = sku
      ? returned.find((product) => String(product.sku ?? '') === sku)
      : returned.find((product) => variant.options.every((option) => {
        const values = Array.isArray(product.property_values) ? product.property_values.map((item) => asRecord(item)) : [];
        return values.some((property) => String(stringList(property.values)[0] ?? '').toLowerCase() === option.value.trim().toLowerCase());
      }));
    if (!match) {
      mismatches.push(sku || variant.options.map((option) => option.value).join('/'));
      continue;
    }
    const offering = asRecord(Array.isArray(match.offerings) ? match.offerings[0] : null);
    const price = moneyAmount(offering.price);
    if (price == null || price.toFixed(2) !== variant.price.toFixed(2)) mismatches.push(`${sku || 'variant'} price`);
    if (Number(offering.quantity) !== variant.quantity) mismatches.push(`${sku || 'variant'} quantity`);
  }
  for (const product of body.products) {
    if (product.sku && !returned.some((item) => String(item.sku ?? '') === product.sku)) mismatches.push(`missing variant ${product.sku}`);
  }
  if (String(owned.listing.state) && readback.status < 400) {
    const listing = await client.request('GET', `/application/listings/${listingId}`);
    const after = asRecord(listing.body);
    if (listing.status < 400 && String(after.state ?? '') !== String(owned.listing.state)) {
      mismatches.push(`state changed from ${String(owned.listing.state)} to ${String(after.state)}`);
    }
  }
  const state = String(owned.listing.state ?? '');
  return {
    ok: mismatches.length === 0 && readback.status < 400,
    published: false,
    listingId,
    url: listingUrl(listingId, state),
    state,
    fieldsChanged: ['variations'],
    verification: { status: mismatches.length || readback.status >= 400 ? 'mismatch' : 'verified', mismatches },
    partialFailures: readback.status >= 400 ? [errorText(readback)] : [],
    errors: [],
  };
}

function imageMarker(url: string): string {
  return `lotlister-src:${createHash('sha256').update(url).digest('hex').slice(0, 32)}`;
}

function imageResults(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.map((item) => asRecord(item));
  const results = asRecord(body).results;
  return Array.isArray(results) ? results.map((item) => asRecord(item)) : [];
}

export async function updateShopListingImages(client: EtsyDraftClient, listingId: string, input: {
  add?: ProductImageInput[];
  replace?: { listingImageId: string; url: string; altText?: string }[];
  reorder?: { listingImageId: string; rank: number }[];
}, loadImage: ImageLoader): Promise<ListingEditResult> {
  const owned = await readOwned(client, listingId);
  if ('error' in owned) return fail(listingId, [owned.error]);
  const beforeImages = await client.request('GET', `/application/listings/${listingId}/images`);
  if (beforeImages.status >= 400) return fail(listingId, [missingEtsyScope(beforeImages.status, beforeImages.text, 'listings_r') ?? errorText(beforeImages)]);
  const images = imageResults(beforeImages.body);
  const beforeIds = new Set(images.map((image) => String(image.listing_image_id ?? '')));
  const variationResponse = await client.request('GET', `/application/shops/${client.shopId}/listings/${listingId}/variation-images`);
  const variationBody = asRecord(variationResponse.body);
  const variationRows = Array.isArray(variationResponse.body)
    ? variationResponse.body
    : Array.isArray(variationBody.results) ? variationBody.results : [];
  const associations = variationResponse.status < 400 ? variationRows.map((item) => asRecord(item)) : [];
  const imageIdChanges = new Map<string, string>();
  const partialFailures: string[] = [];
  const fields: string[] = [];

  for (const move of input.reorder ?? []) {
    if (!beforeIds.has(move.listingImageId)) {
      partialFailures.push(`reorder ${move.listingImageId}: that image is not on this listing`);
      continue;
    }
    const form = new FormData();
    form.append('listing_image_id', move.listingImageId);
    form.append('rank', String(move.rank));
    const response = await client.request('POST', `/application/shops/${client.shopId}/listings/${listingId}/images`, form);
    if (response.status >= 400) partialFailures.push(`reorder ${move.listingImageId}: ${missingEtsyScope(response.status, response.text, 'listings_w') ?? errorText(response)}`);
    else fields.push(`reorder:${move.listingImageId}`);
  }

  for (const replacement of input.replace ?? []) {
    const current = images.find((image) => String(image.listing_image_id ?? '') === replacement.listingImageId);
    if (!current) {
      partialFailures.push(`replace ${replacement.listingImageId}: that image is not on this listing`);
      continue;
    }
    const marker = replacement.altText || imageMarker(replacement.url);
    if (String(current.alt_text ?? '') === marker) {
      fields.push(`replace:existing:${replacement.listingImageId}`);
      continue;
    }
    try {
      const file = await loadImage(replacement.url);
      if (!ETSY_IMAGE_TYPES.has(file.type)) throw new Error('Image must be JPEG, PNG, or GIF');
      if (file.bytes.length > ETSY_IMAGE_MAX_BYTES) throw new Error('Image is larger than 10 MB');
      const body = new FormData();
      body.append('image', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.filename);
      body.append('rank', String(current.rank ?? 1));
      body.append('overwrite', 'true');
      body.append('alt_text', marker);
      const response = await client.request('POST', `/application/shops/${client.shopId}/listings/${listingId}/images`, body);
      if (response.status >= 400) throw new Error(missingEtsyScope(response.status, response.text, 'listings_w') ?? errorText(response));
      const createdId = String(asRecord(response.body).listing_image_id ?? '');
      if (createdId && createdId !== replacement.listingImageId) imageIdChanges.set(replacement.listingImageId, createdId);
      fields.push(`replace:${replacement.listingImageId}`);
    } catch (error) {
      partialFailures.push(`replace ${replacement.listingImageId}: ${error instanceof Error ? error.message : 'Image upload failed'}`);
    }
  }

  for (const [index, image] of (input.add ?? []).entries()) {
    const marker = imageMarker(image.url);
    if (images.some((existing) => String(existing.alt_text ?? '') === marker)) {
      fields.push(`add:existing:${marker}`);
      continue;
    }
    try {
      const file = await loadImage(image.url);
      if (!ETSY_IMAGE_TYPES.has(file.type)) throw new Error('Image must be JPEG, PNG, or GIF');
      if (file.bytes.length > ETSY_IMAGE_MAX_BYTES) throw new Error('Image is larger than 10 MB');
      const body = new FormData();
      body.append('image', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.filename);
      body.append('rank', String(image.rank ?? images.length + index + 1));
      body.append('overwrite', 'false');
      body.append('alt_text', marker);
      const response = await client.request('POST', `/application/shops/${client.shopId}/listings/${listingId}/images`, body);
      if (response.status >= 400) throw new Error(missingEtsyScope(response.status, response.text, 'listings_w') ?? errorText(response));
      images.push({ alt_text: marker, listing_image_id: asRecord(response.body).listing_image_id });
      fields.push(`add:${marker}`);
    } catch (error) {
      partialFailures.push(`add ${index + 1}: ${error instanceof Error ? error.message : 'Image upload failed'}`);
    }
  }

  if (imageIdChanges.size && associations.length) {
    const next = associations.map((item) => {
      const imageId = String(item.image_id ?? '');
      return {
        property_id: item.property_id,
        value_id: item.value_id,
        image_id: Number(imageIdChanges.get(imageId) ?? imageId),
      };
    });
    const saved = await client.request('POST', `/application/shops/${client.shopId}/listings/${listingId}/variation-images`, JSON.stringify({ variation_images: next }));
    if (saved.status >= 400) partialFailures.push(`variation images: ${missingEtsyScope(saved.status, saved.text, 'listings_w') ?? errorText(saved)}`);
    else fields.push('variationImages');
  }

  const after = await client.request('GET', `/application/listings/${listingId}/images`);
  const afterImages = after.status < 400 ? imageResults(after.body) : [];
  const afterIds = new Set(afterImages.map((image) => String(image.listing_image_id ?? '')));
  const mismatches: string[] = [];
  for (const id of beforeIds) {
    const replaced = (input.replace ?? []).some((item) => item.listingImageId === id);
    if (!replaced && !afterIds.has(id) && after.status < 400) mismatches.push(`image ${id} is missing`);
  }
  const state = String(owned.listing.state ?? '');
  return {
    ok: partialFailures.length === 0 && mismatches.length === 0,
    published: false,
    listingId,
    url: listingUrl(listingId, state),
    state,
    fieldsChanged: fields,
    verification: { status: after.status >= 400 ? 'not_run' : mismatches.length ? 'mismatch' : 'verified', mismatches },
    partialFailures: after.status >= 400 ? [...partialFailures, errorText(after)] : partialFailures,
    errors: [],
  };
}
