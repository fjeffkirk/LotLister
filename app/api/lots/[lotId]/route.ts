import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { updateLotSchema } from '../../../../lib/validation';
import { deleteLotImages } from '../../../../lib/storage';
import { ApiResponse, LotWithCards } from '../../../../lib/types';
import { getUserEmail } from '../../../../lib/auth';
import { fillEmptyFromDefaults, sanitizeCardDefaults } from '../../../../lib/card-fields';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

// Helper to verify lot ownership
async function verifyLotOwnership(lotId: string, userEmail: string) {
  const lot = await prisma.lot.findFirst({
    where: { id: lotId, userEmail },
  });
  return lot;
}

// GET /api/lots/[lotId] - Get a single lot with all data
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<LotWithCards>>> {
  try {
    const userEmail = await getUserEmail();
    
    if (!userEmail) {
      return NextResponse.json(
        { success: false, error: 'User email not set' },
        { status: 401 }
      );
    }

    const { lotId } = await params;
    
    const lot = await prisma.lot.findFirst({
      where: { id: lotId, userEmail },
      include: {
        cardItems: {
          include: {
            images: { orderBy: { sortOrder: 'asc' } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        exportProfile: true,
      },
    });

    if (!lot) {
      return NextResponse.json(
        { success: false, error: 'Lot not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: lot });
  } catch (error) {
    console.error('Failed to fetch lot:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch lot' },
      { status: 500 }
    );
  }
}

// PATCH /api/lots/[lotId] - Update a lot
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<LotWithCards>>> {
  try {
    const userEmail = await getUserEmail();
    
    if (!userEmail) {
      return NextResponse.json(
        { success: false, error: 'User email not set' },
        { status: 401 }
      );
    }

    const { lotId } = await params;
    
    // Verify ownership
    const existingLot = await verifyLotOwnership(lotId, userEmail);
    if (!existingLot) {
      return NextResponse.json(
        { success: false, error: 'Lot not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    
    // Validate input
    const validation = updateLotSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    // Build update data, handling completedAt automatically
    const { cardDefaults, fillExisting, ...lotFields } = validation.data;
    const updateData: Record<string, unknown> = { ...lotFields };

    if (cardDefaults) {
      const defaults = sanitizeCardDefaults(cardDefaults);
      updateData.cardDefaults = JSON.stringify(defaults);
      if (fillExisting) {
        const cards = await prisma.cardItem.findMany({ where: { lotId } });
        const updates = cards
          .map((card) => ({ id: card.id, data: fillEmptyFromDefaults(card, defaults) }))
          .filter((update) => Object.keys(update.data).length > 0);
        if (updates.length > 0) {
          await prisma.$transaction(
            updates.map((update) => prisma.cardItem.update({ where: { id: update.id }, data: update.data }))
          );
        }
      }
    }
    
    // Check if we're newly marking as completed (wasn't completed before)
    const isNewlyCompleted = validation.data.completed === true && !existingLot.completed;
    
    // If marking as completed, set completedAt to now
    // If marking as not completed, clear completedAt
    if (validation.data.completed === true) {
      updateData.completedAt = new Date();
    } else if (validation.data.completed === false) {
      updateData.completedAt = null;
    }

    const lot = await prisma.lot.update({
      where: { id: lotId },
      data: updateData,
      include: {
        cardItems: {
          include: {
            images: { orderBy: { sortOrder: 'asc' } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        exportProfile: true,
      },
    });

    // If newly completed, increment the user's completed count
    if (isNewlyCompleted) {
      await prisma.user.upsert({
        where: { email: userEmail },
        update: { completedCount: { increment: 1 } },
        create: { email: userEmail, completedCount: 1 },
      });
    }

    return NextResponse.json({ success: true, data: lot });
  } catch (error) {
    console.error('Failed to update lot:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update lot' },
      { status: 500 }
    );
  }
}

// DELETE /api/lots/[lotId] - Delete a lot
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<{ id: string }>>> {
  try {
    const userEmail = await getUserEmail();
    
    if (!userEmail) {
      return NextResponse.json(
        { success: false, error: 'User email not set' },
        { status: 401 }
      );
    }

    const { lotId } = await params;
    
    // Verify ownership
    const existingLot = await verifyLotOwnership(lotId, userEmail);
    if (!existingLot) {
      return NextResponse.json(
        { success: false, error: 'Lot not found' },
        { status: 404 }
      );
    }
    
    // Delete images from filesystem
    await deleteLotImages(lotId);
    
    // Delete from database (cascades to cardItems, images, exportProfile)
    await prisma.lot.delete({
      where: { id: lotId },
    });

    return NextResponse.json({ success: true, data: { id: lotId } });
  } catch (error) {
    console.error('Failed to delete lot:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete lot' },
      { status: 500 }
    );
  }
}
