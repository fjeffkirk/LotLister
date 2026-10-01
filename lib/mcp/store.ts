import { randomBytes } from 'crypto';
import prisma from '../prisma';
import { hashSecret, pkceChallenge, secretsMatch, type McpScope } from './oauth';

const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface McpSession {
  accountId: string;
  scopes: McpScope[];
  clientId: string;
}

export async function registerMcpClient(name: string | null, redirectUris: string[]): Promise<{ clientId: string }> {
  const clientId = `mcp_${randomBytes(16).toString('hex')}`;
  await prisma.mcpClient.create({
    data: { id: clientId, name, redirectUris: JSON.stringify(redirectUris) },
  });
  return { clientId };
}

export async function getMcpClient(clientId: string): Promise<{ id: string; redirectUris: string[] } | null> {
  const client = await prisma.mcpClient.findUnique({ where: { id: clientId } });
  if (!client) return null;
  const redirectUris = JSON.parse(client.redirectUris) as string[];
  return { id: client.id, redirectUris };
}

export async function issueAuthCode(input: {
  clientId: string;
  userEmail: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: McpScope[];
}): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  await prisma.mcpAuthCode.create({
    data: {
      codeHash: hashSecret(code),
      clientId: input.clientId,
      userEmail: input.userEmail,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      scopes: input.scopes.join(' '),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return code;
}

export async function exchangeAuthCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ accessToken: string; refreshToken: string; scopes: string; expiresIn: number }> {
  const row = await prisma.mcpAuthCode.findUnique({ where: { codeHash: hashSecret(input.code) } });
  if (!row || row.expiresAt.getTime() < Date.now()) throw new Error('Authorization code expired');
  if (row.clientId !== input.clientId || row.redirectUri !== input.redirectUri) throw new Error('Authorization code does not match this client');
  if (!secretsMatch(pkceChallenge(input.codeVerifier), row.codeChallenge)) throw new Error('PKCE verification failed');
  await prisma.mcpAuthCode.delete({ where: { codeHash: row.codeHash } });
  return issueTokenPair(row.clientId, row.userEmail, row.scopes, randomBytes(16).toString('hex'));
}

export async function exchangeRefreshToken(input: {
  refreshToken: string;
  clientId: string;
}): Promise<{ accessToken: string; refreshToken: string; scopes: string; expiresIn: number }> {
  const row = await prisma.mcpToken.findUnique({ where: { tokenHash: hashSecret(input.refreshToken) } });
  if (!row || row.kind !== 'refresh' || row.expiresAt.getTime() < Date.now()) throw new Error('Refresh token expired');
  if (row.clientId !== input.clientId) throw new Error('Refresh token does not match this client');
  await prisma.mcpToken.deleteMany({ where: { familyId: row.familyId } });
  return issueTokenPair(row.clientId, row.userEmail, row.scopes, row.familyId);
}

async function issueTokenPair(clientId: string, userEmail: string, scopes: string, familyId: string) {
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  await prisma.mcpToken.createMany({
    data: [
      {
        tokenHash: hashSecret(accessToken),
        kind: 'access',
        clientId,
        userEmail,
        scopes,
        familyId,
        expiresAt: new Date(now + ACCESS_TTL_MS),
      },
      {
        tokenHash: hashSecret(refreshToken),
        kind: 'refresh',
        clientId,
        userEmail,
        scopes,
        familyId,
        expiresAt: new Date(now + REFRESH_TTL_MS),
      },
    ],
  });
  return { accessToken, refreshToken, scopes, expiresIn: Math.floor(ACCESS_TTL_MS / 1000) };
}

export async function sessionFromAccessToken(token: string): Promise<McpSession | null> {
  const row = await prisma.mcpToken.findUnique({ where: { tokenHash: hashSecret(token) } });
  if (!row || row.kind !== 'access' || row.expiresAt.getTime() < Date.now()) return null;
  const scopes = row.scopes.split(/\s+/).filter((scope): scope is McpScope => scope === 'lotlister.read' || scope === 'lotlister.drafts');
  return { accountId: row.userEmail, scopes, clientId: row.clientId };
}
