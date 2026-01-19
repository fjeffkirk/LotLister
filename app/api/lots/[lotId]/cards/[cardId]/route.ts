import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { updateCardItemSchema } from '@/lib/validation';
import { ApiResponse, CardItemWithImages } from '@/lib/types';

interface RouteParams {
  params: Promise<{ lotId: string; cardId: string }>;
}

// PATCH /api/lots/[lotId]/cards/[cardId] - Update a single card item
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<CardItemWithImages>>> {
  try {
    const { lotId, cardId } = await params;
    const body = await request.json();
    
    // Validate input
    const validation = updateCardItemSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    
    // Update the card
    const card = await prisma.cardItem.update({
      where: { id: cardId, lotId },
      data: validation.data,
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });

    return NextResponse.json({ success: true, data: card });
  } catch (error) {
    console.error('Failed to update card:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update card' },
      { status: 500 }
    );
  }
}

// DELETE /api/lots/[lotId]/cards/[cardId] - Delete a card item
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<{ id: string }>>> {
  try {
    const { lotId, cardId } = await params;
    
    await prisma.cardItem.delete({
      where: { id: cardId, lotId },
    });

    return NextResponse.json({ success: true, data: { id: cardId } });
  } catch (error) {
    console.error('Failed to delete card:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete card' },
      { status: 500 }
    );
  }
}
