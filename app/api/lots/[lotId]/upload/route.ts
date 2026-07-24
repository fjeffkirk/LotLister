import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { groupImages, createCardItemsFromGroups, ImageInfo } from '../../../../../lib/grouping';
import { v4 as uuidv4 } from 'uuid';
import { ApiResponse } from '../../../../../lib/types';
import { getUserEmail } from '../../../../../lib/auth';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

interface UploadResult {
  totalImages: number;
  cardsCreated: number;
}

interface FinalizeImageInput {
  originalPath: string;
  thumbPath: string;
  filename: string;
}

export const maxDuration = 60;

// POST /api/lots/[lotId]/upload - Group already-saved images (see /upload/image) into card items.
// This endpoint does no file I/O or image processing, so it stays cheap no matter how many
// images are being imported in one go.
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<UploadResult>>> {
  try {
    const userEmail = await getUserEmail();
    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
    }

    const { lotId } = await params;
    
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

    const body = await request.json();
    const images = (Array.isArray(body.images) ? body.images : []) as FinalizeImageInput[];
    const imagesPerCard = parseInt(body.imagesPerCard, 10) || 2;

    if (images.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No images provided' },
        { status: 400 }
      );
    }

    const uploadedImages: ImageInfo[] = images.map((img, index) => ({
      id: uuidv4(),
      originalPath: img.originalPath,
      thumbPath: img.thumbPath,
      filename: img.filename,
      sortOrder: index,
    }));
    
    // Group images into card groups
    const groups = groupImages(uploadedImages, imagesPerCard);

    const lastCard = await prisma.cardItem.findFirst({
      where: { lotId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const startSortOrder = (lastCard?.sortOrder ?? -1) + 1;
    
    // Create card items from groups (append after existing cards)
    await createCardItemsFromGroups(lotId, groups, startSortOrder);
    
    return NextResponse.json({
      success: true,
      data: {
        totalImages: uploadedImages.length,
        cardsCreated: groups.length,
      },
    });
  } catch (error) {
    console.error('Failed to finalize upload:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create cards from uploaded images' },
      { status: 500 }
    );
  }
}
