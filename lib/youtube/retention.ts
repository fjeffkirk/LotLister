import fs from 'fs/promises';
import prisma from '../prisma';
import { log } from '../logger';
import { relativeMediaPath, resolveMediaPath } from './media';
import { redactSecrets } from './policy';

export const LOCAL_MEDIA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Cleanup has no YouTube API/token dependency. Only LotLister video bytes expire. */
export async function expireLocalVideoFiles(now = new Date(), limit = 20): Promise<{ deletedAssets: string[]; skipped: string[] }> {
  const cutoff = new Date(now.getTime() - LOCAL_MEDIA_RETENTION_MS);
  const assets = await prisma.$transaction(async tx => {
    // Enqueue locks these same rows before checking asset status and inserting a job.
    // SKIP LOCKED leaves files being reserved by another request alone.
    const candidates = await tx.$queryRaw<Array<{ id: string; userEmail: string; storagePath: string }>>`
      SELECT a.id, a."userEmail", a."storagePath" FROM "YoutubeMediaAsset" a
      WHERE a.kind = 'video' AND a.status IN ('ready', 'deleting') AND a."createdAt" <= ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "YoutubeUploadJob" j
        WHERE j."userEmail" = a."userEmail" AND (j."mediaAssetId" = a.id OR j."thumbnailAssetId" = a.id)
        AND (j.status NOT IN ('processed', 'deleted') OR j."lockToken" IS NOT NULL OR j."lockedAt" IS NOT NULL
          OR j."completionUncertain" = true OR j."uploadedAt" IS NULL OR j."uploadedAt" > ${cutoff}))
      ORDER BY a."createdAt", a.id LIMIT ${limit} FOR UPDATE OF a SKIP LOCKED`;
    const claimed: typeof candidates = [];
    for (const asset of candidates) {
      // A fresh READ COMMITTED statement after the lock observes any enqueue that
      // committed while the candidate statement was starting.
      const blockers = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "YoutubeUploadJob" WHERE "userEmail" = ${asset.userEmail}
        AND ("mediaAssetId" = ${asset.id} OR "thumbnailAssetId" = ${asset.id})
        AND (status NOT IN ('processed', 'deleted') OR "lockToken" IS NOT NULL OR "lockedAt" IS NOT NULL
          OR "completionUncertain" = true OR "uploadedAt" IS NULL OR "uploadedAt" > ${cutoff}) LIMIT 1`;
      if (blockers.length) continue;
      // Never unlink an arbitrary DB path, another account's file, or a directory.
      if (asset.storagePath !== relativeMediaPath(asset.userEmail, asset.id)) continue;
      await tx.youtubeMediaAsset.update({ where: { id: asset.id }, data: { status: 'deleting' } });
      claimed.push(asset);
    }
    return claimed;
  }, { isolationLevel: 'ReadCommitted' });
  const deletedAssets: string[] = [];
  const skipped: string[] = [];
  for (const asset of assets) {
    try {
      await fs.unlink(resolveMediaPath(asset.storagePath)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await prisma.youtubeMediaAsset.update({ where: { id: asset.id }, data: {
        status: 'expired', errorMessage: 'LotLister local video file removed after seven days. The YouTube video and upload history are preserved.',
      } });
      deletedAssets.push(asset.id);
    } catch (error) {
      // Leave deleting so the next pass can finish after a crash or filesystem error.
      skipped.push(asset.id);
      log.warn('local video cleanup failed', { assetId: asset.id, message: error instanceof Error ? redactSecrets(error.message).slice(0, 200) : 'failed' });
    }
  }
  return { deletedAssets, skipped };
}
