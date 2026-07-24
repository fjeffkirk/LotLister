import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../../../lib/prisma';
import { saveImage, MAX_IMAGE_FILE_BYTES } from '../../../../../../lib/storage';
import { ApiResponse } from '../../../../../../lib/types';
import { getUserEmail } from '../../../../../../lib/auth';

interface RouteParams {
  params: Promise<{ lotId: string }>;
}

export interface UploadedImageResult {
  originalPath: string;
  thumbPath: string;
  filename: string;
}

/** Single image per request keeps memory flat regardless of how many photos are being imported */
export const maxDuration = 60;

// POST /api/lots/[lotId]/upload/image - Save one image (thumbnail included), no card created yet.
// The client calls this once per file, then calls POST /api/lots/[lotId]/upload with the
// collected paths to group everything into cards.
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResponse<UploadedImageResult>>> {
  try {
    const userEmail = await getUserEmail();
    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
    }

    const { lotId } = await params;

    const lot = await prisma.lot.findFirst({
      where: { id: lotId, userEmail },
    });

    if (!lot) {
      return NextResponse.json(
        { success: false, error: 'Lot not found' },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No image provided' },
        { status: 400 }
      );
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { success: false, error: `"${file.name}" is not an image` },
        { status: 400 }
      );
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `"${file.name}" exceeds the ${Math.round(MAX_IMAGE_FILE_BYTES / (1024 * 1024))}MB limit`,
        },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await saveImage(lotId, file.name, buffer);

    return NextResponse.json({
      success: true,
      data: {
        originalPath: result.originalPath,
        thumbPath: result.thumbPath,
        filename: result.filename,
      },
    });
  } catch (error) {
    console.error('Failed to upload image:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload image' },
      { status: 500 }
    );
  }
}
