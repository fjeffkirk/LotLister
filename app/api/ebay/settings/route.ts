import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { getEbayPublicStatus, getPublicBaseUrl, isEbayReachableBase } from '../../../../lib/ebay';

export async function GET(request: NextRequest) {
  const userEmail = await getUserEmail();
  if (!userEmail) {
    return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
  }

  const status = await getEbayPublicStatus(userEmail);
  const base = getPublicBaseUrl(request.nextUrl.origin);
  return NextResponse.json({
    success: true,
    data: {
      ...status,
      publicBaseUrl: base,
      imagesReachable: isEbayReachableBase(base),
      callbackUrl: `${base}/api/ebay/callback`,
      privacyUrl: `${base}/privacy`,
      declinedUrl: `${base}/settings?ebay=declined`,
    },
  });
}
