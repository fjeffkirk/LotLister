import { describe, expect, it } from 'vitest';
import { assertChatGptRedirect, consentScopes, grantedScopes, pkceChallenge } from '../lib/mcp/oauth';
import { findTool, registerTool } from '../lib/mcp/registry';
import { dispatchMcp } from '../lib/mcp/protocol';

describe('LotLister MCP policy', () => {
  it('grants read and draft access, and ignores a publish scope', () => {
    expect(grantedScopes('lotlister.read lotlister.publish')).toEqual(['lotlister.read']);
    expect(grantedScopes('lotlister.read lotlister.youtube')).toEqual(['lotlister.read', 'lotlister.youtube']);
    expect(grantedScopes(undefined)).toEqual(['lotlister.read', 'lotlister.drafts', 'lotlister.prices', 'lotlister.youtube', 'lotlister.tiktok']);
    expect(consentScopes()).toEqual(['lotlister.read', 'lotlister.drafts', 'lotlister.prices', 'lotlister.youtube', 'lotlister.tiktok']);
  });

  it('only accepts ChatGPT redirect addresses', () => {
    expect(() => assertChatGptRedirect('https://evil.example/callback')).toThrow(/ChatGPT/);
    expect(assertChatGptRedirect('https://chatgpt.com/connector_platform_oauth_redirect')).toContain('chatgpt.com');
  });

  it('builds a stable PKCE challenge', () => {
    expect(pkceChallenge('vvkdljkejllufrvbhgeiegrnvufrhvrffnkvcknjvfid')).toBe('DSWlW2Abh-cf8CeLL8-g3hQ2WQyYdKyiu83u_s7nRhI');
  });

  it('refuses to register publishing or destructive tools', () => {
    expect(() => registerTool({
      name: 'ebay_listings_publish',
      description: 'no',
      effect: 'read',
      inputSchema: {},
      handler: async () => ({}),
    })).toThrow(/not available/);
  });

  it('shows draft creation only when that access was granted', async () => {
    const session = { accountId: 'seller', scopes: ['lotlister.read'] as const, clientId: 'chatgpt' };
    const listed = await dispatchMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { ...session, scopes: ['lotlister.read'] });
    const names = ((listed.body?.result as { tools: { name: string }[] }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['lots_list', 'ebay_listings_get', 'etsy_receipts_get', 'shopify_summary_get']));
    expect(names).not.toContain('etsy_drafts_create');
    expect(names).not.toContain('etsy_drafts_create_product');
    expect(names).toContain('etsy_listings_get');
    expect(names).not.toContain('etsy_listings_update');
    expect(names).not.toContain('etsy_listing_variants_update');
    expect(names).not.toContain('etsy_listing_images_update');
    expect(names).not.toContain('ebay_prices_apply');
    expect(names).not.toContain('youtube_upload_video');
    expect(names).not.toContain('youtube_video_publish');
    expect(names).not.toContain('tiktok_campaign_create');
    expect(names).not.toContain('tiktok_status_update');

    const denied = await dispatchMcp({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'etsy_drafts_create', arguments: { cardId: '00000000-0000-4000-8000-000000000000' } },
    }, { ...session, scopes: ['lotlister.read'] });
    expect((denied.body?.result as { isError: boolean }).isError).toBe(true);
  });

  it('lists YouTube upload tools only for the youtube scope and still blocks deletes', async () => {
    expect(findTool('youtube_video_publish')?.readOnly).toBe(false);
    expect(findTool('youtube_connections_list')?.readOnly).toBe(true);
    expect(() => registerTool({
      name: 'youtube_video_delete',
      description: 'no',
      effect: 'youtube',
      inputSchema: {},
      handler: async () => ({}),
    })).toThrow(/not available/);

    const session = { accountId: 'seller', scopes: ['lotlister.youtube'] as const, clientId: 'chatgpt' };
    const listed = await dispatchMcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { ...session, scopes: ['lotlister.youtube'] });
    const names = ((listed.body?.result as { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] }).tools).map((tool) => tool.name);
    expect(names).toContain('youtube_upload_video');
    expect(names).toContain('youtube_video_publish');
    expect(names).not.toContain('lots_list');
    const publish = ((listed.body?.result as { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] }).tools)
      .find((tool) => tool.name === 'youtube_video_publish');
    expect(publish?.annotations?.readOnlyHint).toBe(false);
  });

  it('lists TikTok tools only for the tiktok scope and still blocks deletes', async () => {
    expect(findTool('tiktok_campaign_create')?.readOnly).toBe(false);
    expect(findTool('tiktok_connection_status')?.readOnly).toBe(true);
    expect(() => registerTool({
      name: 'tiktok_campaign_delete',
      description: 'no',
      effect: 'tiktok',
      inputSchema: {},
      handler: async () => ({}),
    })).toThrow(/not available/);

    const session = { accountId: 'seller', scopes: ['lotlister.tiktok'] as const, clientId: 'chatgpt' };
    const listed = await dispatchMcp({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { ...session, scopes: ['lotlister.tiktok'] });
    const names = ((listed.body?.result as { tools: { name: string }[] }).tools).map((tool) => tool.name);
    expect(names).toContain('tiktok_campaigns_list');
    expect(names).toContain('tiktok_performance_get');
    expect(names).toContain('tiktok_campaign_create');
    expect(names).not.toContain('lots_list');
    expect(names).not.toContain('youtube_upload_video');
  });

  it('lists existing Etsy listing edits for the drafts scope and keeps them separate from draft tools', async () => {
    expect(findTool('etsy_listings_update')?.effect).toBe('draft');
    expect(findTool('etsy_listings_get')?.effect).toBe('read');
    const listed = await dispatchMcp({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, {
      accountId: 'seller',
      scopes: ['lotlister.drafts'],
      clientId: 'chatgpt',
    });
    const names = ((listed.body?.result as { tools: { name: string }[] }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'etsy_listings_update',
      'etsy_listing_variants_update',
      'etsy_listing_images_update',
      'etsy_drafts_update',
      'etsy_draft_variants_update',
    ]));
    expect(names).not.toContain('etsy_listings_get');
  });
});
