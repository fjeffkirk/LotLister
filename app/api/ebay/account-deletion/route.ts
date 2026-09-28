import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { getEbayApplicationToken } from '../../../../lib/ebay';
import {
  computeChallengeResponse,
  createEbayPublicKeyFetcher,
  createPrismaDeletionStore,
  getDeletionConfig,
  handleDeletionNotification,
} from '../../../../lib/ebay-account-deletion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const getPublicKey = createEbayPublicKeyFetcher(getEbayApplicationToken);
const store = createPrismaDeletionStore(prisma);

// GET /api/ebay/account-deletion?challenge_code=... - eBay endpoint verification
export async function GET(request: NextRequest) {
  const challengeCode = request.nextUrl.searchParams.get('challenge_code');
  if (!challengeCode) {
    return NextResponse.json({ error: 'challenge_code is required' }, { status: 400 });
  }

  const config = getDeletionConfig();
  if (!config) {
    console.error('[eBay account deletion] EBAY_DELETION_VERIFICATION_TOKEN or EBAY_DELETION_ENDPOINT_URL is not set');
    return NextResponse.json({ error: 'Endpoint is not configured' }, { status: 500 });
  }

  const challengeResponse = computeChallengeResponse(challengeCode, config.verificationToken, config.endpointUrl);
  return NextResponse.json(
    { challengeResponse },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

// POST /api/ebay/account-deletion - Marketplace Account Deletion notification
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const result = await handleDeletionNotification({
    rawBody,
    signatureHeader: request.headers.get('x-ebay-signature'),
    getPublicKey,
    store,
  });

  if (result.status >= 500) {
    console.error(`[eBay account deletion] ${result.logMessage}`);
  } else if (result.status >= 400) {
    console.warn(`[eBay account deletion] ${result.logMessage}`);
  } else {
    console.log(`[eBay account deletion] ${result.logMessage}`);
  }

  return new NextResponse(null, { status: result.status });
}
