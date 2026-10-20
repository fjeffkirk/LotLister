import { deleteVideo, getVideo, listChannelVideos } from './api';
import { getValidAccessToken, requireOwnedConnection } from './connections';
import { assertSameChannel } from './policy';
import { YoutubeUserError, type YoutubeVideo } from './types';

export function rankVideos(videos: YoutubeVideo[]) {
  if (new Set(videos.map(v => v.id)).size !== videos.length
    || videos.some(v => !v.id || !/^\d+$/.test(v.statistics?.viewCount ?? ''))) {
    throw new YoutubeUserError('ranking_unavailable', 'Every video must have a unique ID and a reported lifetime view count. Missing counts are not zero.');
  }
  return [...videos].sort((a, b) => {
    const av = BigInt(a.statistics!.viewCount!);
    const bv = BigInt(b.statistics!.viewCount!);
    return av === bv ? a.id!.localeCompare(b.id!) : av > bv ? -1 : 1;
  });
}

export function assertCleanupTarget(videos: YoutubeVideo[], videoId: string, expectedTitle: string, protectedVideoIds: string[]) {
  const ranking = rankVideos(videos);
  if (protectedVideoIds.length !== 5 || new Set(protectedVideoIds).size !== 5 || ranking.length < 5) {
    throw new YoutubeUserError('invalid_keepers', 'Cleanup requires five distinct protected videos.');
  }
  const keepers = ranking.slice(0, 5).map(v => v.id!);
  if (keepers.some(id => !protectedVideoIds.includes(id))) {
    throw new YoutubeUserError('ranking_changed', 'The current top five differ from the protected set. Refresh the cleanup plan before deleting.');
  }
  if (keepers.includes(videoId)) throw new YoutubeUserError('protected_video', 'This video is among the protected top five.');
  const target = ranking.find(v => v.id === videoId);
  if (!target || target.snippet?.title !== expectedTitle) {
    throw new YoutubeUserError('target_changed', 'The target ID or exact title does not match the cleanup plan.');
  }
  return target;
}

async function context(accountId: string, connectionId: string, expectedChannelId: string) {
  const connection = await requireOwnedConnection(accountId, connectionId);
  assertSameChannel(expectedChannelId, connection.channelId);
  if (connection.status !== 'connected') throw new YoutubeUserError('reconnect_required', 'Reconnect this YouTube channel.');
  const token = await getValidAccessToken(accountId, connectionId);
  return { connection, token };
}

export async function channelInventory(accountId: string, connectionId: string, expectedChannelId: string) {
  const { connection, token } = await context(accountId, connectionId, expectedChannelId);
  const ranking = rankVideos(await listChannelVideos(token, connection.channelId));
  return {
    connectionId, channelId: connection.channelId, complete: true,
    retrievedAt: new Date().toISOString(), rankingMetric: 'lifetime_view_count', tieBreak: 'video_id_ascending',
    total: ranking.length, protectedVideoIds: ranking.slice(0, 5).map(v => v.id),
    videos: ranking.map((v, i) => ({ rank: i + 1, videoId: v.id, title: v.snippet?.title,
      statistics: v.statistics, visibility: v.status?.privacyStatus, publishAt: v.status?.publishAt ?? null,
      watchUrl: `https://www.youtube.com/watch?v=${v.id}` })),
  };
}

/** Default-denied. No automatic cleanup, no batch wildcard, no credentials in
 * arguments. An operator must explicitly enable this channel after approval. */
export async function deleteOutsideTopFive(accountId: string, input: {
  connectionId: string; expectedChannelId: string; videoId: string; expectedTitle: string;
  protectedVideoIds: string[]; deletionIntent: true;
}) {
  const allowed = (process.env.YOUTUBE_CLEANUP_CHANNEL_IDS ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (!allowed.includes(input.expectedChannelId)) {
    throw new YoutubeUserError('deletion_disabled', 'Permanent deletion has not been enabled for this channel.');
  }
  if (input.deletionIntent !== true) throw new YoutubeUserError('deletion_intent_required', 'Permanent deletion requires explicit intent.');
  const { connection, token } = await context(accountId, input.connectionId, input.expectedChannelId);
  const videos = await listChannelVideos(token, connection.channelId);
  assertCleanupTarget(videos, input.videoId, input.expectedTitle, input.protectedVideoIds);
  const target = await getVideo(token, input.videoId);
  assertSameChannel(target.snippet?.channelId, connection.channelId);
  if (target.snippet?.title !== input.expectedTitle) throw new YoutubeUserError('target_changed', 'The title changed before deletion.');
  await deleteVideo(token, input.videoId);
  let deleted = false;
  try { await getVideo(token, input.videoId); }
  catch (error) {
    if (error instanceof YoutubeUserError && error.code === 'not_found') deleted = true;
    else throw error;
  }
  return { deleted, deletionAccepted: true, channelId: connection.channelId, videoId: input.videoId,
    title: input.expectedTitle, protectedVideoIds: input.protectedVideoIds, checkedAt: new Date().toISOString(),
    note: deleted ? 'YouTube accepted deletion and a fresh owner read no longer returns the video.'
      : 'YouTube accepted deletion but readback still returns the video. Reconcile before any retry.' };
}
