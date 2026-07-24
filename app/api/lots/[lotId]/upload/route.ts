import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import {
  saveImage,
  MAX_IMAGES_PER_UPLOAD,
  MAX_IMAGE_FILE_BYTES,
} from '../../../../../lib/storage';
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

/** Allow long-running batches on Render (image decode + thumb generation) */
export const maxDuration = 120;

// POST /api/lots/[lotId]/upload - Upload images and create card items
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
    
    // Parse multipart form data
    const formData = await request.formData();
    const files = formData.getAll('images') as File[];
    const imagesPerCard = parseInt(formData.get('imagesPerCard') as string) || 2;
    
    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No images provided' },
        { status: 400 }
      );
    }

    if (files.length > MAX_IMAGES_PER_UPLOAD) {
      return NextResponse.json(
        {
          success: false,
          error: `Maximum ${MAX_IMAGES_PER_UPLOAD} images per upload request. Send smaller batches.`,
        },
        { status: 400 }
      );
    }
    
    // Process each file sequentially — one buffer + one Sharp job at a time
    const uploadedImages: ImageInfo[] = [];
    
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        continue;
      }

      if (file.size > MAX_IMAGE_FILE_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: `Image "${file.name}" exceeds the ${Math.round(MAX_IMAGE_FILE_BYTES / (1024 * 1024))}MB limit`,
          },
          { status: 413 }
        );
      }
      
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await saveImage(lotId, file.name, buffer);
      
      uploadedImages.push({
        id: uuidv4(),
        originalPath: result.originalPath,
        thumbPath: result.thumbPath,
        filename: result.filename,
        sortOrder: uploadedImages.length,
      });
    }
    
    if (uploadedImages.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid images found' },
        { status: 400 }
      );
    }
    
    // Group images into card groups
    const groups = groupImages(uploadedImages, imagesPerCard);

    const lastCard = await prisma.cardItem.findFirst({
      where: { lotId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const startSortOrder = (lastCard?.sortOrder ?? -1) + 1;
    
    // Create card items from groups (append after existing cards when batching)
    await createCardItemsFromGroups(lotId, groups, startSortOrder);
    
    return NextResponse.json({
      success: true,
      data: {
        totalImages: uploadedImages.length,
        cardsCreated: groups.length,
      },
    });
  } catch (error) {
    console.error('Failed to upload images:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload images' },
      { status: 500 }
    );
  }
}
