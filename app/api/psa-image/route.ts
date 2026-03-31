import { NextRequest, NextResponse } from 'next/server';
import { PSA_IMAGE_FETCH_HEADERS } from '../../../lib/psa';

const ALLOWED_HOST = 'cert-images.psa.com';

/**
 * Proxy PSA cert scans for the UI. Direct browser loads from cert-images.psa.com are often blocked
 * (referrer / hotlink rules); eBay and exports still use the raw https URL stored on CardImage.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const raw = request.nextUrl.searchParams.get('u');
  if (!raw?.trim()) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw.trim());
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  if (target.protocol !== 'https:' || target.hostname !== ALLOWED_HOST) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: PSA_IMAGE_FETCH_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Image not available' },
        { status: upstream.status === 404 ? 404 : 502 }
      );
    }

    const buf = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 });
  }
}
