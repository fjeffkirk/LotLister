/**
 * eBay Marketplace Account Deletion notifications.
 *
 * Follows eBay's documented flow and its official Node SDK
 * (github.com/eBay/event-notification-nodejs-sdk):
 * - GET  ?challenge_code=... → SHA-256 hex of challengeCode + verificationToken + endpointUrl
 * - POST → verify X-EBAY-SIGNATURE with the public key from the Notification API,
 *          then delete the eBay data LotLister stores for that user.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'crypto';
import type { PrismaClient } from '@prisma/client';

export const ACCOUNT_DELETION_TOPIC = 'MARKETPLACE_ACCOUNT_DELETION';
export const MAX_NOTIFICATION_BYTES = 64 * 1024;
const PUBLIC_KEY_URL = 'https://api.ebay.com/commerce/notification/v1/public_key/';
const PUBLIC_KEY_TTL_MS = 60 * 60 * 1000;

export function computeChallengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpointUrl: string
): string {
  return createHash('sha256')
    .update(challengeCode)
    .update(verificationToken)
    .update(endpointUrl)
    .digest('hex');
}

export interface DeletionConfig {
  verificationToken: string;
  endpointUrl: string;
}

/** Reads the deletion endpoint settings from the environment. Returns null when either is missing. */
export function getDeletionConfig(env: NodeJS.ProcessEnv = process.env): DeletionConfig | null {
  const verificationToken = env.EBAY_DELETION_VERIFICATION_TOKEN?.trim();
  const endpointUrl = env.EBAY_DELETION_ENDPOINT_URL?.trim();
  if (!verificationToken || !endpointUrl) return null;
  return { verificationToken, endpointUrl };
}

export interface EbaySignatureHeader {
  alg: string;
  kid: string;
  signature: string;
  digest: string;
}

export function parseSignatureHeader(header: string | null | undefined): EbaySignatureHeader | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Partial<EbaySignatureHeader>;
    if (
      typeof decoded.kid !== 'string' ||
      typeof decoded.signature !== 'string' ||
      !decoded.kid ||
      !decoded.signature
    ) {
      return null;
    }
    return {
      alg: String(decoded.alg ?? ''),
      kid: decoded.kid,
      signature: decoded.signature,
      digest: String(decoded.digest ?? ''),
    };
  } catch {
    return null;
  }
}

export interface EbayPublicKey {
  algorithm: string;
  digest: string;
  key: string;
}

export type PublicKeyFetcher = (kid: string) => Promise<EbayPublicKey>;

/** The Notification API returns PEM without line breaks; Node needs them around the armor lines. */
export function formatPublicKey(key: string): string {
  return key
    .replace(/-----BEGIN PUBLIC KEY-----\s*/, '-----BEGIN PUBLIC KEY-----\n')
    .replace(/\s*-----END PUBLIC KEY-----/, '\n-----END PUBLIC KEY-----');
}

function nodeDigest(digest: string): string | null {
  switch (digest.toUpperCase()) {
    case 'SHA1':
      return 'sha1';
    case 'SHA256':
      return 'sha256';
    default:
      return null;
  }
}

/**
 * Verifies X-EBAY-SIGNATURE. eBay signs the JSON message; the official SDK checks JSON.stringify of the
 * parsed body, so the exact raw body is tried first and the re-serialized form second.
 */
export async function verifyEbaySignature(options: {
  rawBody: string;
  parsedBody: unknown;
  signatureHeader: string | null | undefined;
  getPublicKey: PublicKeyFetcher;
}): Promise<boolean> {
  const header = parseSignatureHeader(options.signatureHeader);
  if (!header) return false;

  const publicKey = await options.getPublicKey(header.kid);
  if (publicKey.algorithm.toUpperCase() !== 'ECDSA') return false;
  const digest = nodeDigest(publicKey.digest || header.digest);
  if (!digest) return false;

  let keyObject;
  try {
    keyObject = createPublicKey(formatPublicKey(publicKey.key));
  } catch {
    return false;
  }

  const signature = Buffer.from(header.signature, 'base64');
  const candidates = [options.rawBody];
  const reserialized = JSON.stringify(options.parsedBody);
  if (reserialized !== options.rawBody) candidates.push(reserialized);

  return candidates.some((message) => {
    try {
      return cryptoVerify(digest, Buffer.from(message, 'utf8'), keyObject, signature);
    } catch {
      return false;
    }
  });
}

/** Fetches eBay's signing key with an application token and caches it per key id. */
export function createEbayPublicKeyFetcher(
  getAppToken: () => Promise<string>,
  fetchImpl: typeof fetch = fetch
): PublicKeyFetcher {
  const cache = new Map<string, { value: EbayPublicKey; expiresAt: number }>();

  return async (kid: string) => {
    const hit = cache.get(kid);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const token = await getAppToken();
    const response = await fetchImpl(`${PUBLIC_KEY_URL}${encodeURIComponent(kid)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`eBay public key lookup failed (${response.status})`);
    }
    const value = (await response.json()) as EbayPublicKey;
    if (!value?.key || !value.algorithm) {
      throw new Error('eBay public key response was incomplete');
    }
    cache.set(kid, { value, expiresAt: Date.now() + PUBLIC_KEY_TTL_MS });
    return value;
  };
}

export interface DeletionRequest {
  notificationId: string;
  userId: string | null;
  username: string | null;
}

export interface DeletionOutcome {
  duplicate: boolean;
  connectionsDeleted: number;
  cardsCleared: number;
}

export interface DeletionStore {
  deleteEbayUserData(request: DeletionRequest): Promise<DeletionOutcome>;
}

interface DeletionNotification {
  metadata?: { topic?: string };
  notification?: {
    notificationId?: string;
    data?: { userId?: string; username?: string };
  };
}

export interface HandleResult {
  status: 204 | 400 | 412 | 413 | 500;
  /** Safe to log: never contains the username, user id, or tokens. */
  logMessage: string;
}

export async function handleDeletionNotification(options: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  getPublicKey: PublicKeyFetcher;
  store: DeletionStore;
}): Promise<HandleResult> {
  if (Buffer.byteLength(options.rawBody, 'utf8') > MAX_NOTIFICATION_BYTES) {
    return { status: 413, logMessage: 'Rejected oversized notification' };
  }

  let parsed: DeletionNotification;
  try {
    parsed = JSON.parse(options.rawBody) as DeletionNotification;
  } catch {
    return { status: 400, logMessage: 'Rejected notification with invalid JSON' };
  }

  const notificationId = parsed?.notification?.notificationId;
  if (!parsed?.metadata || !parsed.notification || typeof notificationId !== 'string' || !notificationId) {
    return { status: 400, logMessage: 'Rejected notification without metadata or notificationId' };
  }

  let verified: boolean;
  try {
    verified = await verifyEbaySignature({
      rawBody: options.rawBody,
      parsedBody: parsed,
      signatureHeader: options.signatureHeader,
      getPublicKey: options.getPublicKey,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return { status: 500, logMessage: `Could not verify notification ${notificationId}: ${reason}` };
  }

  if (!verified) {
    return { status: 412, logMessage: `Signature verification failed for notification ${notificationId}` };
  }

  if (parsed.metadata.topic !== ACCOUNT_DELETION_TOPIC) {
    return { status: 204, logMessage: `Acknowledged notification ${notificationId} for unhandled topic` };
  }

  const data = parsed.notification.data ?? {};
  const userId = typeof data.userId === 'string' && data.userId ? data.userId : null;
  const username = typeof data.username === 'string' && data.username ? data.username : null;

  try {
    const outcome = await options.store.deleteEbayUserData({ notificationId, userId, username });
    if (outcome.duplicate) {
      return { status: 204, logMessage: `Notification ${notificationId} was already processed` };
    }
    return {
      status: 204,
      logMessage: `Processed notification ${notificationId}: removed ${outcome.connectionsDeleted} eBay connection(s), cleared ${outcome.cardsCleared} listing reference(s)`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return { status: 500, logMessage: `Deletion failed for notification ${notificationId}: ${reason}` };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');
}

/**
 * Deletes the stored eBay connection (OAuth tokens, user id, username) for the eBay user, clears the
 * eBay listing references LotLister recorded for that seller, and records the notification id so
 * eBay's retries are no-ops. Runs in one transaction so a failure leaves nothing half-deleted.
 */
export function createPrismaDeletionStore(prisma: PrismaClient): DeletionStore {
  return {
    async deleteEbayUserData({ notificationId, userId, username }) {
      try {
        return await prisma.$transaction(async (tx) => {
          const already = await tx.ebayDeletionNotification.findUnique({ where: { notificationId } });
          if (already) {
            return { duplicate: true, connectionsDeleted: 0, cardsCleared: 0 };
          }

          const identifiers = [userId, username].filter((value): value is string => Boolean(value));
          const connections = identifiers.length
            ? await tx.ebayConnection.findMany({
                where: {
                  OR: [{ ebayUserId: { in: identifiers } }, { ebayUsername: { in: identifiers } }],
                },
                select: { userEmail: true },
              })
            : [];
          const emails = connections.map((connection) => connection.userEmail);

          let cardsCleared = 0;
          if (emails.length > 0) {
            const cleared = await tx.cardItem.updateMany({
              where: { ebayItemId: { not: null }, lot: { userEmail: { in: emails } } },
              data: { ebayItemId: null, ebayListedAt: null, listings: null },
            });
            cardsCleared = cleared.count;
            await tx.ebayConnection.deleteMany({ where: { userEmail: { in: emails } } });
          }

          await tx.ebayDeletionNotification.create({
            data: { notificationId, connectionsDeleted: emails.length, cardsCleared },
          });

          return { duplicate: false, connectionsDeleted: emails.length, cardsCleared };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { duplicate: true, connectionsDeleted: 0, cardsCleared: 0 };
        }
        throw error;
      }
    },
  };
}
