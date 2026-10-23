import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { acceptMediaBytes, safeClientMessage } from '../../../../../lib/youtube/service';
import { YoutubeUserError } from '../../../../../lib/youtube/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ assetId: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { assetId } = await params;
  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (!request.body) {
    return NextResponse.json({ success: false, error: 'Send the raw file bytes as the request body.' }, { status: 400 });
  }
  try {
    const stream = Readable.fromWeb(request.body as import('stream/web').ReadableStream);
    const data = await acceptMediaBytes(assetId, token, stream);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const status = error instanceof YoutubeUserError && ['upload_unauthorized', 'upload_expired'].includes(error.code)
      ? 401
      : error instanceof YoutubeUserError && error.code === 'too_large'
        ? 413
        : error instanceof YoutubeUserError && error.code === 'insufficient_storage'
          ? 507
        : error instanceof YoutubeUserError && error.code === 'already_uploaded'
          ? 409
          : 400;
    return NextResponse.json({ success: false, error: safeClientMessage(error) }, { status });
  }
}
