import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../lib/auth';
import { getDashboardData } from '../../../lib/ebay-dashboard';

export const dynamic = 'force-dynamic';

// GET /api/dashboard?tz=<Date#getTimezoneOffset()> - Live eBay sales, shipping, and listing numbers
export async function GET(request: NextRequest) {
  const userEmail = await getUserEmail();
  if (!userEmail) {
    return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  }

  const tz = Number.parseInt(request.nextUrl.searchParams.get('tz') ?? '0', 10);
  const tzOffsetMinutes = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0;

  try {
    const data = await getDashboardData(userEmail, tzOffsetMinutes);
    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Dashboard load failed:', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not load eBay data' }, { status: 500 });
  }
}
