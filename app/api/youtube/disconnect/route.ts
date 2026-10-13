import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserEmail } from '../../../../lib/auth';
import { disconnectConnection, safeClientMessage } from '../../../../lib/youtube/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const accountId = await getUserEmail();
  if (!accountId) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  const parsed = z.object({ connectionId: z.string().trim().min(8).max(40) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Choose a YouTube connection to disconnect' }, { status: 400 });
  try {
    const data = await disconnectConnection(accountId, parsed.data.connectionId);
    return NextResponse.json({
      success: true,
      data: {
        ...data,
        note: data.revoked
          ? 'Disconnected and revoked the Google grant.'
          : 'Removed the connection in LotLister. Also remove LotLister at https://myaccount.google.com/permissions if Google still lists it.',
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeClientMessage(error) }, { status: 400 });
  }
}
