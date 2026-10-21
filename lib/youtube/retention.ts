import prisma from '../prisma';
import { log } from '../logger';
import { deleteVideo, getVideo } from './api';
import { getValidAccessToken } from './connections';
import { redactSecrets } from './policy';
import { YoutubeUserError } from './types';

export const UPLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function deletesAt(uploadedAt: Date, retentionMs = UPLOAD_RETENTION_MS): Date {
  return new Date(uploadedAt.getTime() + retentionMs);
}

/** A LotLister upload is due once YouTube has had it for a full week. */
export function retentionDecision(input: {
  youtubeVideoId: string | null;
  uploadedAt: Date | null;
  status: string;
}, now: Date, retentionMs = UPLOAD_RETENTION_MS): 'delete' | 'keep' {
  if (input.status === 'deleted' || !input.youtubeVideoId || !input.uploadedAt) return 'keep';
  return input.uploadedAt.getTime() + retentionMs <= now.getTime() ? 'delete' : 'keep';
}

/**
 * Permanently delete LotLister uploads that YouTube accepted at least seven days ago.
 * Videos that were not uploaded by LotLister are not in this table and are not touched.
 */
export async function expireLotListerUploads(now = new Date(), limit = 5): Promise<{ deleted: string[]; skipped: string[] }> {
  const cutoff = new Date(now.getTime() - UPLOAD_RETENTION_MS);
  const due = await prisma.youtubeUploadJob.findMany({
    where: {
      youtubeVideoId: { not: null },
      uploadedAt: { lte: cutoff },
      status: { not: 'deleted' },
      NOT: { errorCode: 'retention_blocked' },
    },
    orderBy: { uploadedAt: 'asc' },
    take: limit,
    select: { id: true, userEmail: true, connectionId: true, channelId: true, youtubeVideoId: true },
  });
  const deleted: string[] = [];
  const skipped: string[] = [];
  for (const job of due) {
    const videoId = job.youtubeVideoId;
    if (!videoId) continue;
    try {
      const token = await getValidAccessToken(job.userEmail, job.connectionId);
      const gone = await removeOwnedVideo(token, job.channelId, videoId);
      if (gone === 'wrong_channel') {
        await prisma.youtubeUploadJob.update({
          where: { id: job.id },
          data: { errorCode: 'retention_blocked', errorMessage: 'The YouTube video is not on this upload’s channel, so it was not deleted.' },
        });
        skipped.push(job.id);
        continue;
      }
      await prisma.youtubeUploadJob.update({
        where: { id: job.id },
        data: {
          status: 'deleted',
          errorCode: null,
          errorMessage: 'Deleted one week after YouTube accepted the upload.',
          nextAttemptAt: null,
          lockedAt: null,
          lockToken: null,
        },
      });
      deleted.push(videoId);
    } catch (error) {
      skipped.push(job.id);
      log.warn('youtube retention delete failed', {
        jobId: job.id,
        message: error instanceof Error ? redactSecrets(error.message).slice(0, 200) : 'failed',
      });
    }
  }
  return { deleted, skipped };
}

async function removeOwnedVideo(token: string, channelId: string, videoId: string): Promise<'deleted' | 'already_gone' | 'wrong_channel'> {
  try {
    const video = await getVideo(token, videoId);
    if (video.snippet?.channelId !== channelId) return 'wrong_channel';
  } catch (error) {
    if (error instanceof YoutubeUserError && error.code === 'not_found') return 'already_gone';
    throw error;
  }
  await deleteVideo(token, videoId);
  try {
    await getVideo(token, videoId);
  } catch (error) {
    if (error instanceof YoutubeUserError && error.code === 'not_found') return 'deleted';
    throw error;
  }
  throw new YoutubeUserError('deletion_unconfirmed', 'YouTube accepted the delete but the video still reads back. It will be checked again.');
}
