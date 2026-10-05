import { describe, expect, it } from 'vitest';
import { assertChatGptRedirect, consentScopes, grantedScopes, pkceChallenge } from '../lib/mcp/oauth';
import { registerTool } from '../lib/mcp/registry';
import { dispatchMcp } from '../lib/mcp/protocol';

describe('LotLister MCP policy', () => {
  it('grants read and draft access, and ignores a publish scope', () => {
    expect(grantedScopes('lotlister.read lotlister.publish')).toEqual(['lotlister.read']);
    expect(grantedScopes(undefined)).toEqual(['lotlister.read', 'lotlister.drafts', 'lotlister.prices']);
    expect(consentScopes()).toEqual(['lotlister.read', 'lotlister.drafts', 'lotlister.prices']);
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
    expect(names).not.toContain('ebay_prices_apply');

    const denied = await dispatchMcp({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'etsy_drafts_create', arguments: { cardId: '00000000-0000-4000-8000-000000000000' } },
    }, { ...session, scopes: ['lotlister.read'] });
    expect((denied.body?.result as { isError: boolean }).isError).toBe(true);
  });
});
