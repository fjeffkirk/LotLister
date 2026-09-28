import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../lib/prisma', () => ({ default: {} }));
vi.mock('../lib/ebay', () => ({ getEbayApplicationToken: vi.fn(async () => 'app-token') }));
vi.mock('../lib/storage', () => ({ deleteLotImages: vi.fn(async () => undefined) }));

const { GET, POST } = await import('../app/api/ebay/account-deletion/route');

const TOKEN = '0123456789abcdef'.repeat(4);
const ENDPOINT = 'https://lotlister.example.com/api/ebay/account-deletion';

describe('GET /api/ebay/account-deletion', () => {
  beforeEach(() => {
    vi.stubEnv('EBAY_DELETION_VERIFICATION_TOKEN', TOKEN);
    vi.stubEnv('EBAY_DELETION_ENDPOINT_URL', ENDPOINT);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers the challenge with 200 JSON', async () => {
    const res = await GET(new NextRequest(`http://localhost/api/ebay/account-deletion?challenge_code=abc123`));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      challengeResponse: createHash('sha256').update(`abc123${TOKEN}${ENDPOINT}`).digest('hex'),
    });
  });

  it('uses the configured endpoint URL, not the request host', async () => {
    const res = await GET(new NextRequest(`http://internal-host:10000/api/ebay/account-deletion?challenge_code=abc123`));
    const body = await res.json();
    expect(body.challengeResponse).toBe(createHash('sha256').update(`abc123${TOKEN}${ENDPOINT}`).digest('hex'));
  });

  it('returns 400 without challenge_code', async () => {
    const res = await GET(new NextRequest('http://localhost/api/ebay/account-deletion'));
    expect(res.status).toBe(400);
  });

  it('returns 500 without leaking config when env vars are missing', async () => {
    vi.stubEnv('EBAY_DELETION_VERIFICATION_TOKEN', '');
    const res = await GET(new NextRequest('http://localhost/api/ebay/account-deletion?challenge_code=abc'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(ENDPOINT);
  });
});

describe('POST /api/ebay/account-deletion', () => {
  it('rejects unsigned notifications with 412', async () => {
    const body = JSON.stringify({
      metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
      notification: { notificationId: 'n-1', data: { userId: 'u', username: 'name' } },
    });
    const res = await POST(
      new NextRequest('http://localhost/api/ebay/account-deletion', { method: 'POST', body })
    );
    expect(res.status).toBe(412);
  });

  it('rejects non-JSON bodies with 400', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/ebay/account-deletion', { method: 'POST', body: 'nope' })
    );
    expect(res.status).toBe(400);
  });
});
