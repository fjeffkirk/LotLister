import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { resolveImagePath } from '../../../../lib/storage';

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
    
    const fullPath = resolveImagePath(relativePath);
    const stats = await fs.stat(fullPath);
    
    const ext = path.extname(fullPath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';
    
    const nodeStream = createReadStream(fullPath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stats.size),
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
