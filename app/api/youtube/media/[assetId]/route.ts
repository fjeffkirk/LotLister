import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { acceptMediaBytes, acceptMediaChunk, finishMediaTransfer, mediaTransferStatus, safeClientMessage } from '../../../../../lib/youtube/service';
import { YoutubeUserError } from '../../../../../lib/youtube/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
interface RouteParams { params: Promise<{ assetId: string }>; }
function failure(error: unknown) {
  const code = error instanceof YoutubeUserError ? error.code : '';
  const status = ['upload_unauthorized', 'upload_expired'].includes(code) ? 401
    : code === 'too_large' ? 413 : code === 'insufficient_storage' ? 507
    : ['already_uploaded', 'upload_busy', 'upload_conflict'].includes(code) ? 409 : 400;
  return NextResponse.json({ success: false, error: safeClientMessage(error), code }, { status });
}
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { assetId } = await params;
  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (!request.body) return NextResponse.json({ success: false, error: 'Send raw file bytes as the request body.' }, { status: 400 });
  try {
    const stream = Readable.fromWeb(request.body as import('stream/web').ReadableStream);
    const range = request.headers.get('content-range');
    const data = range !== null
      ? await acceptMediaChunk(assetId, token, stream, range, request.headers.get('x-upload-sha256') ?? '')
      : await acceptMediaBytes(assetId, token, stream);
    return NextResponse.json({ success: true, data });
  } catch (error) { return failure(error); }
}
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { assetId } = await params;
    return NextResponse.json({ success: true, data: await mediaTransferStatus(assetId, request.nextUrl.searchParams.get('token') ?? '') },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { assetId } = await params;
    const data = await finishMediaTransfer(assetId, request.nextUrl.searchParams.get('token') ?? '', request.headers.get('x-upload-sha256') ?? '');
    return NextResponse.json({ success: true, data });
  } catch (error) { return failure(error); }
}
