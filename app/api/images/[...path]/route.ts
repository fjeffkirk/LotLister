import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { resolveImagePath } from '@/lib/storage';

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

// GET /api/images/[...path] - Serve images from uploads directory
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { path: pathParts } = await params;
    const relativePath = decodeURIComponent(pathParts.join('/'));
    
    // Resolve the path using storage helper (handles both old and new formats)
    const fullPath = resolveImagePath(relativePath);
    
    // Read the file
    const fileBuffer = await fs.readFile(fullPath);
    
    // Determine content type
    const ext = path.extname(fullPath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';
    
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Failed to serve image:', error);
    return NextResponse.json(
      { error: 'Image not found' },
      { status: 404 }
    );
  }
}
