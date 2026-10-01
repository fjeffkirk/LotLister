import { describe, expect, it } from 'vitest';
import type { EtsyDraftClient, EtsyDraftResponse } from '../lib/etsy-drafts';
import { createProductDraft, updateDraftVariants, updateProductDraft, uploadDraftImages } from '../lib/etsy-drafts';
import { assertPublicImageUrl, buildInventoryBody, isPrivateAddress } from '../lib/etsy-product';

const ready = {
  title: 'Walnut card caddy',
  description: 'A 3D-printed card caddy.',
  price: 24,
  quantity: 3,
  sku: 'CADDY-WALNUT',
  taxonomyId: 1234,
  whoMade: 'i_did' as const,
  whenMade: 'made_to_order' as const,
  shippingProfileId: '55',
  readinessStateId: '66',
  materials: ['PLA'],
};

function json(body: unknown, status = 200): EtsyDraftResponse {
  return { status, body, text: JSON.stringify(body) };
}

function recordingClient(options?: {
  shopId?: string;
  listing?: Record<string, unknown>;
  drafts?: Record<string, unknown>[];
  imageStatus?: number;
}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client: EtsyDraftClient = {
    shopId: options?.shopId ?? '10',
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (path.includes('state=draft')) return json({ results: options?.drafts ?? [] });
      if (method === 'POST' && path.endsWith('/listings')) return json({ listing_id: 555, state: 'draft' });
      if (method === 'GET' && path.includes('/inventory')) {
        return json({
          products: [{
            sku: 'BLACK',
            property_values: [{ property_id: 513, property_name: 'Color', values: ['Black'], value_ids: [] }],
            offerings: [{ quantity: 2, price: 12, is_enabled: true }],
          }],
        });
      }
      if (method === 'GET' && path.includes('/listings/')) return json(options?.listing ?? { listing_id: 555, shop_id: 10, state: 'draft', title: 'Walnut card caddy' });
      if (method === 'POST' && path.endsWith('/images')) return json({ listing_image_id: 9 }, options?.imageStatus ?? 201);
      if (method === 'PUT' && path.endsWith('/inventory')) return json({ products: [] });
      if (method === 'PATCH') return json({ listing_id: 555, state: 'draft' });
      return json({});
    },
  };
  return { client, calls };
}

describe('physical Etsy drafts', () => {
  it('creates an unpublished non-card draft and does not activate it', async () => {
    const { client, calls } = recordingClient();
    const result = await createProductDraft(client, ready);
    expect(result).toMatchObject({ ok: true, published: false, listingId: '555', state: 'draft', reused: false });
    expect(result.editorUrl).toContain('/listing-editor/edit/555');
    const created = calls.find((call) => call.method === 'POST' && call.path.endsWith('/listings'));
    const form = created?.body as URLSearchParams;
    expect(form.get('type')).toBe('physical');
    expect(form.get('should_auto_renew')).toBe('false');
    expect(form.get('who_made')).toBe('i_did');
    expect(form.get('state')).toBeNull();
    expect(calls.some((call) => call.method === 'PATCH' && String(call.body).includes('state'))).toBe(false);
  });

  it('updates a draft title without sending a publish state', async () => {
    const { client, calls } = recordingClient();
    const result = await updateProductDraft(client, '555', { title: 'Oak card stand' });
    expect(result.ok).toBe(true);
    const patched = calls.find((call) => call.method === 'PATCH');
    expect((patched?.body as URLSearchParams).get('title')).toBe('Oak card stand');
    expect((patched?.body as URLSearchParams).get('state')).toBeNull();
    expect((patched?.body as URLSearchParams).get('should_auto_renew')).toBe('false');
  });

  it('reports missing required fields and does not create a listing', async () => {
    const { client, calls } = recordingClient();
    const result = await createProductDraft(client, {
      title: 'Planter',
      description: 'A planter.',
      price: 18,
      quantity: 1,
      whoMade: 'i_did',
      whenMade: 'made_to_order',
    });
    expect(result.ok).toBe(false);
    expect(result.listingId).toBeNull();
    expect(result.missing).toEqual(expect.arrayContaining(['taxonomyId', 'shippingProfileId', 'readinessStateId']));
    expect(calls).toHaveLength(0);
  });

  it('uploads an image onto a draft and keeps the rank', async () => {
    const { client, calls } = recordingClient();
    const result = await uploadDraftImages(client, '555', [{ url: 'https://cdn.example.com/caddy.png', rank: 1 }], async () => ({
      bytes: Buffer.from('png'),
      type: 'image/png',
      filename: 'caddy.png',
    }));
    expect(result).toMatchObject({ ok: true, photosUploaded: 1, published: false, state: 'draft' });
    const upload = calls.find((call) => call.path.endsWith('/images'));
    expect(upload?.body).toBeInstanceOf(FormData);
  });

  it('keeps variations that were not included in the update', async () => {
    const body = buildInventoryBody(
      [{
        sku: 'BLACK',
        property_values: [{ property_id: 513, property_name: 'Color', values: ['Black'], value_ids: [] }],
        offerings: [{ quantity: 2, price: 12 }],
      }],
      [{ sku: 'WHITE', price: 14, quantity: 1, options: [{ propertyId: 513, name: 'Color', value: 'White' }] }]
    );
    expect(body.products.map((product) => product.sku).sort()).toEqual(['BLACK', 'WHITE']);
    expect(body.price_on_property).toEqual([513]);
    expect(body.products.find((product) => product.sku === 'BLACK')?.offerings[0].quantity).toBe(2);
  });

  it('rejects a fourth variation property', () => {
    expect(() => buildInventoryBody([], [
      {
        price: 10,
        quantity: 1,
        options: [
          { name: 'Color', value: 'Oak' },
          { name: 'Size', value: 'Large' },
          { name: 'Pack', value: '2' },
          { name: 'Model', value: 'Pro' },
        ],
      },
    ])).toThrow(/3 custom variations/);
  });

  it('refuses a listing from another shop', async () => {
    const { client, calls } = recordingClient({ listing: { listing_id: 9, shop_id: 99, state: 'draft' } });
    const result = await updateProductDraft(client, '9', { title: 'Nope' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/connected Etsy shop/);
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('refuses writes to an active listing', async () => {
    const { client, calls } = recordingClient({ listing: { listing_id: 9, shop_id: 10, state: 'active' } });
    const result = await updateDraftVariants(client, '9', [
      { price: 10, quantity: 1, options: [{ propertyId: 513, name: 'Color', value: 'Oak' }] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/active/);
    expect(calls.some((call) => call.method === 'PUT' || call.method === 'PATCH')).toBe(false);
  });

  it('reuses a draft with the same SKU instead of creating another', async () => {
    const { client, calls } = recordingClient({
      drafts: [{ listing_id: 42, inventory: { products: [{ sku: 'CADDY-WALNUT' }] } }],
    });
    const result = await createProductDraft(client, ready);
    expect(result).toMatchObject({ ok: true, reused: true, listingId: '42', published: false });
    expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/listings'))).toBe(false);
  });

  it('returns the draft id when a later image fails so the draft is not created again', async () => {
    const { client, calls } = recordingClient();
    const result = await createProductDraft(client, {
      ...ready,
      images: [
        { url: 'https://cdn.example.com/one.png' },
        { url: 'https://cdn.example.com/two.png' },
      ],
    }, null, async (url) => {
      if (url.endsWith('two.png')) throw new Error('download failed');
      return { bytes: Buffer.from('png'), type: 'image/png', filename: 'one.png' };
    });
    expect(result.ok).toBe(false);
    expect(result.listingId).toBe('555');
    expect(result.photosUploaded).toBe(1);
    expect(result.incomplete.join(' ')).toMatch(/image 2/);
    expect(calls.filter((call) => call.method === 'POST' && call.path.endsWith('/listings'))).toHaveLength(1);
  });

  it('blocks image URLs that resolve to a private address', async () => {
    await expect(assertPublicImageUrl('http://cdn.example.com/a.png', async () => ['8.8.8.8'])).rejects.toThrow(/https/);
    await expect(assertPublicImageUrl('https://cdn.example.com/a.png', async () => ['10.1.1.5'])).rejects.toThrow(/private/);
    await expect(assertPublicImageUrl('https://127.0.0.1/a.png', async () => [])).rejects.toThrow(/private/);
    await expect(assertPublicImageUrl('https://cdn.example.com/a.png', async () => ['8.8.8.8'])).resolves.toBeInstanceOf(URL);
    expect(isPrivateAddress('192.168.1.9')).toBe(true);
  });
});
