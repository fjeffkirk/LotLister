import { lookup } from 'dns/promises';
import { etsyErrorText } from './etsy-listing';
import { etsyApiKey, getValidEtsyAccessToken } from './etsy';
import {
  DraftResult,
  InventoryBody,
  ProductDraftInput,
  ProductImageInput,
  ShopDefaults,
  VariantInput,
  assertPublicImageUrl,
  buildInventoryBody,
  draftEditorUrl,
  failedDraft,
  listingUpdateForm,
  resolveProductDraft,
  ETSY_IMAGE_MAX_BYTES,
  ETSY_IMAGE_TYPES,
} from './etsy-product';

export interface EtsyDraftResponse {
  status: number;
  body: unknown;
  text: string;
}

export interface EtsyDraftClient {
  shopId: string;
  request(method: string, path: string, body?: URLSearchParams | string | FormData): Promise<EtsyDraftResponse>;
}

export interface RemoteImage {
  bytes: Buffer;
  type: string;
  filename: string;
}

type ImageLoader = (url: string) => Promise<RemoteImage>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function errorText(response: EtsyDraftResponse): string {
  return etsyErrorText(response.status, response.text || JSON.stringify(response.body ?? ''));
}

async function readListing(client: EtsyDraftClient, listingId: string): Promise<DraftResult | { listingId: string; title: string }> {
  const response = await client.request('GET', `/application/listings/${encodeURIComponent(listingId)}`);
  if (response.status >= 400) return failedDraft({ errors: [errorText(response)] });
  const body = asRecord(response.body);
  if (String(body.shop_id ?? '') !== client.shopId) {
    return failedDraft({ errors: ['That listing is not in the connected Etsy shop'] });
  }
  if (body.state !== 'draft') {
    return failedDraft({
      listingId,
      errors: [`That listing is ${String(body.state || 'not a draft')}. Only unpublished drafts can be changed.`],
    });
  }
  return { listingId: String(body.listing_id ?? listingId), title: String(body.title ?? '') };
}

function isFailure(value: DraftResult | { listingId: string }): value is DraftResult {
  return 'ok' in value;
}

async function findDraftBySku(client: EtsyDraftClient, sku: string): Promise<string | null> {
  const response = await client.request(
    'GET',
    `/application/shops/${client.shopId}/listings?state=draft&limit=100&includes=Inventory`
  );
  if (response.status >= 400) throw new Error(errorText(response));
  const results = asRecord(response.body).results;
  if (!Array.isArray(results)) return null;
  for (const listing of results) {
    const record = asRecord(listing);
    const products = asRecord(record.inventory).products;
    const skus = Array.isArray(products) ? products.map((product) => String(asRecord(product).sku ?? '')) : [];
    if (skus.includes(sku)) return String(record.listing_id ?? '');
  }
  return null;
}

async function putInventory(client: EtsyDraftClient, listingId: string, body: InventoryBody): Promise<string | null> {
  const response = await client.request(
    'PUT',
    `/application/listings/${listingId}/inventory`,
    JSON.stringify(body)
  );
  if (response.status >= 400) return errorText(response);
  return null;
}

async function applyInventory(
  client: EtsyDraftClient,
  listingId: string,
  sku: string | undefined,
  variations: VariantInput[],
  price: number,
  quantity: number,
  readinessStateId?: string
): Promise<string | null> {
  if (!sku && variations.length === 0) return null;
  const current = await client.request('GET', `/application/listings/${listingId}/inventory`);
  const existing = current.status < 400 && Array.isArray(asRecord(current.body).products)
    ? asRecord(current.body).products as never[]
    : [];
  const variants = variations.length
    ? variations
    : [{ sku, price, quantity, readinessStateId, options: [] }];
  return putInventory(client, listingId, buildInventoryBody(existing, variants, readinessStateId));
}

async function applyAttributes(client: EtsyDraftClient, listingId: string, attributes: ProductDraftInput['attributes']): Promise<string[]> {
  const incomplete: string[] = [];
  for (const attribute of attributes ?? []) {
    const form = new URLSearchParams();
    for (const id of attribute.valueIds) form.append('value_ids', String(id));
    for (const value of attribute.values) form.append('values', value);
    if (attribute.scaleId) form.set('scale_id', String(attribute.scaleId));
    const response = await client.request(
      'PUT',
      `/application/shops/${client.shopId}/listings/${listingId}/properties/${attribute.propertyId}`,
      form
    );
    if (response.status >= 400) incomplete.push(`attribute ${attribute.propertyId}: ${errorText(response)}`);
  }
  return incomplete;
}

async function applyImages(
  client: EtsyDraftClient,
  listingId: string,
  images: ProductImageInput[],
  loadImage: ImageLoader
): Promise<{ uploaded: number; incomplete: string[] }> {
  const incomplete: string[] = [];
  let uploaded = 0;
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const rank = image.rank ?? index + 1;
    try {
      const file = await loadImage(image.url);
      if (!ETSY_IMAGE_TYPES.has(file.type)) throw new Error('Image must be JPEG, PNG, or GIF');
      if (file.bytes.length > ETSY_IMAGE_MAX_BYTES) throw new Error('Image is larger than 10 MB');
      const body = new FormData();
      body.append('image', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.filename);
      body.append('rank', String(rank));
      const response = await client.request('POST', `/application/shops/${client.shopId}/listings/${listingId}/images`, body);
      if (response.status >= 400) throw new Error(errorText(response));
      uploaded += 1;
    } catch (error) {
      incomplete.push(`image ${rank}: ${error instanceof Error ? error.message : 'Image upload failed'}`);
    }
  }
  return { uploaded, incomplete };
}

export async function createProductDraft(
  client: EtsyDraftClient,
  input: ProductDraftInput,
  defaults?: ShopDefaults | null,
  loadImage?: ImageLoader
): Promise<DraftResult> {
  const resolved = resolveProductDraft(input, defaults);
  if (resolved.missing.length || resolved.errors.length) {
    return failedDraft({ missing: resolved.missing, errors: resolved.errors, reusedSettings: resolved.reusedSettings });
  }

  let listingId: string | null = null;
  let reused = false;
  if (resolved.sku) {
    try {
      listingId = await findDraftBySku(client, resolved.sku);
      reused = Boolean(listingId);
    } catch (error) {
      return failedDraft({
        errors: [error instanceof Error ? error.message : 'Could not check existing drafts'],
        reusedSettings: resolved.reusedSettings,
      });
    }
  }

  if (!listingId) {
    const created = await client.request('POST', `/application/shops/${client.shopId}/listings`, resolved.form);
    if (created.status >= 400) {
      return failedDraft({ errors: [errorText(created)], reusedSettings: resolved.reusedSettings });
    }
    const id = asRecord(created.body).listing_id;
    if (!id) return failedDraft({ errors: ['Etsy did not return a listing id'], reusedSettings: resolved.reusedSettings });
    listingId = String(id);
  }

  const incomplete: string[] = [];
  try {
    const inventoryError = await applyInventory(
      client,
      listingId,
      resolved.sku,
      resolved.variations,
      Number(input.price),
      Number(input.quantity),
      input.readinessStateId
    );
    if (inventoryError) incomplete.push(inventoryError);
  } catch (error) {
    incomplete.push(error instanceof Error ? error.message : 'Could not save variations');
  }
  incomplete.push(...await applyAttributes(client, listingId, resolved.attributes));
  let photosUploaded = 0;
  if (resolved.images.length) {
    if (!loadImage) incomplete.push('images: no image loader is configured');
    else {
      const images = await applyImages(client, listingId, resolved.images, loadImage);
      photosUploaded = images.uploaded;
      incomplete.push(...images.incomplete);
    }
  }

  return {
    ok: incomplete.length === 0,
    published: false,
    listingId,
    state: 'draft',
    editorUrl: draftEditorUrl(listingId),
    reused,
    missing: [],
    errors: [],
    incomplete,
    photosUploaded,
    reusedSettings: resolved.reusedSettings,
  };
}

export async function updateProductDraft(
  client: EtsyDraftClient,
  listingId: string,
  patch: ProductDraftInput & { state?: string; publish?: boolean }
): Promise<DraftResult> {
  if (patch.state || patch.publish) {
    return failedDraft({ listingId, errors: ['Publishing is not available. This connection can only update unpublished drafts.'] });
  }
  const owned = await readListing(client, listingId);
  if (isFailure(owned)) return owned;
  const { form, errors } = listingUpdateForm(patch);
  if (errors.length) return failedDraft({ listingId, errors });
  const response = await client.request('PATCH', `/application/shops/${client.shopId}/listings/${listingId}`, form);
  if (response.status >= 400) return failedDraft({ listingId, errors: [errorText(response)] });
  return {
    ok: true,
    published: false,
    listingId,
    state: 'draft',
    editorUrl: draftEditorUrl(listingId),
    reused: false,
    missing: [],
    errors: [],
    incomplete: [],
    photosUploaded: 0,
    reusedSettings: [],
  };
}

export async function uploadDraftImages(
  client: EtsyDraftClient,
  listingId: string,
  images: ProductImageInput[],
  loadImage: ImageLoader
): Promise<DraftResult> {
  const owned = await readListing(client, listingId);
  if (isFailure(owned)) return owned;
  if (!images.length) return failedDraft({ listingId, missing: ['images'] });
  const result = await applyImages(client, listingId, images, loadImage);
  return {
    ok: result.incomplete.length === 0,
    published: false,
    listingId,
    state: 'draft',
    editorUrl: draftEditorUrl(listingId),
    reused: false,
    missing: [],
    errors: [],
    incomplete: result.incomplete,
    photosUploaded: result.uploaded,
    reusedSettings: [],
  };
}

export async function updateDraftVariants(
  client: EtsyDraftClient,
  listingId: string,
  variations: VariantInput[]
): Promise<DraftResult> {
  const owned = await readListing(client, listingId);
  if (isFailure(owned)) return owned;
  if (!variations.length) return failedDraft({ listingId, missing: ['variations'] });
  try {
    const current = await client.request('GET', `/application/listings/${listingId}/inventory`);
    if (current.status >= 400) return failedDraft({ listingId, errors: [errorText(current)], incomplete: ['variations'] });
    const existing = Array.isArray(asRecord(current.body).products) ? asRecord(current.body).products as never[] : [];
    const body = buildInventoryBody(existing, variations);
    const failure = await putInventory(client, listingId, body);
    if (failure) return failedDraft({ listingId, errors: [failure], incomplete: ['variations'] });
    return {
      ok: true,
      published: false,
      listingId,
      state: 'draft',
      editorUrl: draftEditorUrl(listingId),
      reused: false,
      missing: [],
      errors: [],
      incomplete: [],
      photosUploaded: 0,
      reusedSettings: [],
    };
  } catch (error) {
    return failedDraft({
      listingId,
      errors: [error instanceof Error ? error.message : 'Could not update variations'],
      incomplete: ['variations'],
    });
  }
}

export async function getProductDrafts(client: EtsyDraftClient, listingId?: string): Promise<DraftResult | Record<string, unknown>> {
  if (listingId) {
    const owned = await readListing(client, listingId);
    if (isFailure(owned)) return owned;
    const [listing, inventory] = await Promise.all([
      client.request('GET', `/application/listings/${listingId}`),
      client.request('GET', `/application/listings/${listingId}/inventory`),
    ]);
    const body = asRecord(listing.body);
    return {
      ok: true,
      published: false,
      listingId,
      state: 'draft',
      title: body.title ?? null,
      editorUrl: draftEditorUrl(listingId),
      inventory: inventory.status < 400 ? inventory.body : null,
      inventoryError: inventory.status >= 400 ? errorText(inventory) : null,
    };
  }
  const response = await client.request('GET', `/application/shops/${client.shopId}/listings?state=draft&limit=100`);
  if (response.status >= 400) return failedDraft({ errors: [errorText(response)] });
  const results = Array.isArray(asRecord(response.body).results) ? asRecord(response.body).results as Record<string, unknown>[] : [];
  return {
    ok: true,
    published: false,
    drafts: results.map((listing) => ({
      listingId: String(listing.listing_id ?? ''),
      title: listing.title ?? null,
      state: listing.state ?? 'draft',
      editorUrl: listing.listing_id ? draftEditorUrl(String(listing.listing_id)) : null,
    })),
  };
}

export async function liveDraftClient(userEmail: string): Promise<EtsyDraftClient> {
  const session = await getValidEtsyAccessToken(userEmail);
  return {
    shopId: session.shopId,
    async request(method, path, body) {
      const headers: Record<string, string> = {
        'x-api-key': etsyApiKey(session.creds),
        Authorization: `Bearer ${session.accessToken}`,
      };
      let payload: BodyInit | undefined;
      if (body instanceof URLSearchParams) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        payload = body;
      } else if (typeof body === 'string') {
        headers['Content-Type'] = 'application/json';
        payload = body;
      } else if (body) {
        payload = body;
      }
      const response = await fetch(`https://api.etsy.com/v3${path}`, { method, headers, body: payload, cache: 'no-store' });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed, text };
    },
  };
}

async function publicLookup(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
}

export async function loadRemoteImage(raw: string): Promise<RemoteImage> {
  let current = await assertPublicImageUrl(raw, publicLookup);
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetch(current, { redirect: 'manual', cache: 'no-store' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Image URL redirect had no destination');
      current = await assertPublicImageUrl(new URL(location, current).toString(), publicLookup);
      continue;
    }
    if (!response.ok) throw new Error(`Image download failed (${response.status})`);
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ETSY_IMAGE_TYPES.has(type)) throw new Error('Image must be JPEG, PNG, or GIF');
    const announced = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(announced) && announced > ETSY_IMAGE_MAX_BYTES) throw new Error('Image is larger than 10 MB');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > ETSY_IMAGE_MAX_BYTES) throw new Error('Image is larger than 10 MB');
    return { bytes, type, filename: current.pathname.split('/').pop() || 'image.jpg' };
  }
  throw new Error('Image URL redirected too many times');
}
