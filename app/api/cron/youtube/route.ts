import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { processPendingYoutubeJobs } from '@/lib/youtube/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Optional recovery ping for YouTube upload jobs. Uses the existing CRON_SECRET.
 * A separate Render cron service is not declared in render.yaml because it can add cost.
 * Happy-path uploads also continue in-process after the MCP response.
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
  const result = await processPendingYoutubeJobs({ budgetMs: 240_000, maxJobs: 2 });
  return NextResponse.json({ ok: true, ...result });
}
