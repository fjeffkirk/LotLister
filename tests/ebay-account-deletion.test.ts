import { createHash, generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  computeChallengeResponse,
  createEbayPublicKeyFetcher,
  createPrismaDeletionStore,
  DeletionStore,
  EbayPublicKey,
  handleDeletionNotification,
  verifyEbaySignature,
} from '../lib/ebay-account-deletion';

// Signed sample notification and matching public key from eBay's official SDK test fixtures
// (github.com/eBay/event-notification-nodejs-sdk, test/test.json).
const EBAY_SAMPLE = {
  signature:
    'eyJhbGciOiJlY2RzYSIsImtpZCI6Ijk5MzYyNjFhLTdkN2ItNDYyMS1hMGYxLTk2Y2NiNDI4YWY0OSIsInNpZ25hdHVyZSI6Ik1FWUNJUUNmeGZJV3V4bVdjSUJRSjljNS9YN2lHREpxczJSQ0dzQkVhQWppbnlycmZBSWhBSVY2d0djVGlCdVY1S0pVaWYyaG9reXJMK1E5c3NIa2FkK214Mm5FRTI1dyIsImRpZ2VzdCI6IlNIQTEifQ==',
  message: {
    metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION', schemaVersion: '1.0', deprecated: false },
    notification: {
      notificationId: '49feeaeb-4982-42d9-a377-9645b8479411_33f7e043-fed8-442b-9d44-791923bd9a6d',
      eventDate: '2021-03-19T20:43:59.462Z',
      publishDate: '2021-03-19T20:43:59.679Z',
      publishAttemptCount: 1,
      data: {
        username: 'test_user',
        userId: 'ma8vp1jySJC',
        eiasToken: 'nY+sHZ2PrBmdj6wVnY+sEZ2PrA2dj6wJnY+gAZGEpwmdj6x9nY+seQ==',
      },
    },
  },
  kid: '9936261a-7d7b-4621-a0f1-96ccb428af49',
  publicKey: {
    key: '-----BEGIN PUBLIC KEY-----MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZhhxXKtR+TOvtDbgTPCkSof02qgBB7IsYOyf76ilExJ/upAa/vKIKheOoCyOpcLmi4t0b4uepb7LLjmMr90FUg==-----END PUBLIC KEY-----',
    algorithm: 'ECDSA',
    digest: 'SHA1',
  } as EbayPublicKey,
};

const sampleRawBody = JSON.stringify(EBAY_SAMPLE.message);

function sampleKeyFetcher() {
  return vi.fn(async (kid: string) => {
    if (kid !== EBAY_SAMPLE.kid) throw new Error('unknown kid');
    return EBAY_SAMPLE.publicKey;
  });
}

function recordingStore(outcome = { duplicate: false, connectionsDeleted: 1, cardsCleared: 2 }) {
  const deleteEbayUserData = vi.fn(async () => outcome);
  return { store: { deleteEbayUserData } as DeletionStore, deleteEbayUserData };
}

describe('computeChallengeResponse', () => {
  it('is the SHA-256 hex of challengeCode + verificationToken + endpointUrl', () => {
    const code = 'a8628072-3d33-45ee-9004-bee86830a22d';
    const token = 'f'.repeat(64);
    const endpoint = 'https://lotlister.example.com/api/ebay/account-deletion';

    const expected = createHash('sha256').update(`${code}${token}${endpoint}`).digest('hex');
    const actual = computeChallengeResponse(code, token, endpoint);

    expect(actual).toBe(expected);
    expect(actual).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the endpoint URL differs by one character', () => {
    const token = 'a'.repeat(64);
    expect(computeChallengeResponse('c', token, 'https://x.test/a')).not.toBe(
      computeChallengeResponse('c', token, 'https://x.test/a/')
    );
  });
});

describe('verifyEbaySignature', () => {
  it('accepts eBay’s signed sample notification', async () => {
    const ok = await verifyEbaySignature({
      rawBody: sampleRawBody,
      parsedBody: EBAY_SAMPLE.message,
      signatureHeader: EBAY_SAMPLE.signature,
      getPublicKey: sampleKeyFetcher(),
    });
    expect(ok).toBe(true);
  });

  it('rejects the sample when the payload is altered', async () => {
    const tampered = structuredClone(EBAY_SAMPLE.message);
    tampered.notification.data.username = 'someone_else';
    const ok = await verifyEbaySignature({
      rawBody: JSON.stringify(tampered),
      parsedBody: tampered,
      signatureHeader: EBAY_SAMPLE.signature,
      getPublicKey: sampleKeyFetcher(),
    });
    expect(ok).toBe(false);
  });

  it('rejects a missing or malformed signature header', async () => {
    for (const header of [null, '', 'not-base64-json', Buffer.from('{"kid":1}').toString('base64')]) {
      const ok = await verifyEbaySignature({
        rawBody: sampleRawBody,
        parsedBody: EBAY_SAMPLE.message,
        signatureHeader: header,
        getPublicKey: sampleKeyFetcher(),
      });
      expect(ok).toBe(false);
    }
  });

  it('verifies the exact raw body when it is not compact JSON', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const rawBody = JSON.stringify(EBAY_SAMPLE.message, null, 2);
    const signature = sign('sha1', Buffer.from(rawBody), privateKey).toString('base64');
    const header = Buffer.from(
      JSON.stringify({ alg: 'ecdsa', kid: 'local-kid', signature, digest: 'SHA1' })
    ).toString('base64');
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString().replace(/\n/g, '');

    const ok = await verifyEbaySignature({
      rawBody,
      parsedBody: JSON.parse(rawBody),
      signatureHeader: header,
      getPublicKey: async () => ({ key: pem, algorithm: 'ECDSA', digest: 'SHA1' }),
    });
    expect(ok).toBe(true);
  });
});

describe('createEbayPublicKeyFetcher', () => {
  it('caches keys per kid and sends the application token', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(EBAY_SAMPLE.publicKey), { status: 200 }));
    const getToken = vi.fn(async () => 'app-token');
    const fetcher = createEbayPublicKeyFetcher(getToken, fetchImpl as unknown as typeof fetch);

    await fetcher(EBAY_SAMPLE.kid);
    await fetcher(EBAY_SAMPLE.kid);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.ebay.com/commerce/notification/v1/public_key/${EBAY_SAMPLE.kid}`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer app-token');
  });

  it('throws when eBay does not return the key', async () => {
    const fetcher = createEbayPublicKeyFetcher(
      async () => 'app-token',
      (async () => new Response('', { status: 401 })) as unknown as typeof fetch
    );
    await expect(fetcher('kid')).rejects.toThrow('401');
  });
});

describe('handleDeletionNotification', () => {
  it('verifies, deletes the user’s data, and acknowledges with 204', async () => {
    const { store, deleteEbayUserData } = recordingStore();
    const result = await handleDeletionNotification({
      rawBody: sampleRawBody,
      signatureHeader: EBAY_SAMPLE.signature,
      getPublicKey: sampleKeyFetcher(),
      store,
    });

    expect(result.status).toBe(204);
    expect(deleteEbayUserData).toHaveBeenCalledWith({
      notificationId: EBAY_SAMPLE.message.notification.notificationId,
      userId: 'ma8vp1jySJC',
      username: 'test_user',
    });
    expect(result.logMessage).not.toContain('test_user');
    expect(result.logMessage).not.toContain('ma8vp1jySJC');
    expect(result.logMessage).not.toContain('eiasToken');
  });

  it('returns 412 and deletes nothing when the signature is invalid', async () => {
    const { store, deleteEbayUserData } = recordingStore();
    const tampered = structuredClone(EBAY_SAMPLE.message);
    tampered.notification.data.userId = 'otherUser';
    const result = await handleDeletionNotification({
      rawBody: JSON.stringify(tampered),
      signatureHeader: EBAY_SAMPLE.signature,
      getPublicKey: sampleKeyFetcher(),
      store,
    });

    expect(result.status).toBe(412);
    expect(deleteEbayUserData).not.toHaveBeenCalled();
  });

  it('returns 500 so eBay retries when the public key cannot be fetched', async () => {
    const { store, deleteEbayUserData } = recordingStore();
    const result = await handleDeletionNotification({
      rawBody: sampleRawBody,
      signatureHeader: EBAY_SAMPLE.signature,
      getPublicKey: async () => {
        throw new Error('network down');
      },
      store,
    });

    expect(result.status).toBe(500);
    expect(deleteEbayUserData).not.toHaveBeenCalled();
  });

  it('returns 500 so eBay retries when deletion fails', async () => {
    const store: DeletionStore = {
      deleteEbayUserData: async () => {
        throw new Error('database locked');
      },
    };
    const result = await handleDeletionNotification({
      rawBody: sampleRawBody,
      signatureHeader: EBAY_SAMPLE.signature,
      getPublicKey: sampleKeyFetcher(),
      store,
    });
    expect(result.status).toBe(500);
  });

  it('rejects malformed bodies with 400', async () => {
    const { store } = recordingStore();
    for (const rawBody of ['not json', '{}', JSON.stringify({ metadata: {}, notification: {} })]) {
      const result = await handleDeletionNotification({
        rawBody,
        signatureHeader: EBAY_SAMPLE.signature,
        getPublicKey: sampleKeyFetcher(),
        store,
      });
      expect(result.status).toBe(400);
    }
  });
});

// In-memory stand-in for the Prisma client so the real deletion logic runs without touching a database.
function fakePrisma(seed: {
  connections: { userEmail: string; ebayUserId: string | null; ebayUsername: string | null }[];
  cards: { id: string; userEmail: string; ebayItemId: string | null; listings: string | null }[];
}) {
  const state = {
    connections: seed.connections.map((c) => ({ ...c })),
    cards: seed.cards.map((c) => ({ ...c, ebayListedAt: c.ebayItemId ? new Date() : null })),
    notifications: [] as { notificationId: string; connectionsDeleted: number; cardsCleared: number }[],
  };

  const tx = {
    ebayDeletionNotification: {
      findUnique: async ({ where }: { where: { notificationId: string } }) =>
        state.notifications.find((n) => n.notificationId === where.notificationId) ?? null,
      create: async ({ data }: { data: (typeof state.notifications)[number] }) => {
        if (state.notifications.some((n) => n.notificationId === data.notificationId)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        state.notifications.push(data);
        return data;
      },
    },
    ebayConnection: {
      findMany: async ({ where }: { where: { OR: Record<string, { in: string[] }>[] } }) => {
        const ids = where.OR[0].ebayUserId.in;
        return state.connections
          .filter((c) => ids.includes(c.ebayUserId ?? '') || ids.includes(c.ebayUsername ?? ''))
          .map((c) => ({ userEmail: c.userEmail }));
      },
      deleteMany: async ({ where }: { where: { userEmail: { in: string[] } } }) => {
        const before = state.connections.length;
        state.connections = state.connections.filter((c) => !where.userEmail.in.includes(c.userEmail));
        return { count: before - state.connections.length };
      },
    },
    cardItem: {
      updateMany: async ({ where }: { where: { lot: { userEmail: { in: string[] } } } }) => {
        let count = 0;
        for (const card of state.cards) {
          if (card.ebayItemId && where.lot.userEmail.in.includes(card.userEmail)) {
            card.ebayItemId = null;
            card.ebayListedAt = null;
            card.listings = null;
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  const client = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  return { client: client as unknown as PrismaClient, state };
}

describe('createPrismaDeletionStore', () => {
  const seed = () =>
    fakePrisma({
      connections: [
        { userEmail: 'me@example.com', ebayUserId: 'ma8vp1jySJC', ebayUsername: 'test_user' },
        { userEmail: 'friend@example.com', ebayUserId: 'friendId', ebayUsername: 'friend_user' },
      ],
      cards: [
        { id: 'c1', userEmail: 'me@example.com', ebayItemId: '111', listings: 'https://www.ebay.com/itm/111' },
        { id: 'c2', userEmail: 'me@example.com', ebayItemId: null, listings: null },
        { id: 'c3', userEmail: 'friend@example.com', ebayItemId: '333', listings: 'https://www.ebay.com/itm/333' },
      ],
    });

  it('deletes only the matching user’s connection and listing references', async () => {
    const { client, state } = seed();
    const store = createPrismaDeletionStore(client);

    const outcome = await store.deleteEbayUserData({
      notificationId: 'n-1',
      userId: 'ma8vp1jySJC',
      username: 'test_user',
    });

    expect(outcome).toEqual({ duplicate: false, connectionsDeleted: 1, cardsCleared: 1 });
    expect(state.connections.map((c) => c.userEmail)).toEqual(['friend@example.com']);
    expect(state.cards.find((c) => c.id === 'c1')).toMatchObject({ ebayItemId: null, listings: null, ebayListedAt: null });
    expect(state.cards.find((c) => c.id === 'c3')?.ebayItemId).toBe('333');
    expect(state.notifications).toEqual([{ notificationId: 'n-1', connectionsDeleted: 1, cardsCleared: 1 }]);
  });

  it('matches on username when the stored user id is missing', async () => {
    const { client, state } = fakePrisma({
      connections: [{ userEmail: 'me@example.com', ebayUserId: null, ebayUsername: 'test_user' }],
      cards: [],
    });
    const outcome = await createPrismaDeletionStore(client).deleteEbayUserData({
      notificationId: 'n-2',
      userId: 'ma8vp1jySJC',
      username: 'test_user',
    });
    expect(outcome.connectionsDeleted).toBe(1);
    expect(state.connections).toHaveLength(0);
  });

  it('treats a retried notification as already processed', async () => {
    const { client, state } = seed();
    const store = createPrismaDeletionStore(client);
    const request = { notificationId: 'n-3', userId: 'ma8vp1jySJC', username: 'test_user' };

    await store.deleteEbayUserData(request);
    state.connections.push({ userEmail: 'me@example.com', ebayUserId: 'ma8vp1jySJC', ebayUsername: 'test_user' });
    const second = await store.deleteEbayUserData(request);

    expect(second).toEqual({ duplicate: true, connectionsDeleted: 0, cardsCleared: 0 });
    expect(state.notifications).toHaveLength(1);
  });

  it('succeeds and records the notification when LotLister stores nothing for the user', async () => {
    const { client, state } = seed();
    const outcome = await createPrismaDeletionStore(client).deleteEbayUserData({
      notificationId: 'n-4',
      userId: 'unknownUser',
      username: 'unknown_user',
    });

    expect(outcome).toEqual({ duplicate: false, connectionsDeleted: 0, cardsCleared: 0 });
    expect(state.connections).toHaveLength(2);
    expect(state.notifications).toHaveLength(1);
  });
});
