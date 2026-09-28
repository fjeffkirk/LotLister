import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { createLotSchema } from '../../../lib/validation';
import { ApiResponse, CardItemWithImages, LotSummary, LotWithCount } from '../../../lib/types';
import { isCardComplete } from '../../../lib/card-completeness';
import { imagePathToBrowserSrc } from '../../../lib/imageUrls';
import { getUserEmail } from '../../../lib/auth';
import { deleteLotImages } from '../../../lib/storage';
import { COMPLETED_DELETE_DAYS, MAX_LOT_AGE_DAYS } from '../../../lib/card-fields';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const SUMMARY_THUMBNAILS = 4;

function summarizeCards(cards: CardItemWithImages[]): LotSummary {
  let readyCount = 0;
  let listedCount = 0;
  let totalValue = 0;
  const thumbnails: string[] = [];
  for (const card of cards) {
    if (card.ebayItemId) listedCount++;
    else if (isCardComplete(card)) readyCount++;
    if (typeof card.salePrice === 'number') totalValue += card.salePrice;
    const image = card.images[0];
    if (image && thumbnails.length < SUMMARY_THUMBNAILS) thumbnails.push(imagePathToBrowserSrc(image.thumbPath || image.originalPath));
  }
  return { readyCount, listedCount, totalValue: Math.round(totalValue * 100) / 100, thumbnails };
}
let lastCleanupAt = 0;

// Deletes lots past their retention (see lotDeletesAt). Runs at most hourly, triggered by the lots list.
async function cleanupOldLots(): Promise<void> {
  if (Date.now() - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = Date.now();
  try {
    const completedCutoff = new Date();
    completedCutoff.setDate(completedCutoff.getDate() - COMPLETED_DELETE_DAYS);
    
    const ageCutoff = new Date();
    ageCutoff.setDate(ageCutoff.getDate() - MAX_LOT_AGE_DAYS);
    
    // Find lots to delete: completed > 10 days OR any lot > 30 days old
    const oldLots = await prisma.lot.findMany({
      where: {
        OR: [
          // Completed lots older than 10 days
          {
            completed: true,
            completedAt: {
              lt: completedCutoff,
              not: null,
            },
          },
          // Any lot older than 30 days
          {
            createdAt: {
              lt: ageCutoff,
            },
          },
        ],
      },
      select: { id: true },
    });
    
    // Delete images and lots
    for (const lot of oldLots) {
      try {
        await deleteLotImages(lot.id);
        await prisma.lot.delete({ where: { id: lot.id } });
        console.log(`Auto-deleted old lot: ${lot.id}`);
      } catch (err) {
        console.error(`Failed to auto-delete lot ${lot.id}:`, err);
      }
    }
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

// GET /api/lots - List all lots for the current user
export async function GET(): Promise<NextResponse<ApiResponse<LotWithCount[]>>> {
  try {
    const userEmail = await getUserEmail();
    
    if (!userEmail) {
      return NextResponse.json(
        { success: false, error: 'User email not set' },
        { status: 401 }
      );
    }

    // Run cleanup in background (don't await to not slow down response)
    cleanupOldLots();

    const lots = await prisma.lot.findMany({
      where: { userEmail },
      include: {
        _count: {
          select: { cardItems: true },
        },
        cardItems: {
          orderBy: { sortOrder: 'asc' },
          include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = lots.map(({ cardItems, ...lot }) => ({ ...lot, summary: summarizeCards(cardItems) }));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Failed to fetch lots:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch lots' },
      { status: 500 }
    );
  }
}

// POST /api/lots - Create a new lot for the current user
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<LotWithCount>>> {
  try {
    const userEmail = await getUserEmail();
    
    if (!userEmail) {
      return NextResponse.json(
        { success: false, error: 'User email not set' },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Validate input
    const validation = createLotSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    const lot = await prisma.lot.create({
      data: {
        name: validation.data.name,
        userEmail,
      },
      include: {
        _count: {
          select: { cardItems: true },
        },
      },
    });

    return NextResponse.json({ success: true, data: lot }, { status: 201 });
  } catch (error) {
    console.error('Failed to create lot:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create lot' },
      { status: 500 }
    );
  }
}
