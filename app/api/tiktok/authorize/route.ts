import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserEmail } from '../../../../lib/auth';
import { tiktokError, tiktokJson } from '../../../../lib/tiktok/http';
import { authorizePreview } from '../../../../lib/tiktok/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ previewId: z.string().min(8).max(40) }).strict();

export async function POST(request: NextRequest) {
  const accountId = await getUserEmail();
  if (!accountId) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 });
  try {
    const body = bodySchema.parse(await request.json());
    return tiktokJson(await authorizePreview(accountId, body.previewId));
  } catch (error) {
    return tiktokError(error);
  }
}
