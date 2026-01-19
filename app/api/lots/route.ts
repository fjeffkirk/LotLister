import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { createLotSchema } from '../../../lib/validation';
import { ApiResponse, LotWithCount } from '../../../lib/types';

// GET /api/lots - List all lots
export async function GET(): Promise<NextResponse<ApiResponse<LotWithCount[]>>> {
  try {
    const lots = await prisma.lot.findMany({
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

// POST /api/lots - Create a new lot
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<LotWithCount>>> {
  try {
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
