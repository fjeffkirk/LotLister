/**
 * Storage abstraction for file uploads
 * Currently uses local filesystem, but structured for easy S3 migration
 */

import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

// Use environment variable for uploads directory (for Render/production)
// Falls back to local 'data' folder for development
const UPLOADS_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
const DATA_DIR = path.dirname(UPLOADS_DIR);

export interface StorageConfig {
  type: 'local' | 's3';
  bucket?: string;
  region?: string;
}

export interface UploadResult {
  originalPath: string;
  thumbPath: string;
  filename: string;
}

/**
 * Ensure required directories exist
 */
export async function ensureDirectories(lotId: string): Promise<void> {
  const lotDir = path.join(UPLOADS_DIR, lotId);
  const thumbDir = path.join(lotDir, 'thumbs');
  
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(lotDir, { recursive: true });
  await fs.mkdir(thumbDir, { recursive: true });
}

/**
 * Save an uploaded image and generate thumbnail
 */
export async function saveImage(
  lotId: string,
  filename: string,
  buffer: Buffer
): Promise<UploadResult> {
  await ensureDirectories(lotId);
  
  const lotDir = path.join(UPLOADS_DIR, lotId);
  const thumbDir = path.join(lotDir, 'thumbs');
  
  // Sanitize filename
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(sanitizedFilename).toLowerCase() || '.jpg';
  const baseName = path.basename(sanitizedFilename, ext);
  const timestamp = Date.now();
  const uniqueFilename = `${baseName}_${timestamp}${ext}`;
  
  const originalPath = path.join(lotDir, uniqueFilename);
  const thumbFilename = `thumb_${uniqueFilename}`.replace(ext, '.jpg');
  const thumbPath = path.join(thumbDir, thumbFilename);
  
  // Save original
  await fs.writeFile(originalPath, buffer);
  
  // Generate thumbnail (200px width, maintain aspect ratio)
  // .rotate() with no args auto-rotates based on EXIF orientation, then removes the tag
  await sharp(buffer)
    .rotate()
    .resize(200, 200, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toFile(thumbPath);
  
  // Return paths for database storage
  // Use simple relative format: uploads/lotId/filename
  const relativeOriginal = `uploads/${lotId}/${uniqueFilename}`;
  const relativeThumb = `uploads/${lotId}/thumbs/${thumbFilename}`;
  
  return {
    originalPath: relativeOriginal,
    thumbPath: relativeThumb,
    filename: uniqueFilename,
  };
}

/**
 * Delete all images for a lot
 */
export async function deleteLotImages(lotId: string): Promise<void> {
  const lotDir = path.join(UPLOADS_DIR, lotId);
  
  try {
    await fs.rm(lotDir, { recursive: true, force: true });
  } catch (error) {
    console.error(`Failed to delete lot images for ${lotId}:`, error);
  }
}

/**
 * Delete a single image
 */
export async function deleteImage(originalPath: string, thumbPath: string): Promise<void> {
  try {
    // Handle both old format (data/uploads/...) and new format (uploads/...)
    const fullOriginalPath = resolveImagePath(originalPath);
    const fullThumbPath = resolveImagePath(thumbPath);
    
    await fs.unlink(fullOriginalPath).catch(() => {});
    await fs.unlink(fullThumbPath).catch(() => {});
  } catch (error) {
    console.error('Failed to delete image:', error);
  }
}

/**
 * Resolve a relative image path to absolute filesystem path
 */
export function resolveImagePath(relativePath: string): string {
  // Remove 'data/' prefix if present (old format)
  const cleanPath = relativePath.replace(/^data\//, '');
  
  // Remove 'uploads/' prefix since UPLOADS_DIR already points to uploads folder
  const pathWithoutUploads = cleanPath.replace(/^uploads\//, '');
  
  return path.join(UPLOADS_DIR, pathWithoutUploads);
}

/**
 * Get the public URL for an image
 */
export function getImageUrl(relativePath: string): string {
  // For local storage, serve via API route
  return `/api/images/${encodeURIComponent(relativePath)}`;
}
