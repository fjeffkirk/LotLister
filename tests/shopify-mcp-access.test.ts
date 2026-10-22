import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findTool } from '../lib/mcp/registry';
import '../lib/mcp/tools/account';
import '../lib/mcp/tools/shopify';

const { settings, database, ebay, etsy } = vi.hoisted(() => ({ settings: vi.fn(), database: vi.fn(), ebay: vi.fn(), etsy: vi.fn() }));
vi.mock('../lib/prisma', () => ({ default: {
  appSetting: { findFirst: settings }, ebayConnection: { findUnique: ebay }, etsyConnection: { findUnique: etsy },
} }));
vi.mock('../lib/db', () => ({ prisma: null, tryPrisma: database }));
vi.mock('../lib/queries/app-settings', () => ({ getAppSettings: settings }));
vi.mock('../lib/shopify/config', () => ({ isShopifyApiReady: database }));

describe('Shopify MCP authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SHOPIFY_ALLOWED_ACCOUNT_IDS', 'owner');
    ebay.mockResolvedValue({ ebayUsername: 'friend' });
    etsy.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('does not reveal the store connection to another authenticated MCP account', async () => {
    const result = await findTool('account_get')!.handler({ accountId: 'friend', scopes: ['lotlister.read'] }, {});
    expect(result).toMatchObject({ ebay: { connected: true }, shopify: { shop: null, connected: false } });
    expect(settings).not.toHaveBeenCalled();
  });
  it('rejects Shopify summaries before querying store data even with the MCP read scope', async () => {
    await expect(findTool('shopify_summary_get')!.handler({ accountId: 'friend', scopes: ['lotlister.read'] }, {}))
      .rejects.toThrow('Shopify access is not enabled');
    expect(settings).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
  });
  it('preserves store connection visibility for the explicitly authorized owner', async () => {
    settings.mockResolvedValue({ shopifyShopName: 'Fixture Store', shopifyShopDomain: 'fixture.myshopify.com' });
    expect(await findTool('account_get')!.handler({ accountId: 'owner', scopes: ['lotlister.read'] }, {}))
      .toMatchObject({ shopify: { shop: 'Fixture Store', connected: true } });
  });
});
