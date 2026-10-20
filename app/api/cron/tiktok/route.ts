import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { runAllScheduledReviews } from '@/lib/tiktok/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Optional review ping. Uses the existing CRON_SECRET.
 * A separate Render cron service is not declared in render.yaml because it can add cost.
 * The job does nothing until a saved policy has scheduledReviewEnabled.
 * Times shown to the user use America/New_York. Report dates stay in the advertiser timezone.
 */
export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 401 });
  }
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  const auth = request.headers.get('authorization');
  if (secret !== env.CRON_SECRET && auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runAllScheduledReviews(new Date());
  return NextResponse.json({ ok: true, ...result });
}
