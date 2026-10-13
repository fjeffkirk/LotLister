import prisma from '../prisma';
import { missingYoutubeEnv, youtubeCallbackUrl, youtubeConfigured } from './config';
import { listMyChannel } from './api';
import { decryptString, encryptString, refreshAccessToken, revokeToken, assertGrantedScopes, type GoogleTokenResponse } from './oauth';
import { YoutubeUserError } from './types';

export interface PublicConnection {
  connectionId: string;
  channelId: string;
  channelTitle: string;
  channelHandle: string | null;
  status: string;
  statusDetail: string | null;
  connectedAt: string;
  scopes: string[];
}

type ConnectionRow = {
  id: string;
  userEmail: string;
  channelId: string;
  channelTitle: string;
  channelHandle: string | null;
  refreshTokenEncrypted: string;
  accessTokenEncrypted: string | null;
  accessExpiresAt: Date | null;
  scopes: string;
  status: string;
  statusDetail: string | null;
  connectedAt: Date;
};

export function toPublicConnection(row: {
  id: string;
  channelId: string;
  channelTitle: string;
  channelHandle: string | null;
  status: string;
  statusDetail: string | null;
  connectedAt: Date;
  scopes: string;
}): PublicConnection {
  return {
    connectionId: row.id,
    channelId: row.channelId,
    channelTitle: row.channelTitle,
    channelHandle: row.channelHandle,
    status: row.status,
    statusDetail: row.statusDetail,
    connectedAt: row.connectedAt.toISOString(),
    scopes: row.scopes.split(/\s+/).filter(Boolean),
  };
}

export async function listConnections(accountId: string): Promise<PublicConnection[]> {
  const rows = await prisma.youtubeConnection.findMany({
    where: { userEmail: accountId },
    orderBy: { connectedAt: 'asc' },
  });
  return rows.map(toPublicConnection);
}

export async function connectionStatus(accountId: string, connectionId: string): Promise<PublicConnection> {
  const row = await ownedConnection(accountId, connectionId);
  return toPublicConnection(row);
}

export async function settingsView(accountId: string, origin: string) {
  const connections = await listConnections(accountId).catch(() => []);
  return {
    configured: youtubeConfigured(),
    missingEnv: missingYoutubeEnv(),
    callbackUrl: youtubeCallbackUrl(origin),
    connections,
  };
}

export async function saveGoogleConnection(accountId: string, token: GoogleTokenResponse): Promise<PublicConnection> {
  if (!token.refreshToken) {
    throw new YoutubeUserError(
      'refresh_token_missing',
      'Google did not return a refresh token. Remove LotLister at https://myaccount.google.com/permissions and connect again.',
    );
  }
  assertGrantedScopes(token.scope);
  const channel = await listMyChannel(token.accessToken);
  const data = {
    channelTitle: channel.channelTitle,
    channelHandle: channel.channelHandle,
    refreshTokenEncrypted: encryptString(token.refreshToken),
    accessTokenEncrypted: encryptString(token.accessToken),
    accessExpiresAt: new Date(Date.now() + Math.max(60, token.expiresIn) * 1000),
    scopes: token.scope,
    status: 'connected',
    statusDetail: null as string | null,
  };
  const row = await prisma.youtubeConnection.upsert({
    where: { userEmail_channelId: { userEmail: accountId, channelId: channel.channelId } },
    create: { userEmail: accountId, channelId: channel.channelId, ...data },
    update: data,
  });
  return toPublicConnection(row);
}

export async function disconnectConnection(accountId: string, connectionId: string): Promise<{
  disconnected: true;
  revoked: boolean;
  connectionId: string;
  channelId: string;
  channelTitle: string;
}> {
  const row = await ownedConnection(accountId, connectionId);
  let revoked = false;
  try {
    revoked = await revokeToken(decryptString(row.refreshTokenEncrypted));
  } catch {
    revoked = false;
  }
  await prisma.youtubeConnection.delete({ where: { id: row.id } });
  return {
    disconnected: true,
    revoked,
    connectionId: row.id,
    channelId: row.channelId,
    channelTitle: row.channelTitle,
  };
}

export async function getValidAccessToken(accountId: string, connectionId: string, force = false): Promise<string> {
  const connection = await ownedConnection(accountId, connectionId);
  if (connection.status !== 'connected') {
    throw new YoutubeUserError(
      'reconnect_required',
      connection.statusDetail || 'Reconnect this YouTube channel in LotLister settings before uploading.',
    );
  }
  const usable = !force
    && connection.accessTokenEncrypted
    && connection.accessExpiresAt
    && connection.accessExpiresAt.getTime() > Date.now() + 60_000;
  if (usable && connection.accessTokenEncrypted) return decryptString(connection.accessTokenEncrypted);

  let refreshToken: string;
  try {
    refreshToken = decryptString(connection.refreshTokenEncrypted);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The stored YouTube token could not be read.';
    await markConnectionReconnect(connection.id, message);
    throw error;
  }
  try {
    const token = await refreshAccessToken(refreshToken);
    assertGrantedScopes(token.scope);
    await prisma.youtubeConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEncrypted: encryptString(token.accessToken),
        accessExpiresAt: new Date(Date.now() + Math.max(60, token.expiresIn) * 1000),
        refreshTokenEncrypted: token.refreshToken ? encryptString(token.refreshToken) : connection.refreshTokenEncrypted,
        scopes: token.scope || connection.scopes,
        status: 'connected',
        statusDetail: null,
      },
    });
    return token.accessToken;
  } catch (error) {
    if (error instanceof YoutubeUserError && (error.code === 'reconnect_required' || error.code === 'token_unreadable')) {
      await markConnectionReconnect(connection.id, error.message);
    }
    throw error;
  }
}

async function ownedConnection(accountId: string, connectionId: string): Promise<ConnectionRow> {
  const row = await prisma.youtubeConnection.findFirst({ where: { id: connectionId, userEmail: accountId } });
  if (!row) {
    throw new YoutubeUserError(
      'not_found',
      'No YouTube connection with that id belongs to this account. Call youtube_connections_list and use the connectionId of the channel you verified.',
    );
  }
  return row;
}

export async function markConnectionReconnect(id: string, statusDetail: string): Promise<void> {
  await prisma.youtubeConnection.updateMany({
    where: { id },
    data: { status: 'reconnect_required', statusDetail: statusDetail.slice(0, 400), accessTokenEncrypted: null, accessExpiresAt: null },
  });
}

export async function requireOwnedConnection(accountId: string, connectionId: string): Promise<ConnectionRow> {
  return ownedConnection(accountId, connectionId);
}
