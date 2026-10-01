import { etsyTags, etsyTitle } from './etsy-listing';

/** Enums from Etsy's createDraftListing schema. */
export const ETSY_WHO_MADE = ['i_did', 'someone_else', 'collective'] as const;
export const ETSY_WHEN_MADE = [
  'made_to_order',
  '2020_2026',
  '2010_2019',
  '2007_2009',
  'before_2007',
  '2000_2006',
  '1990s',
  '1980s',
  '1970s',
  '1960s',
  '1950s',
  '1940s',
  '1930s',
  '1920s',
  '1910s',
  '1900s',
  '1800s',
  '1700s',
  'before_1700',
] as const;
export const ETSY_WEIGHT_UNITS = ['oz', 'lb', 'g', 'kg'] as const;
export const ETSY_DIMENSION_UNITS = ['in', 'ft', 'mm', 'cm', 'm', 'yd', 'inches'] as const;

/** Etsy custom variation property ids from the listings tutorial. */
export const ETSY_CUSTOM_PROPERTY_IDS = [513, 514, 516] as const;

export const ETSY_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif']);
/** Safety cap before the bytes are sent to Etsy. JPEG, PNG, and GIF are the types the image upload accepts. */
export const ETSY_IMAGE_MAX_BYTES = 10_000_000;
export const ETSY_MAX_IMAGES = 20;

const MATERIAL_PATTERN = /[^\p{L}\p{Nd}\p{Zs}]/u;

export interface ShopDefaults {
  shippingProfileId?: string | null;
  readinessStateId?: string | null;
  returnPolicyId?: string | null;
  taxonomyId?: number | null;
}

export interface ProductAttribute {
  propertyId: number;
  valueIds: number[];
  values: string[];
  scaleId?: number;
}

export interface VariantOption {
  propertyId?: number;
  name?: string;
  value: string;
  valueId?: number;
}

export interface VariantInput {
  sku?: string;
  price: number;
  quantity: number;
  readinessStateId?: string;
  options: VariantOption[];
}

export interface ProductImageInput {
  url: string;
  rank?: number;
}

export interface ProductDraftInput {
  title?: string;
  description?: string;
  price?: number;
  quantity?: number;
  sku?: string;
  taxonomyId?: number;
  whoMade?: string;
  whenMade?: string;
  isSupply?: boolean;
  tags?: string[];
  materials?: string[];
  shippingProfileId?: string;
  readinessStateId?: string;
  returnPolicyId?: string;
  useShopDefaults?: boolean;
  itemWeight?: number;
  itemWeightUnit?: string;
  itemLength?: number;
  itemWidth?: number;
  itemHeight?: number;
  itemDimensionsUnit?: string;
  productionPartnerIds?: number[];
  attributes?: ProductAttribute[];
  variations?: VariantInput[];
  images?: ProductImageInput[];
}

export interface ResolvedDraft {
  form: URLSearchParams;
  sku?: string;
  variations: VariantInput[];
  attributes: ProductAttribute[];
  images: ProductImageInput[];
  reusedSettings: string[];
  missing: string[];
  errors: string[];
}

export interface DraftResult {
  ok: boolean;
  published: false;
  listingId: string | null;
  state: 'draft' | null;
  editorUrl: string | null;
  reused: boolean;
  missing: string[];
  errors: string[];
  incomplete: string[];
  photosUploaded: number;
  reusedSettings: string[];
}

export function draftEditorUrl(listingId: string): string {
  return `https://www.etsy.com/your/shops/me/listing-editor/edit/${listingId}`;
}

export function failedDraft(partial: Partial<DraftResult> & { errors?: string[]; missing?: string[] }): DraftResult {
  return {
    ok: false,
    published: false,
    listingId: partial.listingId ?? null,
    state: partial.listingId ? 'draft' : null,
    editorUrl: partial.listingId ? draftEditorUrl(partial.listingId) : null,
    reused: partial.reused ?? false,
    missing: partial.missing ?? [],
    errors: partial.errors ?? [],
    incomplete: partial.incomplete ?? [],
    photosUploaded: partial.photosUploaded ?? 0,
    reusedSettings: partial.reusedSettings ?? [],
  };
}

function cleanMaterials(values: string[] | undefined, errors: string[]): string[] {
  if (!values?.length) return [];
  const materials: string[] = [];
  for (const raw of values) {
    const material = raw.trim().replace(/\s+/g, ' ');
    if (!material) continue;
    if (MATERIAL_PATTERN.test(material)) {
      errors.push(`Material "${material}" can only contain letters, numbers, and spaces`);
      continue;
    }
    if (materials.some((existing) => existing.toLowerCase() === material.toLowerCase())) continue;
    materials.push(material);
    if (materials.length === 13) break;
  }
  return materials;
}

export function resolveProductDraft(input: ProductDraftInput, defaults?: ShopDefaults | null): ResolvedDraft {
  const errors: string[] = [];
  const missing: string[] = [];
  const reusedSettings: string[] = [];
  const useDefaults = input.useShopDefaults === true;

  const title = input.title?.trim() ? etsyTitle(input.title) : '';
  const description = input.description?.trim() ?? '';
  const price = Number(input.price);
  const quantity = Number(input.quantity);
  if (!title) missing.push('title');
  if (!description) missing.push('description');
  if (!Number.isFinite(price) || price <= 0) missing.push('price');
  if (!Number.isInteger(quantity) || quantity <= 0) missing.push('quantity');
  for (const symbol of ['%', ':', '&', '+']) {
    if (title.split(symbol).length > 2) errors.push(`Title can use "${symbol}" only once`);
  }

  const whoMade = input.whoMade?.trim() ?? '';
  const whenMade = input.whenMade?.trim() ?? '';
  if (!whoMade) missing.push('whoMade');
  else if (!ETSY_WHO_MADE.includes(whoMade as (typeof ETSY_WHO_MADE)[number])) errors.push('whoMade must be i_did, someone_else, or collective');
  if (!whenMade) missing.push('whenMade');
  else if (!ETSY_WHEN_MADE.includes(whenMade as (typeof ETSY_WHEN_MADE)[number])) errors.push('whenMade is not one of the eras Etsy accepts');

  let taxonomyId = input.taxonomyId;
  let shippingProfileId = input.shippingProfileId?.trim() || '';
  let readinessStateId = input.readinessStateId?.trim() || '';
  let returnPolicyId = input.returnPolicyId?.trim() || '';
  if (useDefaults && defaults) {
    if (!taxonomyId && defaults.taxonomyId) {
      taxonomyId = defaults.taxonomyId;
      reusedSettings.push('taxonomyId');
    }
    if (!shippingProfileId && defaults.shippingProfileId) {
      shippingProfileId = defaults.shippingProfileId;
      reusedSettings.push('shippingProfileId');
    }
    if (!readinessStateId && defaults.readinessStateId) {
      readinessStateId = defaults.readinessStateId;
      reusedSettings.push('readinessStateId');
    }
    if (!returnPolicyId && defaults.returnPolicyId) {
      returnPolicyId = defaults.returnPolicyId;
      reusedSettings.push('returnPolicyId');
    }
  }
  if (!taxonomyId) missing.push('taxonomyId');
  if (!shippingProfileId) missing.push('shippingProfileId');
  if (!readinessStateId) missing.push('readinessStateId');

  if (input.itemWeightUnit && !ETSY_WEIGHT_UNITS.includes(input.itemWeightUnit as (typeof ETSY_WEIGHT_UNITS)[number])) {
    errors.push('itemWeightUnit must be oz, lb, g, or kg');
  }
  if (input.itemDimensionsUnit && !ETSY_DIMENSION_UNITS.includes(input.itemDimensionsUnit as (typeof ETSY_DIMENSION_UNITS)[number])) {
    errors.push('itemDimensionsUnit is not one of the units Etsy accepts');
  }
  if (whoMade === 'someone_else' && !input.productionPartnerIds?.length) {
    missing.push('productionPartnerIds');
  }

  const variations = input.variations ?? [];
  const variationError = variations.length ? variationLimitError(variations) : null;
  if (variationError) errors.push(variationError);
  const listingQuantity = variations.length
    ? variations.reduce((sum, variant) => sum + (Number.isInteger(variant.quantity) && variant.quantity > 0 ? variant.quantity : 0), 0)
    : quantity;

  const form = new URLSearchParams();
  if (title) form.set('title', title);
  if (description) form.set('description', description);
  if (Number.isFinite(price) && price > 0) form.set('price', price.toFixed(2));
  if (listingQuantity > 0) form.set('quantity', String(listingQuantity));
  if (whoMade && ETSY_WHO_MADE.includes(whoMade as (typeof ETSY_WHO_MADE)[number])) form.set('who_made', whoMade);
  if (whenMade && ETSY_WHEN_MADE.includes(whenMade as (typeof ETSY_WHEN_MADE)[number])) form.set('when_made', whenMade);
  if (taxonomyId) form.set('taxonomy_id', String(taxonomyId));
  form.set('type', 'physical');
  form.set('is_supply', input.isSupply ? 'true' : 'false');
  form.set('should_auto_renew', 'false');
  if (shippingProfileId) form.set('shipping_profile_id', shippingProfileId);
  if (readinessStateId) form.set('readiness_state_id', readinessStateId);
  if (returnPolicyId) form.set('return_policy_id', returnPolicyId);
  const tags = etsyTags(input.tags ?? []);
  if (tags.length) form.set('tags', tags.join(','));
  const materials = cleanMaterials(input.materials, errors);
  if (materials.length) form.set('materials', materials.join(','));
  if (input.itemWeight && input.itemWeight > 0 && input.itemWeightUnit) {
    form.set('item_weight', String(input.itemWeight));
    form.set('item_weight_unit', input.itemWeightUnit);
  }
  if (
    input.itemLength && input.itemLength > 0
    && input.itemWidth && input.itemWidth > 0
    && input.itemHeight && input.itemHeight > 0
    && input.itemDimensionsUnit
  ) {
    form.set('item_length', String(input.itemLength));
    form.set('item_width', String(input.itemWidth));
    form.set('item_height', String(input.itemHeight));
    form.set('item_dimensions_unit', input.itemDimensionsUnit);
  }
  if (input.productionPartnerIds?.length) form.set('production_partner_ids', input.productionPartnerIds.join(','));

  return {
    form,
    sku: input.sku?.trim() || undefined,
    variations,
    attributes: input.attributes ?? [],
    images: (input.images ?? []).slice(0, ETSY_MAX_IMAGES),
    reusedSettings,
    missing,
    errors,
  };
}

export function listingUpdateForm(patch: ProductDraftInput): { form: URLSearchParams; errors: string[] } {
  const errors: string[] = [];
  const form = new URLSearchParams();
  if ('state' in patch || 'publish' in (patch as object)) errors.push('Publishing is not available');
  if (patch.title?.trim()) {
    const title = etsyTitle(patch.title);
    for (const symbol of ['%', ':', '&', '+']) {
      if (title.split(symbol).length > 2) errors.push(`Title can use "${symbol}" only once`);
    }
    form.set('title', title);
  }
  if (patch.description?.trim()) form.set('description', patch.description.trim());
  if (patch.price != null) {
    if (!Number.isFinite(patch.price) || patch.price <= 0) errors.push('price must be greater than 0');
    else form.set('price', patch.price.toFixed(2));
  }
  if (patch.quantity != null) {
    if (!Number.isInteger(patch.quantity) || patch.quantity <= 0) errors.push('quantity must be a positive whole number');
    else form.set('quantity', String(patch.quantity));
  }
  if (patch.whoMade) {
    if (!ETSY_WHO_MADE.includes(patch.whoMade as (typeof ETSY_WHO_MADE)[number])) errors.push('whoMade must be i_did, someone_else, or collective');
    else form.set('who_made', patch.whoMade);
  }
  if (patch.whenMade) {
    if (!ETSY_WHEN_MADE.includes(patch.whenMade as (typeof ETSY_WHEN_MADE)[number])) errors.push('whenMade is not one of the eras Etsy accepts');
    else form.set('when_made', patch.whenMade);
  }
  if (patch.taxonomyId) form.set('taxonomy_id', String(patch.taxonomyId));
  if (patch.shippingProfileId) form.set('shipping_profile_id', patch.shippingProfileId);
  if (patch.readinessStateId) form.set('readiness_state_id', patch.readinessStateId);
  if (patch.returnPolicyId) form.set('return_policy_id', patch.returnPolicyId);
  if (patch.isSupply != null) form.set('is_supply', patch.isSupply ? 'true' : 'false');
  if (patch.tags) {
    const tags = etsyTags(patch.tags);
    if (tags.length) form.set('tags', tags.join(','));
  }
  if (patch.materials) {
    const materials = cleanMaterials(patch.materials, errors);
    if (materials.length) form.set('materials', materials.join(','));
  }
  form.set('should_auto_renew', 'false');
  if ([...form.keys()].every((key) => key === 'should_auto_renew')) errors.push('No listing fields were provided to update');
  return { form, errors };
}

interface InventoryProduct {
  sku?: string;
  property_values?: { property_id?: number; property_name?: string; values?: string[]; value_ids?: number[] }[];
  offerings?: { quantity?: number; price?: number | { amount?: number; divisor?: number }; is_enabled?: boolean; readiness_state_id?: number }[];
}

export interface InventoryBody {
  products: {
    sku: string;
    property_values: { property_id: number; property_name: string; values: string[]; value_ids: number[] }[];
    offerings: { quantity: number; is_enabled: true; price: number; readiness_state_id?: number }[];
  }[];
  price_on_property: number[];
  quantity_on_property: number[];
  sku_on_property: number[];
  readiness_state_on_property: number[];
  max_variations_supported?: number;
}

function optionKey(options: { propertyId: number; value: string }[]): string {
  return options
    .map((option) => `${option.propertyId}:${option.value.trim().toLowerCase()}`)
    .sort()
    .join('|');
}

function assignPropertyIds(variants: VariantInput[]): VariantInput[] {
  const names = new Map<string, number>();
  let customIndex = 0;
  return variants.map((variant) => ({
    ...variant,
    options: variant.options.map((option) => {
      if (option.propertyId) return option;
      const name = option.name?.trim();
      if (!name) return option;
      const known = names.get(name.toLowerCase());
      if (known) return { ...option, propertyId: known };
      const id = ETSY_CUSTOM_PROPERTY_IDS[customIndex];
      customIndex += 1;
      if (!id) return option;
      names.set(name.toLowerCase(), id);
      return { ...option, propertyId: id };
    }),
  }));
}

export function variationLimitError(variants: VariantInput[]): string | null {
  const customNames = new Set<string>();
  for (const variant of variants) {
    for (const option of variant.options) {
      if (!option.propertyId && !option.name?.trim()) return 'Each variation needs a taxonomy propertyId or a custom name.';
      if (!option.propertyId && option.name?.trim()) customNames.add(option.name.trim().toLowerCase());
    }
    if (!Number.isFinite(variant.price) || variant.price <= 0 || !Number.isInteger(variant.quantity) || variant.quantity <= 0) {
      return 'Each variation needs a price above 0 and a positive whole-number quantity';
    }
  }
  if (customNames.size > ETSY_CUSTOM_PROPERTY_IDS.length) return 'Etsy allows at most 3 custom variations.';
  const assigned = assignPropertyIds(variants);
  const propertyIds = [...new Set(assigned.flatMap((variant) => variant.options.map((option) => option.propertyId).filter((id): id is number => Boolean(id))))];
  const count = assigned.length;
  if (propertyIds.length > 3) return 'Etsy allows at most 3 variation properties';
  if (propertyIds.length === 0 && count > 1) return 'A listing without variation properties can only have one product';
  if (propertyIds.length === 1 && count > 70) return 'Etsy allows at most 70 products when a listing has one variation';
  if (propertyIds.length === 2 && count > 4900) return 'Etsy allows at most 4900 products when a listing has two variations';
  if (propertyIds.length === 3 && count > 2500) return 'Etsy allows at most 2500 products when a listing has three variations';
  return null;
}

function offeringPrice(offering: NonNullable<InventoryProduct['offerings']>[number] | undefined): number {
  if (!offering) return 0;
  if (typeof offering.price === 'number') return offering.price;
  const amount = Number(offering.price?.amount);
  const divisor = Number(offering.price?.divisor);
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor === 0) return 0;
  return amount / divisor;
}

function productOptions(product: InventoryProduct): { propertyId: number; value: string }[] {
  return (product.property_values ?? []).flatMap((property) => {
    if (!property.property_id) return [];
    return [{ propertyId: property.property_id, value: property.values?.[0] ?? '' }];
  });
}

function controlsProperty(products: InventoryBody['products'], read: (product: InventoryBody['products'][number]) => string): number[] {
  const propertyIds = [...new Set(products.flatMap((product) => product.property_values.map((property) => property.property_id)))];
  if (propertyIds.length === 0) return [];
  if (new Set(products.map(read)).size <= 1) return [];
  for (const id of propertyIds) {
    const groups = new Map<string, Set<string>>();
    for (const product of products) {
      const value = product.property_values.find((property) => property.property_id === id)?.values[0] ?? '';
      const bucket = groups.get(value) ?? new Set<string>();
      bucket.add(read(product));
      groups.set(value, bucket);
    }
    if ([...groups.values()].every((bucket) => bucket.size === 1)) return [id];
  }
  return propertyIds;
}

export function buildInventoryBody(
  existing: InventoryProduct[],
  variants: VariantInput[],
  fallbackReadinessId?: string
): InventoryBody {
  const limit = variationLimitError(variants);
  if (limit) throw new Error(limit);
  const assigned = assignPropertyIds(variants);

  const kept = existing.map((product) => {
    const offering = product.offerings?.[0];
    const readiness = offering?.readiness_state_id;
    return {
      sku: product.sku ?? '',
      property_values: (product.property_values ?? []).flatMap((property) => {
        if (!property.property_id) return [];
        return [{
          property_id: property.property_id,
          property_name: property.property_name ?? '',
          values: property.values ?? [],
          value_ids: property.value_ids ?? [],
        }];
      }),
      offerings: [{
        quantity: offering?.quantity ?? 1,
        is_enabled: true as const,
        price: offeringPrice(offering),
        ...(readiness ? { readiness_state_id: readiness } : {}),
      }],
    };
  });

  for (const variant of assigned) {
    const options = variant.options.map((option) => ({
      propertyId: option.propertyId!,
      value: option.value.trim(),
    }));
    const key = optionKey(options);
    const sku = variant.sku?.trim() ?? '';
    const readiness = variant.readinessStateId || fallbackReadinessId;
    const next = {
      sku,
      property_values: variant.options.map((option) => ({
        property_id: option.propertyId!,
        property_name: option.name?.trim() || '',
        values: [option.value.trim()],
        value_ids: option.valueId ? [option.valueId] : [],
      })),
      offerings: [{
        quantity: variant.quantity,
        is_enabled: true as const,
        price: Number(variant.price.toFixed(2)),
        ...(readiness ? { readiness_state_id: Number(readiness) } : {}),
      }],
    };
    const index = kept.findIndex((product) => {
      if (sku && product.sku === sku) return true;
      return optionKey(product.property_values.map((property) => ({ propertyId: property.property_id, value: property.values[0] ?? '' }))) === key;
    });
    if (index >= 0) kept[index] = next;
    else kept.push(next);
  }

  const products = kept.filter((product) => product.offerings[0].price > 0);
  const propertyCount = new Set(products.flatMap((product) => product.property_values.map((property) => property.property_id))).size;
  const priceOn = controlsProperty(products, (product) => String(product.offerings[0].price));
  const quantityOn = controlsProperty(products, (product) => String(product.offerings[0].quantity));
  const skuOn = controlsProperty(products, (product) => product.sku);
  const readinessOn = controlsProperty(products, (product) => String(product.offerings[0].readiness_state_id ?? ''));
  if (propertyCount > 2 && [priceOn, quantityOn, skuOn, readinessOn].some((ids) => ids.length === propertyCount) && products.length > 400) {
    throw new Error('Etsy allows at most 400 products when price, quantity, or SKU varies by every property on a 3-variation listing');
  }
  return {
    products,
    price_on_property: priceOn,
    quantity_on_property: quantityOn,
    sku_on_property: skuOn,
    readiness_state_on_property: readinessOn,
    ...(propertyCount === 3 ? { max_variations_supported: 3 } : {}),
  };
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]) >>> 0;
}

export function isPrivateAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes(':')) {
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
    const head = host.split(':')[0];
    if (head.startsWith('fc') || head.startsWith('fd') || head === 'fe80' || head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) return true;
  }
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const value = ipv4ToInt(mapped?.[1] ?? host);
  if (value == null) return false;
  const inRange = (start: number, mask: number) => (value & mask) === (start & mask);
  return (
    inRange(0x00000000, 0xff000000)
    || inRange(0x0a000000, 0xff000000)
    || inRange(0x7f000000, 0xff000000)
    || inRange(0xa9fe0000, 0xffff0000)
    || inRange(0xac100000, 0xfff00000)
    || inRange(0xc0a80000, 0xffff0000)
    || inRange(0x64400000, 0xffc00000)
  );
}

export async function assertPublicImageUrl(raw: string, lookup: (host: string) => Promise<string[]>): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Image URL is not valid');
  }
  if (url.protocol !== 'https:') throw new Error('Image URLs must use https');
  if (url.username || url.password) throw new Error('Image URLs cannot include a username or password');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') {
    throw new Error('Image URL points at a private address');
  }
  const literal = host.replace(/^\[|\]$/g, '');
  if (isPrivateAddress(literal)) throw new Error('Image URL points at a private address');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(literal) && !literal.includes(':')) {
    const addresses = await lookup(host);
    if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address))) {
      throw new Error('Image URL points at a private address');
    }
  }
  return url;
}
