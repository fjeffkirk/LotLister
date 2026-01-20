import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { createLotSchema } from '../../../lib/validation';
import { ApiResponse, LotWithCount } from '../../../lib/types';
import { getUserEmail } from '../../../lib/auth';
import { deleteLotImages } from '../../../lib/storage';

// Auto-delete completed lots after this many days
const AUTO_DELETE_DAYS = 10;

// Cleanup old completed lots (runs on each GET request)
async function cleanupOldCompletedLots(): Promise<void> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - AUTO_DELETE_DAYS);
    
    // Find lots to delete
    const oldLots = await prisma.lot.findMany({
      where: {
        completed: true,
        completedAt: {
          lt: cutoffDate,
          not: null,
        },
      },
      select: { id: true },
    });
    
    // Delete images and lots
    for (const lot of oldLots) {
      try {
        await deleteLotImages(lot.id);
        await prisma.lot.delete({ where: { id: lot.id } });
        console.log(`Auto-deleted completed lot: ${lot.id}`);
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
    cleanupOldCompletedLots();

    const lots = await prisma.lot.findMany({
      where: { userEmail },
      include: {
        _count: {
          select: { cardItems: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: lots });
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
