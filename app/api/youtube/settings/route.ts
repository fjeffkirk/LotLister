import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { getPublicBaseUrl } from '../../../../lib/ebay';
import { connectSettings, safeClientMessage } from '../../../../lib/youtube/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const accountId = await getUserEmail();
  if (!accountId) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  try {
    const data = await connectSettings(accountId, getPublicBaseUrl(request.nextUrl.origin));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeClientMessage(error) }, { status: 500 });
  }
}
