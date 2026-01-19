import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { saveImage } from '@/lib/storage';
import { groupImages, createCardItemsFromGroups, ImageInfo } from '@/lib/grouping';
import { v4 as uuidv4 } from 'uuid';
import { ApiResponse } from '@/lib/types';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

interface UploadResult {
  totalImages: number;
  cardsCreated: number;
}

// POST /api/lots/[lotId]/upload - Upload images and create card items
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<UploadResult>>> {
  try {
    const { lotId } = await params;
    
    // Verify lot exists
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
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
    
    // Process each file
    const uploadedImages: ImageInfo[] = [];
    
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        continue;
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
    
    // Create card items from groups
    await createCardItemsFromGroups(lotId, groups);
    
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
