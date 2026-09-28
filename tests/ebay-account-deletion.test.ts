import { createHash, generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  computeChallengeResponse,
  createEbayPublicKeyFetcher,
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

function recordingStore(outcome = { duplicate: false, connectionsDeleted: 1, lotsDeleted: 1, cardsCleared: 2 }) {
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
