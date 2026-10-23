import fs from 'fs/promises';
import { z } from 'zod';
import prisma from '../prisma';
import { log } from '../logger';
import { relativeMediaPath, resolveMediaPath } from './media';
import { YoutubeUserError } from './types';

export const failedMediaCleanupSchema = z.object({
  jobId: z.string().min(8).max(40),
  connectionId: z.string().min(8).max(40),
  channelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
  idempotencyKey: z.string().min(8).max(80),
  mediaAssetId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  expectedByteSize: z.number().int().positive().safe(),
  backupReference: z.string().trim().min(1).max(300),
  deletionIntent: z.literal(true),
}).strict();
export type FailedMediaCleanupTarget = z.infer<typeof failedMediaCleanupSchema>;

/** Owner-authorized cleanup of one failed source. No YouTube calls, job deletes,
 * queue revival, shared-file deletion, or changes to publication settings. */
export async function deleteFailedMedia(accountId: string, input: FailedMediaCleanupTarget) {
  const target = failedMediaCleanupSchema.parse(input);
  const enabled = (process.env.YOUTUBE_MEDIA_CLEANUP_CHANNEL_IDS ?? '').split(',').map(x => x.trim());
  if (!enabled.includes(target.channelId)) {
    throw new YoutubeUserError('deletion_disabled', 'Local media deletion is not enabled for this channel.');
  }
  const asset = await prisma.$transaction(async tx => {
    // Enqueue uses this same asset lock. After marking deleting, no new job can
    // acquire these bytes. A second statement sees any enqueue committed first.
    const assets = await tx.$queryRaw<Array<{
      id: string; userEmail: string; kind: string; status: string; storagePath: string; byteSize: bigint | null;
    }>>`SELECT id, "userEmail", kind, status, "storagePath", "byteSize"
      FROM "YoutubeMediaAsset" WHERE id = ${target.mediaAssetId} AND "userEmail" = ${accountId} FOR UPDATE`;
    const row = assets[0];
    const jobs = await tx.$queryRaw<Array<{
      id: string; connectionId: string; channelId: string; idempotencyKey: string;
      mediaAssetId: string; status: string; lockedAt: Date | null; lockToken: string | null;
      completionUncertain: boolean;
    }>>`SELECT id, "connectionId", "channelId", "idempotencyKey", "mediaAssetId", status,
        "lockedAt", "lockToken", "completionUncertain" FROM "YoutubeUploadJob"
      WHERE id = ${target.jobId} AND "userEmail" = ${accountId} FOR UPDATE`;
    const job = jobs[0];
    if (!row || !job || job.connectionId !== target.connectionId || job.channelId !== target.channelId
      || job.idempotencyKey !== target.idempotencyKey || job.mediaAssetId !== target.mediaAssetId
      || row.kind !== 'video' || row.byteSize === null || BigInt(row.byteSize) !== BigInt(target.expectedByteSize)
      || row.storagePath !== relativeMediaPath(accountId, row.id)) {
      throw new YoutubeUserError('cleanup_target_mismatch', 'The failed job, account, channel, file path or byte size does not match.');
    }
    if (!['failed', 'rejected'].includes(job.status) || job.lockedAt || job.lockToken || job.completionUncertain) {
      throw new YoutubeUserError('media_in_use', 'Only an unleased, unambiguous failed or rejected upload source can be removed.');
    }
    const references = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "YoutubeUploadJob"
      WHERE ("mediaAssetId" = ${row.id} OR "thumbnailAssetId" = ${row.id}) AND id <> ${job.id} LIMIT 1`;
    if (references.length) throw new YoutubeUserError('media_shared', 'Another upload references this source. Its file is preserved.');
    if (!['ready', 'deleting', 'expired'].includes(row.status)) {
      throw new YoutubeUserError('media_in_use', 'The media is not ready for local cleanup.');
    }
    if (row.status === 'expired') return row;
    const stat = await fs.lstat(resolveMediaPath(row.storagePath)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat && (!stat.isFile() || stat.size !== target.expectedByteSize)) {
      throw new YoutubeUserError('cleanup_file_mismatch', 'The stored file is not a regular file of the approved size.');
    }
    await tx.youtubeMediaAsset.update({ where: { id: row.id }, data: { status: 'deleting',
      errorMessage: `Owner requested failed-source cleanup. Backup: ${target.backupReference}` } });
    return row;
  }, { isolationLevel: 'ReadCommitted' });
  if (asset.status === 'expired') return { mediaAssetId: asset.id, localFileDeleted: true, alreadyDeleted: true, freedBytes: 0 };
  const removed = await fs.unlink(resolveMediaPath(asset.storagePath)).then(() => true).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error; // Keep deleting so this exact authorized operation can resume.
  });
  await prisma.youtubeMediaAsset.update({ where: { id: asset.id }, data: { status: 'expired',
    errorMessage: `Owner removed failed local source. YouTube and upload history preserved. Backup: ${target.backupReference}` } });
  return { mediaAssetId: asset.id, localFileDeleted: true, alreadyDeleted: !removed,
    freedBytes: removed ? target.expectedByteSize : 0, youtubeVideoDeleted: false, uploadHistoryPreserved: true };
}

/** Operator fallback for clients with a cached MCP tool catalog. Exact targets
 * only; uses the same account-scoped, locked cleanup operation as the MCP tool. */
export async function applyConfiguredFailedMediaCleanup(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.argv.includes('build')) return;
  const raw = process.env.YOUTUBE_FAILED_MEDIA_CLEANUP;
  if (!raw?.trim()) return;
  const targets = z.array(failedMediaCleanupSchema).max(20).parse(JSON.parse(raw));
  const accounts = await Promise.all(targets.map(async target => {
    const job = await prisma.youtubeUploadJob.findFirst({ where: { id: target.jobId,
      connectionId: target.connectionId, channelId: target.channelId,
      idempotencyKey: target.idempotencyKey, mediaAssetId: target.mediaAssetId }, select: { userEmail: true } });
    if (!job) throw new Error('Failed-media cleanup identity mismatch. No files removed.');
    return job.userEmail;
  }));
  for (let i = 0; i < targets.length; i++) {
    const result = await deleteFailedMedia(accounts[i], targets[i]);
    log.info('youtube failed local media cleanup verified', { jobId: targets[i].jobId, ...result });
  }
}
