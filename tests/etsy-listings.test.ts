import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import type { EtsyDraftClient, EtsyDraftResponse } from '../lib/etsy-drafts';
import { updateDraftVariants, updateProductDraft } from '../lib/etsy-drafts';
import {
  getShopListing,
  listShopListings,
  missingEtsyScope,
  updateShopListing,
  updateShopListingImages,
  updateShopListingVariants,
} from '../lib/etsy-listings';

function json(body: unknown, status = 200): EtsyDraftResponse {
  return { status, body, text: JSON.stringify(body) };
}

const png = async () => ({ bytes: Buffer.from('png'), type: 'image/png', filename: 'photo.png' });

function shopClient(handler: (method: string, path: string, body: unknown, calls: { method: string; path: string; body?: unknown }[]) => EtsyDraftResponse) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client: EtsyDraftClient = {
    shopId: '10',
    async request(method, path, body) {
      calls.push({ method, path, body });
      return handler(method, path, body, calls);
    },
  };
  return { client, calls };
}

describe('existing Etsy listings', () => {
  it('edits an active title and leaves state, images, and inventory alone', async () => {
    let reads = 0;
    const { client, calls } = shopClient((method, path) => {
      if (method === 'GET' && path === '/application/listings/555') {
        reads += 1;
        return json({
          listing_id: 555,
          shop_id: 10,
          state: 'active',
          title: reads === 1 ? 'Old title' : 'New title',
          description: 'Keep me',
          updated_timestamp: 100,
        });
      }
      return json({});
    });
    const result = await updateShopListing(client, '555', { title: 'New title' });
    expect(result).toMatchObject({
      ok: true,
      published: false,
      listingId: '555',
      state: 'active',
      url: 'https://www.etsy.com/listing/555',
      verification: { status: 'verified', mismatches: [] },
    });
    expect(result.fieldsChanged).toEqual(['title']);
    const patched = calls.find((call) => call.method === 'PATCH');
    const form = patched?.body as URLSearchParams;
    expect(form.get('title')).toBe('New title');
    expect(form.get('state')).toBeNull();
    expect(form.get('should_auto_renew')).toBeNull();
    expect(form.get('description')).toBeNull();
    expect(calls.some((call) => call.path.includes('/inventory') || call.path.includes('/images'))).toBe(false);
  });

  it('updates one variant and keeps the other in the inventory payload', async () => {
    const products = [
      {
        sku: 'BLACK',
        property_values: [{ property_id: 513, property_name: 'Color', values: ['Black'], value_ids: [1] }],
        offerings: [{ quantity: 2, price: { amount: 1200, divisor: 100 }, is_enabled: true }],
      },
      {
        sku: 'WHITE',
        property_values: [{ property_id: 513, property_name: 'Color', values: ['White'], value_ids: [2] }],
        offerings: [{ quantity: 4, price: { amount: 1500, divisor: 100 }, is_enabled: true }],
      },
    ];
    let savedInventory = false;
    const { client, calls } = shopClient((method, path) => {
      if (method === 'GET' && path === '/application/listings/555') return json({ listing_id: 555, shop_id: 10, state: 'active', updated_timestamp: 5 });
      if (method === 'PUT' && path.endsWith('/inventory')) {
        savedInventory = true;
        return json({ products: [] });
      }
      if (path.endsWith('/inventory')) {
        return json({
          products: savedInventory
            ? products.map((product) => product.sku === 'WHITE'
              ? { ...product, offerings: [{ quantity: 4, price: 18, is_enabled: true }] }
              : product)
            : products,
        });
      }
      return json({});
    });
    const result = await updateShopListingVariants(client, '555', [{
      sku: 'WHITE',
      price: 18,
      quantity: 4,
      options: [{ propertyId: 513, name: 'Color', value: 'White' }],
    }]);
    expect(result.verification.status).toBe('verified');
    expect(result.state).toBe('active');
    const saved = calls.find((call) => call.method === 'PUT' && call.path.endsWith('/inventory'));
    const body = JSON.parse(String(saved?.body)) as { products: { sku: string; offerings: { price: number; quantity: number }[] }[] };
    expect(body.products.map((product) => product.sku).sort()).toEqual(['BLACK', 'WHITE']);
    expect(body.products.find((product) => product.sku === 'BLACK')?.offerings[0]).toMatchObject({ price: 12, quantity: 2 });
    expect(body.products.find((product) => product.sku === 'WHITE')?.offerings[0].price).toBe(18);
    expect(JSON.stringify(body)).not.toContain('"state"');
  });

  it('replaces one image without deleting the others', async () => {
    const images = {
      results: [
        { listing_image_id: 1, rank: 1, alt_text: 'front' },
        { listing_image_id: 2, rank: 2, alt_text: 'back' },
      ],
    };
    const { client, calls } = shopClient((method, path) => {
      if (method === 'GET' && path === '/application/listings/555') return json({ listing_id: 555, shop_id: 10, state: 'active' });
      if (path.endsWith('/variation-images')) return json({ results: [{ property_id: 513, value_id: 2, image_id: 2 }] });
      if (method === 'GET' && path.endsWith('/images')) return json(images);
      if (method === 'POST' && path.endsWith('/images')) return json({ listing_image_id: 9 }, 201);
      if (method === 'POST' && path.endsWith('/variation-images')) return json({ results: [] });
      return json({});
    });
    const result = await updateShopListingImages(client, '555', {
      replace: [{ listingImageId: '1', url: 'https://cdn.example.com/new.png' }],
    }, png);
    expect(result.verification.status).toBe('verified');
    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    const upload = calls.find((call) => call.method === 'POST' && call.path.endsWith('/images'));
    const form = upload?.body as FormData;
    expect(form.get('overwrite')).toBe('true');
    expect(form.get('rank')).toBe('1');
    expect(form.get('listing_image_id')).toBeNull();
    const links = calls.find((call) => call.path.endsWith('/variation-images') && call.method === 'POST');
    expect(JSON.parse(String(links?.body)).variation_images).toEqual([{ property_id: 513, value_id: 2, image_id: 2 }]);
  });

  it('keeps the existing image when a replacement upload fails', async () => {
    const images = { results: [{ listing_image_id: 1, rank: 1 }, { listing_image_id: 2, rank: 2 }] };
    const { client, calls } = shopClient((method, path) => {
      if (method === 'GET' && path === '/application/listings/555') return json({ listing_id: 555, shop_id: 10, state: 'inactive' });
      if (path.endsWith('/variation-images')) return json({ results: [] });
      if (path.endsWith('/images') && method === 'GET') return json(images);
      if (method === 'POST') return json({ error: 'upload failed' }, 500);
      return json({});
    });
    const result = await updateShopListingImages(client, '555', {
      replace: [{ listingImageId: '1', url: 'https://cdn.example.com/new.png' }],
    }, png);
    expect(result.ok).toBe(false);
    expect(result.partialFailures[0]).toMatch(/upload failed/);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    expect(result.state).toBe('inactive');
  });

  it('does not upload the same image again on retry', async () => {
    const marker = `lotlister-src:${createHash('sha256').update('https://cdn.example.com/same.png').digest('hex').slice(0, 32)}`;
    const { client, calls } = shopClient((method, path) => {
      if (method === 'GET' && path === '/application/listings/555') return json({ listing_id: 555, shop_id: 10, state: 'active' });
      if (path.endsWith('/variation-images')) return json({ results: [] });
      if (path.endsWith('/images')) return json({ results: [{ listing_image_id: 3, rank: 2, alt_text: marker }] });
      return json({});
    });
    const result = await updateShopListingImages(client, '555', {
      add: [{ url: 'https://cdn.example.com/same.png' }],
    }, png);
    expect(result.fieldsChanged[0]).toContain('add:existing:');
    expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/images'))).toBe(false);
  });

  it('edits an inactive listing without activating it', async () => {
    let reads = 0;
    const { client, calls } = shopClient((method, path) => {
      if (method === 'GET' && path === '/application/listings/555') {
        reads += 1;
        return json({
          listing_id: 555,
          shop_id: 10,
          state: 'inactive',
          title: reads === 1 ? 'Old' : 'Stored',
          description: 'Same',
          updated_timestamp: 3,
        });
      }
      if (method === 'PATCH') return json({ listing_id: 555, state: 'inactive', title: 'Stored' });
      return json({});
    });
    const result = await updateShopListing(client, '555', { title: 'Stored' });
    expect(result.state).toBe('inactive');
    expect(result.verification.status).toBe('verified');
    expect((calls.find((call) => call.method === 'PATCH')?.body as URLSearchParams).get('state')).toBeNull();
  });

  it('refuses a listing from another shop and a missing scope', async () => {
    const other = shopClient(() => json({ listing_id: 555, shop_id: 99, state: 'active' }));
    const denied = await getShopListing(other.client, '555');
    expect(denied).toMatchObject({ ok: false });
    expect((denied.errors as string[])[0]).toMatch(/not in the connected Etsy shop/);
    expect(other.calls.some((call) => call.method === 'PATCH')).toBe(false);

    const scoped = shopClient(() => json({ error: 'insufficient_scope' }, 403));
    const missing = await listShopListings(scoped.client, { state: 'active' });
    expect((missing.errors as string[])[0]).toMatch(/listings_r/);
    expect(missingEtsyScope(403, 'insufficient_scope', 'listings_w')).toMatch(/listings_w/);
  });

  it('does not write when the listing changed since it was read', async () => {
    const { client, calls } = shopClient(() => json({
      listing_id: 555,
      shop_id: 10,
      state: 'active',
      title: 'Current',
      updated_timestamp: 50,
    }));
    const result = await updateShopListing(client, '555', { title: 'Newer', expectedUpdatedTimestamp: 40 });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/changed since it was read/);
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('pages shop listings', async () => {
    const { client } = shopClient(() => json({
      count: 40,
      results: [{ listing_id: 1, shop_id: 10, state: 'active', title: 'Walnut stand', tags: ['wood'] }],
    }));
    const page = await listShopListings(client, { state: 'active', query: 'walnut', limit: 25, offset: 0 });
    expect(page).toMatchObject({ ok: true, nextOffset: 25, count: 40 });
    expect(page.listings).toEqual([expect.objectContaining({ listingId: '1' })]);
  });

  it('still refuses draft tools on an active listing', async () => {
    const { client, calls } = shopClient(() => json({ listing_id: 555, shop_id: 10, state: 'active', title: 'Live' }));
    const variants = await updateDraftVariants(client, '555', [{
      sku: 'ONE',
      price: 10,
      quantity: 1,
      options: [{ propertyId: 513, value: 'Oak' }],
    }]);
    const draft = await updateProductDraft(client, '555', { title: 'Nope' });
    expect(variants.ok).toBe(false);
    expect(draft.ok).toBe(false);
    expect(calls.some((call) => call.method === 'PUT' || call.method === 'PATCH')).toBe(false);
  });
});
