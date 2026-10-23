import fs from 'fs/promises';
import path from 'path';

/** Read the filesystem actually holding uploads, including non-upload files. */
export async function storageCapacity() {
  const directory = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
  await fs.mkdir(directory, { recursive: true });
  const stats = await fs.statfs(directory);
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0
    || !Number.isSafeInteger(freeBytes) || freeBytes < 0 || freeBytes > totalBytes) {
    throw new Error('Could not determine upload disk capacity.');
  }
  return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
}
