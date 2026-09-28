import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { getUserEmail } from '../../../../../lib/auth';
import { getPublicBaseUrl, listLotOnEbay } from '../../../../../lib/ebay';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const userEmail = await getUserEmail();
    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
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
      return NextResponse.json({ success: false, error: 'Lot not found' }, { status: 404 });
    }
    if (!lot.exportProfile) {
      return NextResponse.json(
        { success: false, error: 'Save listing settings (location, shipping, and schedule) before listing' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const tzOffset = Number((body as { tzOffset?: unknown }).tzOffset);
    const clientTzOffsetMinutes = Number.isFinite(tzOffset) ? tzOffset : 0;
    const imageBaseUrl = getPublicBaseUrl(request.nextUrl.origin);

    const summary = await listLotOnEbay({
      userEmail,
      cards: lot.cardItems,
      profile: lot.exportProfile,
      imageBaseUrl,
      clientTzOffsetMinutes,
    });

    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list on eBay';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
