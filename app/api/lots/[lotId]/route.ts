import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { updateLotSchema } from '@/lib/validation';
import { deleteLotImages } from '@/lib/storage';
import { ApiResponse, LotWithCards } from '@/lib/types';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

// GET /api/lots/[lotId] - Get a single lot with all data
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<LotWithCards>>> {
  try {
    const { lotId } = await params;
    
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      include: {
        cardItems: {
          include: { images: true },
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
    const { lotId } = await params;
    const body = await request.json();
    
    // Validate input
    const validation = updateLotSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    const lot = await prisma.lot.update({
      where: { id: lotId },
      data: validation.data,
      include: {
        cardItems: {
          include: { images: true },
          orderBy: { sortOrder: 'asc' },
        },
        exportProfile: true,
      },
    });

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
    const { lotId } = await params;
    
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
