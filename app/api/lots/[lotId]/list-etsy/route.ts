import { NextRequest } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { getUserEmail } from '../../../../../lib/auth';
import { listLotOnEtsy } from '../../../../../lib/etsy';
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
  if (!userEmail) return jsonError('Not signed in', 401);

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
  if (!lot) return jsonError('Lot not found', 404);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: EbayListEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        controller.enqueue(encoder.encode(`${' '.repeat(2048)}\n`));
      };
      try {
        await listLotOnEtsy({
          userEmail,
          cards: lot.cardItems,
          profile: lot.exportProfile,
          onEvent: send,
        });
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : 'Failed to list on Etsy' });
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
