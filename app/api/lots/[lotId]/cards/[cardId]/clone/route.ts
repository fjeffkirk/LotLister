import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../../../lib/prisma';
import { ApiResponse, CardItemWithImages } from '../../../../../../../lib/types';

interface RouteParams {
  params: Promise<{ lotId: string; cardId: string }>;
}

// POST /api/lots/[lotId]/cards/[cardId]/clone - Clone a card item
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<CardItemWithImages>>> {
  try {
    const { lotId, cardId } = await params;
    
    // Fetch the card to clone with its images
    const originalCard = await prisma.cardItem.findUnique({
      where: { id: cardId, lotId },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!originalCard) {
      return NextResponse.json(
        { success: false, error: 'Card not found' },
        { status: 404 }
      );
    }

    // Get the max sort order for the lot to place the clone after the original
    const maxSortOrder = await prisma.cardItem.aggregate({
      where: { lotId },
      _max: { sortOrder: true },
    });
    const newSortOrder = (maxSortOrder._max.sortOrder || 0) + 1;

    // Create the cloned card
    const clonedCard = await prisma.cardItem.create({
      data: {
        lotId,
        title: originalCard.title,
        status: 'Draft', // Reset status to Draft for cloned cards
        listings: originalCard.listings,
        salePrice: originalCard.salePrice,
        category: originalCard.category,
        year: originalCard.year,
        brand: originalCard.brand,
        setName: originalCard.setName,
        name: originalCard.name,
        cardNumber: originalCard.cardNumber,
        subsetParallel: originalCard.subsetParallel,
        attributes: originalCard.attributes,
        team: originalCard.team,
        variation: originalCard.variation,
        graded: originalCard.graded,
        grader: originalCard.grader,
        grade: originalCard.grade,
        conditionType: originalCard.conditionType,
        condition: originalCard.condition,
        certNo: originalCard.certNo,
        sortOrder: newSortOrder,
        // Clone images as well
        images: {
          create: originalCard.images.map((img, index) => ({
            originalPath: img.originalPath,
            thumbPath: img.thumbPath,
            filename: img.filename,
            sortOrder: index,
          })),
        },
      },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });

    return NextResponse.json({ success: true, data: clonedCard });
  } catch (error) {
    console.error('Failed to clone card:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to clone card' },
      { status: 500 }
    );
  }
}
