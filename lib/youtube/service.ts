import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { getPublicBaseUrl } from '../ebay';
import prisma from '../prisma';
import { getVideo, setThumbnail, updateVideo } from './api';
import { MAX_THUMBNAIL_BYTES, maxUploadBytes, youtubeCallbackUrl, youtubeConfigured } from './config';
import { connectionStatus, disconnectConnection, getValidAccessToken, listConnections, markConnectionReconnect, requireOwnedConnection, saveGoogleConnection, settingsView } from './connections';
import { enqueueVideoUpload, scheduleYoutubeWork, storagePathFor, uploadStatus } from './jobs';
import {
  newAssetExpiry,
  openUploadGrant,
  relativeMediaPath,
  resolveMediaPath,
  signUploadGrant,
  uploadUrlFor,
  writeUploadStream,
} from './media';
import { exchangeAuthCode, type GoogleTokenResponse } from './oauth';
import {
  assertSameChannel,
  buildMetadataUpdate,
  buildPublishBody,
  buildScheduleBody,
  interpretVideo,
  redactSecrets,
  regionNotes,
  requirePublicationIntent,
  resolvePublishInstant,
  studioUrl,
  visibilityReport,
  watchUrl,
  type MetadataPatch,
} from './policy';
import { screenUrl } from './ssrf';
import { type Visibility, type YoutubeVideo, YoutubeUserError } from './types';

export const DIRECT_UPLOAD_INSTRUCTIONS = [
  'Call youtube_media_upload_prepare with the file name, exact byte size, and content type. It returns mediaAssetId and an expiring uploadUrl.',
  'From the program that has the MP4 bytes, PUT the raw file to uploadUrl with Content-Type: application/octet-stream. Do not send base64. A ChatGPT sandbox path or sandbox URL is not on this server and will be rejected.',
  'The PUT response confirms status ready and the same mediaAssetId.',
  'Call youtube_connections_list, copy the connectionId whose channelId matches the YouTube channel you intend to use, then call youtube_upload_video with that connectionId, the mediaAssetId, and a new idempotency key. Visibility defaults to private.',
  'Poll youtube_upload_status with the job id until status is processed, rejected, failed, or uncertain. Statuses uploaded and processing mean YouTube has not finished. Do not treat the video as public unless actualVisibility is public.',
].join(' ');

export const SOURCE_UPLOAD_INSTRUCTIONS = 'Pass sourceUrl only when the MP4 is already on a public https URL that this server can download. Private, link-local, metadata, and sandbox addresses are rejected. Then call youtube_upload_video with the returned mediaAssetId. The worker downloads the file into durable storage before the YouTube upload.';

export async function connectSettings(accountId: string, origin: string) {
  const view = await settingsView(accountId, origin);
  return { ...view, maxUploadBytes: maxUploadBytes(), callbackUrl: youtubeCallbackUrl(origin) };
}

export async function finishOAuth(accountId: string, token: GoogleTokenResponse) {
  return saveGoogleConnection(accountId, token);
}

export async function exchangeYoutubeCode(input: { code: string; redirectUri: string; codeVerifier: string }) {
  return exchangeAuthCode(input);
}

export { listConnections, connectionStatus, disconnectConnection, uploadStatus };

export async function prepareMedia(accountId: string, origin: string, input: {
  filename?: string;
  byteSize?: number;
  contentType?: string;
  sourceUrl?: string;
}) {
  if (!youtubeConfigured()) {
    throw new YoutubeUserError('not_configured', 'Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and YOUTUBE_TOKEN_ENCRYPTION_KEY on the server.');
  }
  const id = `ma_${randomBytes(12).toString('hex')}`;
  const storagePath = relativeMediaPath(accountId, id);
  const imageHint = (input.contentType ?? '').startsWith('image/');
  if (input.sourceUrl) {
    await screenUrl(input.sourceUrl);
    await prisma.youtubeMediaAsset.create({
      data: {
        id,
        userEmail: accountId,
        kind: imageHint ? 'image' : 'video',
        status: 'remote',
        filename: sanitizeFilename(input.filename || (imageHint ? 'image' : 'video.mp4')),
        contentType: input.contentType || (imageHint ? 'image/jpeg' : 'video/mp4'),
        storagePath,
        sourceUrl: input.sourceUrl,
      },
    });
    scheduleYoutubeWork();
    return {
      mediaAssetId: id,
      status: 'remote',
      transfer: { method: 'source_url' as const, instructions: SOURCE_UPLOAD_INSTRUCTIONS },
    };
  }
  if (!input.filename || !input.byteSize || !input.contentType) {
    throw new YoutubeUserError('invalid_media', 'Provide filename, byteSize, and contentType, or provide a public https sourceUrl.');
  }
  const limit = imageHint ? MAX_THUMBNAIL_BYTES : maxUploadBytes();
  if (input.byteSize > limit) {
    throw new YoutubeUserError('too_large', `The file exceeds the ${limit} byte limit for this server. The Render disk is 1 GB and is shared with card photos.`);
  }
  const expiresAt = newAssetExpiry();
  await prisma.youtubeMediaAsset.create({
    data: {
      id,
      userEmail: accountId,
      kind: imageHint ? 'image' : 'video',
      status: 'pending',
      filename: sanitizeFilename(input.filename),
      contentType: input.contentType,
      byteSize: input.byteSize,
      storagePath,
      expiresAt,
    },
  });
  const grant = signUploadGrant({
    assetId: id,
    accountId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    maxBytes: input.byteSize,
  });
  return {
    mediaAssetId: id,
    status: 'pending',
    expiresAt: expiresAt.toISOString(),
    transfer: {
      method: 'PUT' as const,
      uploadUrl: uploadUrlFor(getPublicBaseUrl(origin), id, grant),
      headers: { 'Content-Type': 'application/octet-stream' },
      instructions: DIRECT_UPLOAD_INSTRUCTIONS,
    },
  };
}

export async function acceptMediaBytes(assetId: string, token: string, stream: Readable) {
  const grant = openUploadGrant(token, Math.floor(Date.now() / 1000));
  if (grant.assetId !== assetId) {
    throw new YoutubeUserError('upload_unauthorized', 'The upload URL does not match this media asset.');
  }
  const asset = await prisma.youtubeMediaAsset.findFirst({ where: { id: assetId, userEmail: grant.accountId } });
  if (!asset) throw new YoutubeUserError('upload_unauthorized', 'The upload URL does not match a media asset for this account.');
  if (asset.status === 'ready') {
    throw new YoutubeUserError('already_uploaded', 'This upload URL was already used. Prepare a new upload if the file must be sent again.');
  }
  const destination = resolveMediaPath(asset.storagePath || storagePathFor(grant.accountId, assetId));
  try {
    const written = await writeUploadStream(stream, destination, Math.min(grant.maxBytes, asset.kind === 'image' ? MAX_THUMBNAIL_BYTES : maxUploadBytes()));
    if (written.sniffed.kind !== asset.kind) {
      await prisma.youtubeMediaAsset.update({ where: { id: asset.id }, data: { status: 'failed', errorMessage: 'The file type did not match this upload.' } });
      throw new YoutubeUserError('invalid_media', asset.kind === 'video'
        ? 'The uploaded file is not an MP4, MOV, or WebM video.'
        : 'The uploaded file is not a JPEG, PNG, or GIF thumbnail.');
    }
    if (written.sniffed.kind === 'image' && written.byteSize > MAX_THUMBNAIL_BYTES) {
      throw new YoutubeUserError('too_large', 'Thumbnails must be 2 MB or smaller.');
    }
    await prisma.youtubeMediaAsset.update({
      where: { id: asset.id },
      data: { status: 'ready', byteSize: written.byteSize, contentType: written.sniffed.contentType, errorMessage: null },
    });
    return { mediaAssetId: asset.id, status: 'ready' as const, byteSize: written.byteSize, contentType: written.sniffed.contentType, kind: written.sniffed.kind };
  } catch (error) {
    if (error instanceof YoutubeUserError && error.code !== 'already_uploaded') {
      await prisma.youtubeMediaAsset.update({
        where: { id: asset.id },
        data: { status: asset.status === 'ready' ? 'ready' : 'failed', errorMessage: error.message.slice(0, 400) },
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function startVideoUpload(input: Parameters<typeof enqueueVideoUpload>[0]) {
  return enqueueVideoUpload(input);
}

async function callYoutube<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof YoutubeUserError && error.code === 'reconnect_required') {
      await markConnectionReconnect(connectionId, error.message).catch(() => undefined);
    }
    throw error;
  }
}

async function ownedVideo(accountId: string, connectionId: string, videoId: string) {
  const connection = await requireOwnedConnection(accountId, connectionId);
  if (connection.status !== 'connected') {
    throw new YoutubeUserError('reconnect_required', connection.statusDetail || 'Reconnect this YouTube channel in LotLister settings.');
  }
  const token = await getValidAccessToken(accountId, connectionId);
  const video = await getVideo(token, videoId);
  assertSameChannel(video.snippet?.channelId, connection.channelId);
  return { connection, token, video };
}

export async function readVideo(accountId: string, connectionId: string, videoId: string) {
  return callYoutube(connectionId, async () => {
    const { connection, video } = await ownedVideo(accountId, connectionId, videoId);
    return publicVideo(connection, video);
  });
}

export async function updateMetadata(accountId: string, connectionId: string, videoId: string, patch: MetadataPatch) {
  return callYoutube(connectionId, async () => {
  const { connection, token, video } = await ownedVideo(accountId, connectionId, videoId);
  const update = buildMetadataUpdate(video, patch);
  await updateVideo(token, update.part, update.body);
  const fresh = await getVideo(token, videoId);
  assertSameChannel(fresh.snippet?.channelId, connection.channelId);
  return { updated: true, video: publicVideo(connection, fresh), preserved: 'Fields that were not included in the request were sent back unchanged.' };
  });
}

export async function publishVideo(accountId: string, connectionId: string, videoId: string, visibility: 'public' | 'unlisted', publicationIntent: unknown) {
  return callYoutube(connectionId, async () => {
  requirePublicationIntent(publicationIntent, `Publishing this video as ${visibility}`);
  const { connection, token, video } = await ownedVideo(accountId, connectionId, videoId);
  const update = buildPublishBody(video, visibility);
  await updateVideo(token, update.part, update.body);
  const fresh = await getVideo(token, videoId);
  const report = visibilityReport(visibility, fresh.status?.privacyStatus);
  return {
    published: report.matchesRequest,
    requestedVisibility: visibility,
    publicationIntent: true,
    connectionId: connection.id,
    channelId: connection.channelId,
    channelTitle: connection.channelTitle,
    ...report,
    video: publicVideo(connection, fresh),
  };
  });
}

export async function scheduleVideo(accountId: string, connectionId: string, videoId: string, publishAt: string, timeZone: string | undefined, publicationIntent: unknown) {
  return callYoutube(connectionId, async () => {
  requirePublicationIntent(publicationIntent, 'Scheduling this video');
  const instant = resolvePublishInstant(publishAt, timeZone, new Date());
  const { connection, token, video } = await ownedVideo(accountId, connectionId, videoId);
  const update = buildScheduleBody(video, instant.toISOString());
  await updateVideo(token, update.part, update.body);
  const fresh = await getVideo(token, videoId);
  const actualMs = fresh.status?.publishAt ? Date.parse(fresh.status.publishAt) : NaN;
  const scheduled = fresh.status?.privacyStatus === 'private' && Number.isFinite(actualMs) && Math.abs(actualMs - instant.getTime()) < 2000;
  const report = visibilityReport('private', fresh.status?.privacyStatus);
  return {
    scheduled,
    requestedPublishAt: instant.toISOString(),
    actualPublishAt: fresh.status?.publishAt ?? null,
    requestedVisibility: 'private' as const,
    publicationIntent: true,
    connectionId: connection.id,
    channelId: connection.channelId,
    channelTitle: connection.channelTitle,
    actualVisibility: report.actualVisibility,
    visibilityMatchesRequest: report.matchesRequest,
    restriction: scheduled ? report.restriction : (report.restriction || 'YouTube did not confirm the scheduled publish time. Do not assume the video will go public.'),
    video: publicVideo(connection, fresh),
  };
  });
}

export async function setVideoThumbnail(accountId: string, connectionId: string, videoId: string, mediaAssetId: string) {
  return callYoutube(connectionId, async () => {
  const { connection, token, video } = await ownedVideo(accountId, connectionId, videoId);
  const asset = await prisma.youtubeMediaAsset.findFirst({ where: { id: mediaAssetId, userEmail: accountId } });
  if (!asset || asset.kind !== 'image' || asset.status !== 'ready') {
    throw new YoutubeUserError('not_found', 'That thumbnail asset does not belong to this account or is not a ready image.');
  }
  const { readFile } = await import('fs/promises');
  const bytes = await readFile(resolveMediaPath(asset.storagePath));
  if (bytes.length > MAX_THUMBNAIL_BYTES) throw new YoutubeUserError('too_large', 'Thumbnails must be 2 MB or smaller.');
  try {
    await setThumbnail(token, video.id || videoId, bytes, asset.contentType);
  } catch (error) {
    if (error instanceof YoutubeUserError && error.code === 'forbidden') {
      throw new YoutubeUserError('thumbnail_ineligible', `${error.message} Channel ${connection.channelTitle} (${connection.channelId}) must be phone-verified for custom thumbnails.`);
    }
    throw error;
  }
  const fresh = await getVideo(token, videoId);
  return {
    thumbnailSet: fresh.contentDetails?.hasCustomThumbnail === true,
    hasCustomThumbnail: fresh.contentDetails?.hasCustomThumbnail ?? null,
    video: publicVideo(connection, fresh),
    note: fresh.contentDetails?.hasCustomThumbnail === true
      ? 'YouTube reports a custom thumbnail on this video.'
      : 'The thumbnail request was accepted, but YouTube has not confirmed hasCustomThumbnail yet.',
  };
  });
}

function publicVideo(connection: { id: string; channelId: string; channelTitle: string }, video: YoutubeVideo) {
  const lifecycle = interpretVideo(video);
  return {
    connectionId: connection.id,
    channelId: connection.channelId,
    channelTitle: connection.channelTitle,
    videoChannelId: video.snippet?.channelId ?? null,
    youtubeVideoId: video.id ?? null,
    watchUrl: watchUrl(video.id),
    studioUrl: studioUrl(video.id),
    title: video.snippet?.title ?? null,
    statistics: video.statistics ?? null,
    description: video.snippet?.description ?? null,
    tags: video.snippet?.tags ?? [],
    categoryId: video.snippet?.categoryId ?? null,
    defaultLanguage: video.snippet?.defaultLanguage ?? null,
    defaultAudioLanguage: video.snippet?.defaultAudioLanguage ?? null,
    madeForKids: video.status?.madeForKids ?? null,
    selfDeclaredMadeForKids: video.status?.selfDeclaredMadeForKids ?? null,
    containsSyntheticMedia: video.status?.containsSyntheticMedia ?? null,
    privacyStatus: video.status?.privacyStatus ?? null,
    publishAt: video.status?.publishAt ?? null,
    uploadStatus: video.status?.uploadStatus ?? null,
    processingStatus: video.processingDetails?.processingStatus ?? null,
    failureReason: video.status?.failureReason ?? null,
    rejectionReason: video.status?.rejectionReason ?? null,
    processingFailureReason: video.processingDetails?.processingFailureReason ?? null,
    hasCustomThumbnail: video.contentDetails?.hasCustomThumbnail ?? null,
    regionRestriction: video.contentDetails?.regionRestriction ?? null,
    regionNote: regionNotes(video),
    lifecycle: lifecycle.state,
    processingVerified: lifecycle.state === 'processed',
  };
}

function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return cleaned || 'video.mp4';
}

export function safeClientMessage(error: unknown): string {
  return error instanceof Error ? redactSecrets(error.message).slice(0, 500) : 'YouTube request failed.';
}

export type { Visibility };
