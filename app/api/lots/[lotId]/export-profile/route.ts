import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { exportProfileSchema } from '../../../../../lib/validation';
import { ExportProfile } from '@prisma/client';
import { ApiResponse } from '../../../../../lib/types';
import { getUserEmail } from '../../../../../lib/auth';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

// Helper to verify lot ownership
async function verifyLotOwnership(lotId: string, userEmail: string) {
  return prisma.lot.findFirst({ where: { id: lotId, userEmail } });
}

// GET /api/lots/[lotId]/export-profile - Get export profile for a lot
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<ExportProfile | null>>> {
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
    
    const profile = await prisma.exportProfile.findUnique({
      where: { lotId },
    });

    return NextResponse.json({ success: true, data: profile });
  } catch (error) {
    console.error('Failed to fetch export profile:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch export profile' },
      { status: 500 }
    );
  }
}

// PUT /api/lots/[lotId]/export-profile - Create or update export profile
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<ExportProfile>>> {
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
    const validation = exportProfileSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    
    // Upsert the profile
    const profile = await prisma.exportProfile.upsert({
      where: { lotId },
      update: validation.data,
      create: {
        lotId,
        ...validation.data,
      },
    });

    return NextResponse.json({ success: true, data: profile });
  } catch (error) {
    console.error('Failed to save export profile:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save export profile' },
      { status: 500 }
    );
  }
}
