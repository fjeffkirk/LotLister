import { NextRequest } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { getUserEmail } from '../../../../../lib/auth';
import { getPublicBaseUrl, listLotOnEbay } from '../../../../../lib/ebay';
import type { EbayListEvent } from '../../../../../lib/list-progress';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function jsonError(error: string, status: number) {
  return Response.json({ success: false, error }, { status });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const userEmail = await getUserEmail();
  if (!userEmail) {
    return jsonError('User email not set', 401);
  }

  const { lotId } = await params;
  const lot = await prisma.lot.findFirst({
    where: { id: lotId, userEmail },
    include: {
      cardItems: {
        include: { images: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
      exportProfile: true,
    },
  });

  if (!lot) {
    return jsonError('Lot not found', 404);
  }
  if (!lot.exportProfile) {
    return jsonError('Save listing settings (location, shipping, and schedule) before listing', 400);
  }

  const body = await request.json().catch(() => ({}));
  const tzOffset = Number((body as { tzOffset?: unknown }).tzOffset);
  const clientTzOffsetMinutes = Number.isFinite(tzOffset) ? tzOffset : 0;
  const imageBaseUrl = getPublicBaseUrl(request.nextUrl.origin);
  const profile = lot.exportProfile;
  const cards = lot.cardItems;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: EbayListEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        // A short line can sit in a proxy buffer until the whole batch ends.
        controller.enqueue(encoder.encode(`${' '.repeat(2048)}\n`));
      };
      try {
        await listLotOnEbay({
          userEmail,
          cards,
          profile,
          imageBaseUrl,
          clientTzOffsetMinutes,
          onEvent: send,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list on eBay';
        send({ type: 'error', error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
