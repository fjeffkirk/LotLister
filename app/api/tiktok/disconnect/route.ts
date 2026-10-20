import { NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { tiktokError, tiktokJson } from '../../../../lib/tiktok/http';
import { disconnectTiktok } from '../../../../lib/tiktok/service';

export const dynamic = 'force-dynamic';

export async function POST() {
  const accountId = await getUserEmail();
  if (!accountId) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  try {
    return tiktokJson(await disconnectTiktok(accountId));
  } catch (error) {
    return tiktokError(error);
  }
}
