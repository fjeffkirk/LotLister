import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { tiktokError, tiktokJson } from '../../../../lib/tiktok/http';
import { performance } from '../../../../lib/tiktok/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const accountId = await getUserEmail();
  if (!accountId) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  const advertiserId = request.nextUrl.searchParams.get('advertiserId') ?? '';
  const end = request.nextUrl.searchParams.get('endDate');
  const start = request.nextUrl.searchParams.get('startDate');
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  try {
    return tiktokJson(await performance(accountId, {
      advertiserId,
      startDate: start || weekAgo,
      endDate: end || today,
      breakdown: 'day',
      level: 'campaign',
      report: request.nextUrl.searchParams.get('report') === 'gmv_max' ? 'gmv_max' : 'auction',
      managedOnly: false,
    }));
  } catch (error) {
    return tiktokError(error);
  }
}
