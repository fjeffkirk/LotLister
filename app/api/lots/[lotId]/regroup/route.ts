import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { regroupLotImages } from '../../../../../lib/grouping';
import { ApiResponse } from '../../../../../lib/types';
import { getUserEmail } from '../../../../../lib/auth';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

interface RegroupResult {
  cardsCreated: number;
}

// POST /api/lots/[lotId]/regroup - Regroup images with new images per card setting
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<RegroupResult>>> {
  try {
    const userEmail = await getUserEmail();
    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
    }

    const { lotId } = await params;
    const body = await request.json();
    const imagesPerCard = parseInt(body.imagesPerCard) || 2;
    
    // Verify lot exists and belongs to user
    const lot = await prisma.lot.findFirst({
      where: { id: lotId, userEmail },
    });
    
    if (!lot) {
      return NextResponse.json(
        { success: false, error: 'Lot not found' },
        { status: 404 }
      );
    }
    
    // Regroup images
    await regroupLotImages(lotId, imagesPerCard);
    
    // Count new cards
    const count = await prisma.cardItem.count({
      where: { lotId },
    });
    
    return NextResponse.json({
      success: true,
      data: {
        cardsCreated: count,
      },
    });
  } catch (error) {
    console.error('Failed to regroup images:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to regroup images' },
      { status: 500 }
    );
  }
}
