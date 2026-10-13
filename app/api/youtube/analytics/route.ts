import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { loadYoutubeAnalytics } from '../../../../lib/youtube/analytics';
import { safeClientMessage } from '../../../../lib/youtube/service';
import { YoutubeUserError } from '../../../../lib/youtube/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const accountId = await getUserEmail();
  if (!accountId) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  const connectionId = request.nextUrl.searchParams.get('connectionId');
  const days = Number(request.nextUrl.searchParams.get('days') || '28');
  try {
    const data = await loadYoutubeAnalytics(accountId, connectionId, days);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const status = error instanceof YoutubeUserError && (error.code === 'not_found' || error.code === 'invalid_range' || error.code === 'invalid_channel')
      ? 400
      : 500;
    return NextResponse.json({ success: false, error: safeClientMessage(error) }, { status });
  }
}
