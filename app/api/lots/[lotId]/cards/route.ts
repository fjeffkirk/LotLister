import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { bulkUpdateCardItemsSchema, updateCardItemSchema } from '../../../../../lib/validation';
import { ApiResponse, CardItemWithImages } from '../../../../../lib/types';
import { getUserEmail } from '../../../../../lib/auth';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

// Helper to verify lot ownership
async function verifyLotOwnership(lotId: string, userEmail: string) {
  return prisma.lot.findFirst({ where: { id: lotId, userEmail } });
}

// GET /api/lots/[lotId]/cards - Get all card items for a lot
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<CardItemWithImages[]>>> {
  try {
    const userEmail = await getUserEmail();
    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
    }

    const { lotId } = await params;
    
    // Verify ownership
    const lot = await verifyLotOwnership(lotId, userEmail);
    if (!lot) {
      return NextResponse.json({ success: false, error: 'Lot not found' }, { status: 404 });
    }
    
    const cards = await prisma.cardItem.findMany({
      where: { lotId },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json({ success: true, data: cards });
  } catch (error) {
    console.error('Failed to fetch cards:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cards' },
      { status: 500 }
    );
  }
}

// PATCH /api/lots/[lotId]/cards - Bulk update card items
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<CardItemWithImages[]>>> {
  try {
    const userEmail = await getUserEmail();
    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
    }

    const { lotId } = await params;
    
    // Verify ownership
    const lot = await verifyLotOwnership(lotId, userEmail);
    if (!lot) {
      return NextResponse.json({ success: false, error: 'Lot not found' }, { status: 404 });
    }

    const body = await request.json();
    
    // Validate input
    const validation = bulkUpdateCardItemsSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    
    // Update each card in a transaction
    await prisma.$transaction(
      validation.data.updates.map((update) =>
        prisma.cardItem.update({
          where: { id: update.id, lotId },
          data: update.data,
        })
      )
    );
    
    // Fetch updated cards
    const cards = await prisma.cardItem.findMany({
      where: { lotId },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json({ success: true, data: cards });
  } catch (error) {
    console.error('Failed to update cards:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update cards' },
      { status: 500 }
    );
  }
}
