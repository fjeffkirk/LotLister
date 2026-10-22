import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSecret, MCP_SCOPES } from '../lib/mcp/oauth';
import { sessionFromAccessToken } from '../lib/mcp/store';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('../lib/prisma', () => ({
  default: { mcpToken: { findUnique } },
}));

const accessToken = 'test-access-token';

function tokenRow(scopes: string) {
  return {
    tokenHash: hashSecret(accessToken),
    kind: 'access',
    clientId: 'test-client',
    userEmail: 'seller@example.com',
    scopes,
    familyId: 'test-family',
    expiresAt: new Date(Date.now() + 60_000),
  };
}

describe('MCP access-token sessions', () => {
  beforeEach(() => findUnique.mockReset());

  it('preserves all granted capabilities, including YouTube, when loading a session', async () => {
    findUnique.mockResolvedValue(tokenRow(MCP_SCOPES.join(' ')));

    const session = await sessionFromAccessToken(accessToken);

    expect(session).toEqual({
      accountId: 'seller@example.com',
      clientId: 'test-client',
      scopes: [...MCP_SCOPES],
    });
    expect(session?.scopes).toContain('lotlister.youtube');
    expect(findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashSecret(accessToken) },
    });
  });

  it('does not add YouTube access to an older token that did not grant it', async () => {
    findUnique.mockResolvedValue(tokenRow('lotlister.read lotlister.drafts lotlister.prices'));

    expect((await sessionFromAccessToken(accessToken))?.scopes).toEqual([
      'lotlister.read', 'lotlister.drafts', 'lotlister.prices',
    ]);
  });

  it('keeps a YouTube-only grant and discards unknown scopes', async () => {
    findUnique.mockResolvedValue(tokenRow('  lotlister.youtube\tlotlister.admin\nlotlister.publish  '));

    expect((await sessionFromAccessToken(accessToken))?.scopes).toEqual(['lotlister.youtube']);
  });

  it.each(['', 'lotlister.admin'])('grants no capabilities for a stored scope of %j', async (scopes) => {
    findUnique.mockResolvedValue(tokenRow(scopes));

    expect((await sessionFromAccessToken(accessToken))?.scopes).toEqual([]);
  });

  it('rejects missing, expired, and refresh tokens', async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await sessionFromAccessToken(accessToken)).toBeNull();

    findUnique.mockResolvedValueOnce({
      ...tokenRow('lotlister.youtube'),
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await sessionFromAccessToken(accessToken)).toBeNull();

    findUnique.mockResolvedValueOnce({ ...tokenRow('lotlister.youtube'), kind: 'refresh' });
    expect(await sessionFromAccessToken(accessToken)).toBeNull();
  });
});
