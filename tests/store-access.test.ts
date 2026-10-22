import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isShopifyAccountAllowed } from '../lib/shopify/access';
import { requireShopifySession } from '../lib/require-session';
import { normalizeShopDomain } from '../lib/shopify/normalize';
const { getUserEmail, db } = vi.hoisted(() => ({ getUserEmail: vi.fn(), db: {
  appSetting: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  catalogItem: { findMany: vi.fn(), update: vi.fn() }, order: { findMany: vi.fn() },
  syncRun: { findFirst: vi.fn() }, dailyAdBudget: { findMany: vi.fn() },
} }));
vi.mock('../lib/auth', () => ({ getUserEmail }));
vi.mock('../lib/db', () => ({ prisma: db, tryPrisma: vi.fn() }));
vi.mock('../lib/prisma', () => ({ default: db, prisma: db }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('redirected'); }), usePathname: vi.fn() }));
vi.mock('../lib/sync/revalidate', () => ({ revalidateAppData: vi.fn(), revalidateDashboardFigures: vi.fn() }));

describe('Shopify access boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SHOPIFY_ALLOWED_ACCOUNT_IDS', 'owner-id');
    getUserEmail.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('fails closed and matches exact account IDs, not partial names', () => {
    expect(isShopifyAccountAllowed('owner-id', {} as NodeJS.ProcessEnv)).toBe(false);
    expect(isShopifyAccountAllowed('owner-id')).toBe(true);
    expect(isShopifyAccountAllowed('owner')).toBe(false);
    expect(isShopifyAccountAllowed('friend')).toBe(false);
  });
  it('distinguishes a missing session from a signed-in user without store permission', async () => {
    expect((await requireShopifySession() as Response).status).toBe(401);
    getUserEmail.mockResolvedValue('friend');
    expect((await requireShopifySession() as Response).status).toBe(403);
    getUserEmail.mockResolvedValue('owner-id');
    expect(await requireShopifySession()).toEqual({ email: 'owner-id' });
  });
  const routes = [
    ['ad-budget', 'GET'], ['ad-budget', 'POST'], ['sync', 'GET'], ['sync', 'PUT'], ['sync', 'POST'],
    ['catalog/item', 'POST'], ['catalog/items', 'GET'], ['export', 'GET'], ['search', 'GET'],
    ['shopify/settings', 'GET'], ['shopify/settings', 'POST'], ['shopify/auth', 'GET'],
    ['shopify/auth/callback', 'GET'], ['shopify/test', 'GET'], ['storage', 'GET'],
  ];
  it.each(routes)('blocks %s %s before data access for anonymous users AND other sellers', async (path, method) => {
    const route = await import(/* @vite-ignore */ `../app/api/${path}/route`);
    for (const [identity, status] of [[null, 401], ['friend', 403]] as const) {
      getUserEmail.mockResolvedValue(identity);
      const response = await route[method](new Request('https://example.test/api/' + path, { method }));
      expect(response.status).toBe(status);
    }
    for (const model of Object.values(db)) for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
  });
  it.each(['orders', 'inventory'])('redirects %s before loading any server-rendered private data', async (page) => {
    const component = (await import(/* @vite-ignore */ `../app/ops/${page}/page`)).default;
    await expect(component()).rejects.toThrow('redirected');
    getUserEmail.mockResolvedValue('friend');
    await expect(component()).rejects.toThrow('redirected');
    expect(db.appSetting.findFirst).not.toHaveBeenCalled();
    expect(db.order.findMany).not.toHaveBeenCalled();
  });
  it('checks direct server actions even when their normal API wrapper is bypassed', async () => {
    const { updateSettings } = await import('../app/actions/settings');
    const { updateCatalogItem, updateProductMargin } = await import('../app/actions/catalog');
    const { fetchAlertSnapshots } = await import('../app/actions/alerts');
    await expect(updateSettings({} as never)).rejects.toThrow('access denied');
    await expect(updateCatalogItem('known-id', { costBasis: 1 })).rejects.toThrow('access denied');
    await expect(updateProductMargin('known-id', 1)).rejects.toThrow('access denied');
    await expect(fetchAlertSnapshots()).rejects.toThrow('access denied');
    expect(db.catalogItem.update).not.toHaveBeenCalled();
  });
  it('preserves authorized catalog access', async () => {
    getUserEmail.mockResolvedValue('owner-id');
    db.catalogItem.findMany.mockResolvedValue([{ id: 'fixture', title: 'Fixture' }]);
    const { GET } = await import('../app/api/catalog/items/route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).products).toHaveLength(1);
  });
});

describe('Shopify OAuth destination validation', () => {
  it('accepts canonical Shopify domains and rejects credential-exfiltration destinations', () => {
    expect(normalizeShopDomain(' https://test-store.myshopify.com/ ')).toBe('test-store.myshopify.com');
    expect(normalizeShopDomain('test-store')).toBe('test-store.myshopify.com');
    for (const host of ['evil.example', 'shop.myshopify.com.evil.example', 'shop.myshopify.com@evil.example',
      '127.0.0.1', 'http://shop.myshopify.com', 'shop.myshopify.com:443', 'shop.myshopify.com/path']) {
      expect(normalizeShopDomain(host)).toBe('');
    }
  });
});
