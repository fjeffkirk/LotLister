import { NextRequest, NextResponse } from 'next/server';
import { fromZonedTime } from 'date-fns-tz';
import { getUserEmail } from '../../../lib/auth';
import { DateRangeKey, rangeToDates } from '../../../lib/dates';
import { getDashboardData } from '../../../lib/ebay-dashboard';
import { getShopifyDashboard } from '../../../lib/shopify-dashboard';

export const dynamic = 'force-dynamic';

const PRESETS = new Set(['1d', 'yesterday', '7d', '30d', '90d']);
const NY = 'America/New_York';
const DAY = 24 * 60 * 60 * 1000;

function dashboardWindow(request: NextRequest): { from: Date; to: Date; key: DateRangeKey | null } {
  const fromParam = request.nextUrl.searchParams.get('from');
  const toParam = request.nextUrl.searchParams.get('to');
  const dated = /^\d{4}-\d{2}-\d{2}$/;
  if (fromParam && toParam && dated.test(fromParam) && dated.test(toParam)) {
    const startDay = fromParam <= toParam ? fromParam : toParam;
    const endDay = fromParam <= toParam ? toParam : fromParam;
    let from = fromZonedTime(`${startDay}T00:00:00`, NY);
    const to = fromZonedTime(`${endDay}T23:59:59.999`, NY);
    if (to.getTime() - from.getTime() > 366 * DAY) from = new Date(to.getTime() - 366 * DAY);
    return { from, to, key: null };
  }
  const raw = request.nextUrl.searchParams.get('range') ?? '1d';
  const key = (PRESETS.has(raw) ? raw : '1d') as DateRangeKey;
  return { ...rangeToDates(key), key };
}

// GET /api/dashboard?range=1d|yesterday|7d|30d|90d or ?from=&to= - Live eBay + Shopify numbers
export async function GET(request: NextRequest) {
  const userEmail = await getUserEmail();
  if (!userEmail) {
    return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  }

  const tz = Number.parseInt(request.nextUrl.searchParams.get('tz') ?? '0', 10);
  const tzOffsetMinutes = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0;
  const window = dashboardWindow(request);

  try {
    const [ebay, shopify] = await Promise.all([
      getDashboardData(userEmail, tzOffsetMinutes, window),
      getShopifyDashboard(window),
    ]);
    return NextResponse.json(
      { success: true, data: { ...ebay, shopify } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Dashboard load failed:', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not load dashboard data' }, { status: 500 });
  }
}
