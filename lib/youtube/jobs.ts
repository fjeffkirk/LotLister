import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import { Prisma } from '@prisma/client';
import { log } from '../logger';
import prisma from '../prisma';
import { byteCount } from './byte-count';
import { getVideo, probeOrUpload, setThumbnail, startResumableSession } from './api';
import { CHUNK_BYTES, MAX_THUMBNAIL_BYTES, MAX_TRANSIENT_ATTEMPTS, maxUploadBytes, youtubeConfigured } from './config';
import { getValidAccessToken, markConnectionReconnect } from './connections';
import { downloadPublicHttps, relativeMediaPath, resolveMediaPath } from './media';
import { decryptString, encryptString } from './oauth';
import { expireLocalVideoFiles } from './retention';
import { createYoutubeWorker } from './worker';
import { applyOperatorHolds } from './maintenance';
import {
  applyVerifiedVideo,
  decideIdempotency,
  decideResume,
  isUniqueConflict,
  normalizeUploadRequest,
  redactSecrets,
  toPublicJob,
} from './policy';
import {
  type JobStatus,
  type NormalizedUpload,
  type SessionQuery,
  type UploadJobState,
  type Visibility,
  type YoutubeVideo,
  YoutubeUserError,
} from './types';

const AMBIGUOUS = 'The final upload response was lost and the existing YouTube session could not be reconciled. Check this channel in YouTube Studio before using a new idempotency key. This job will not start another upload.';

export interface AssetView {
  id: string;
  userEmail: string;
  kind: string;
  status: string;
  storagePath: string;
  byteSize: number | null;
  contentType: string;
  sourceUrl: string | null;
  expiresAt: Date | null;
  errorMessage: string | null;
}

export interface UploadIo {
  now(): number;
  deadline(): number;
  persist(job: UploadJobState): Promise<void>;
  loadAsset(accountId: string, assetId: string): Promise<AssetView | null>;
  markAssetReady(assetId: string, byteSize: number, contentType: string): Promise<void>;
  markAssetFailed(assetId: string, message: string): Promise<void>;
  downloadAsset(asset: AssetView, maxBytes: number): Promise<{ byteSize: number; contentType: string }>;
  accessToken(job: UploadJobState): Promise<string>;
  readSlice(asset: AssetView, start: number, length: number): Promise<Buffer>;
  startSession(token: string, job: UploadJobState, contentType: string): Promise<string>;
  querySession(token: string, sessionUri: string, total: number): Promise<SessionQuery>;
  uploadChunk(token: string, sessionUri: string, contentType: string, start: number, chunk: Buffer, total: number): Promise<SessionQuery>;
  getVideo(token: string, videoId: string): Promise<YoutubeVideo>;
  setThumbnail(token: string, videoId: string, bytes: Buffer, contentType: string): Promise<void>;
  readFile(asset: AssetView): Promise<Buffer>;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface ConnectionRecord {
  id: string;
  userEmail: string;
  channelId: string;
  channelTitle: string;
  status: string;
  statusDetail: string | null;
}

export interface AssetRecord {
  id: string;
  userEmail: string;
  kind: string;
  status: string;
  byteSize: number | null;
  expiresAt: Date | null;
}

export interface UploadRepo {
  findConnection(accountId: string, connectionId: string): Promise<ConnectionRecord | null>;
  findAsset(accountId: string, assetId: string): Promise<AssetRecord | null>;
  findJobByKey(accountId: string, idempotencyKey: string): Promise<UploadJobState | null>;
  insertJob(job: UploadJobState): Promise<void>;
}

export interface EnqueueInput {
  accountId: string;
  connectionId: string;
  mediaAssetId: string;
  thumbnailAssetId?: string | null;
  idempotencyKey: string;
  title: string;
  description?: string;
  tags?: string[];
  categoryId: string;
  language?: string;
  audioLanguage?: string;
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
  visibility?: Visibility;
  publicationIntent?: boolean;
  publishAt?: string;
  timeZone?: string;
  now?: Date;
}

export async function enqueueWithRepo(repo: UploadRepo, input: EnqueueInput): Promise<UploadJobState> {
  if (!/^[A-Za-z0-9._:-]{8,80}$/.test(input.idempotencyKey)) {
    throw new YoutubeUserError('invalid_idempotency_key', 'idempotencyKey must be 8 to 80 characters and use only letters, numbers, and . _ : -.');
  }
  const connection = await repo.findConnection(input.accountId, input.connectionId);
  if (!connection || connection.userEmail !== input.accountId) {
    throw new YoutubeUserError('not_found', 'No YouTube connection with that id belongs to this account. Call youtube_connections_list and copy the connectionId of the channel you verified.');
  }
  if (connection.status !== 'connected') {
    throw new YoutubeUserError('reconnect_required', connection.statusDetail || 'Reconnect this YouTube channel in LotLister settings before uploading.');
  }
  const metadata = normalizeUploadRequest({
    connectionId: input.connectionId,
    mediaAssetId: input.mediaAssetId,
    thumbnailAssetId: input.thumbnailAssetId,
    title: input.title,
    description: input.description,
    tags: input.tags,
    categoryId: input.categoryId,
    language: input.language,
    audioLanguage: input.audioLanguage,
    madeForKids: input.madeForKids,
    containsSyntheticMedia: input.containsSyntheticMedia,
    visibility: input.visibility,
    publicationIntent: input.publicationIntent,
    publishAt: input.publishAt,
    timeZone: input.timeZone,
  }, input.now ?? new Date());
  const existing = await repo.findJobByKey(input.accountId, input.idempotencyKey);
  const decision = decideIdempotency(existing, metadata.requestHash);
  if (decision === 'reuse' && existing) return existing;
  if (decision === 'conflict') {
    throw new YoutubeUserError('idempotency_conflict', 'This idempotency key was already used for a different upload. Poll that job, or check the channel in YouTube Studio before using a new key.');
  }
  const asset = await repo.findAsset(input.accountId, input.mediaAssetId);
  if (!asset || asset.userEmail !== input.accountId) {
    throw new YoutubeUserError('not_found', 'That media asset does not belong to this account.');
  }
  if (asset.kind !== 'video') throw new YoutubeUserError('invalid_media', 'The media asset is not a video. Prepare the MP4 again.');
  if (asset.status === 'failed') {
    throw new YoutubeUserError('invalid_media', asset.byteSize ? 'The video file failed validation.' : 'The video file is not usable. Prepare the upload again.');
  }
  if (!['pending', 'remote', 'ready'].includes(asset.status)) {
    throw new YoutubeUserError('invalid_media', 'The media asset is not ready to upload.');
  }
  if (input.thumbnailAssetId) {
    const thumb = await repo.findAsset(input.accountId, input.thumbnailAssetId);
    if (!thumb || thumb.userEmail !== input.accountId || thumb.kind !== 'image') {
      throw new YoutubeUserError('not_found', 'That thumbnail asset does not belong to this account or is not an image.');
    }
  }
  const job = newJob(input, connection, asset, metadata);
  try {
    await repo.insertJob(job);
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const raced = await repo.findJobByKey(input.accountId, input.idempotencyKey);
    const again = decideIdempotency(raced, metadata.requestHash);
    if (again === 'reuse' && raced) return raced;
    throw new YoutubeUserError('idempotency_conflict', 'This idempotency key was already used for a different upload. Poll that job, or check the channel in YouTube Studio before using a new key.');
  }
  return job;
}

function newJob(input: EnqueueInput, connection: ConnectionRecord, asset: AssetRecord, metadata: NormalizedUpload): UploadJobState {
  return {
    id: `yt_${randomBytes(12).toString('hex')}`,
    userEmail: input.accountId,
    connectionId: connection.id,
    channelId: connection.channelId,
    channelTitle: connection.channelTitle,
    idempotencyKey: input.idempotencyKey,
    requestHash: metadata.requestHash,
    mediaAssetId: input.mediaAssetId,
    thumbnailAssetId: input.thumbnailAssetId ?? null,
    status: asset.status === 'ready' ? 'queued' : 'waiting_media',
    progressBytes: 0,
    byteSize: asset.byteSize ?? 0,
    bytesAcked: 0,
    attemptCount: 0,
    completionUncertain: false,
    nextAttemptAt: null,
    resumableSessionEnc: null,
    youtubeVideoId: null,
    requestedVisibility: metadata.privacyStatus,
    publicationIntent: metadata.publicationIntent,
    publishAt: metadata.publishAt ? new Date(metadata.publishAt) : null,
    metadata,
    actualVisibility: null,
    restriction: null,
    errorCode: null,
    errorMessage: null,
    thumbnailError: null,
    thumbnailStatus: input.thumbnailAssetId ? 'pending' : null,
  };
}

export async function advanceUpload(job: UploadJobState, io: UploadIo): Promise<UploadJobState> {
  if (['processed', 'rejected', 'failed', 'uncertain', 'held'].includes(job.status)) return job;
  // Once accepted, poll the saved video ID. Never start another session merely
  // because YouTube processing outlives the resumable upload session.
  if (job.youtubeVideoId) {
    const token = await io.accessToken(job);
    return finish(job, await io.getVideo(token, job.youtubeVideoId), io, token);
  }
  const asset = await io.loadAsset(job.userEmail, job.mediaAssetId);
  if (!asset || asset.userEmail !== job.userEmail) {
    return fail(job, 'not_found', 'The media asset does not belong to this account. No YouTube video was created.');
  }
  if (asset.status === 'failed') return fail(job, 'invalid_media', asset.errorMessage || 'The video file failed validation.');
  let current: UploadJobState = { ...job };
  if (asset.status === 'remote') {
    if (!asset.sourceUrl) return fail(current, 'invalid_media', 'The remote video has no source URL.');
    try {
      const downloaded = await io.downloadAsset(asset, maxUploadBytes());
      if (!downloaded.contentType.startsWith('video/')) {
        await io.markAssetFailed(asset.id, 'The source URL was not a video file.');
        return fail(current, 'invalid_media', 'The source URL was not a video file. No YouTube video was created.');
      }
      await io.markAssetReady(asset.id, downloaded.byteSize, downloaded.contentType);
      asset.status = 'ready';
      asset.byteSize = downloaded.byteSize;
      asset.contentType = downloaded.contentType;
      current.byteSize = downloaded.byteSize;
    } catch (error) {
      const code = error instanceof YoutubeUserError ? error.code : 'transient';
      const message = error instanceof Error ? error.message : 'The source video could not be downloaded.';
      if (['unsafe_url', 'invalid_media', 'too_large', 'source_rejected'].includes(code)) {
        await io.markAssetFailed(asset.id, message);
        return fail(current, code, message);
      }
      return pause(current, message, io.now());
    }
  }
  if (asset.status === 'pending') {
    if (asset.expiresAt && asset.expiresAt.getTime() <= io.now()) {
      return fail(current, 'media_not_received', 'The signed upload URL expired before the video bytes arrived. Prepare a new upload and use a new idempotency key. No YouTube video was created.');
    }
    current.status = 'waiting_media';
    current.nextAttemptAt = new Date(io.now() + 15_000);
    return current;
  }
  if (asset.status !== 'ready' || !asset.byteSize) {
    return fail(current, 'invalid_media', 'The video file is not in durable storage yet.');
  }
  current.byteSize = asset.byteSize;
  let token: string;
  try {
    token = await io.accessToken(current);
  } catch (error) {
    if (error instanceof YoutubeUserError && error.code === 'reconnect_required') {
      return {
        ...current,
        status: 'queued',
        errorCode: 'reconnect_required',
        errorMessage: error.message,
        nextAttemptAt: null,
      };
    }
    throw error;
  }

  let sessionUri = current.resumableSessionEnc ? io.decrypt(current.resumableSessionEnc) : null;
  if (sessionUri) {
    const query = await io.querySession(token, sessionUri, current.byteSize);
    const decision = decideResume(current, query);
    if (decision.action === 'complete') return finish(current, decision.video, io, token);
    if (decision.action === 'hold') return hold(current);
    if (decision.action === 'fatal') return fail(current, decision.code, decision.message);
    if (decision.action === 'retry') return pause(current, decision.message, io.now(), query.code);
    if (decision.action === 'restart') {
      sessionUri = null;
      current = { ...current, resumableSessionEnc: null, bytesAcked: 0, completionUncertain: false };
    }
    if (decision.action === 'resume') {
      current = { ...current, bytesAcked: decision.fromByte, completionUncertain: false, status: 'uploading' };
    }
  }
  if (!sessionUri) {
    sessionUri = await io.startSession(token, current, asset.contentType || 'video/mp4');
    current = { ...current, resumableSessionEnc: io.encrypt(sessionUri), bytesAcked: 0, status: 'uploading', completionUncertain: false };
    await io.persist(current);
  }

  let guard = 0;
  while (current.bytesAcked < current.byteSize && io.now() < io.deadline() && guard < 10_000) {
    guard += 1;
    const length = Math.min(CHUNK_BYTES, current.byteSize - current.bytesAcked);
    const finalChunk = current.bytesAcked + length >= current.byteSize;
    if (finalChunk) {
      current = { ...current, completionUncertain: true };
      await io.persist(current);
    }
    const chunk = await io.readSlice(asset, current.bytesAcked, length);
    let query: SessionQuery;
    try {
      query = await io.uploadChunk(token, sessionUri, asset.contentType || 'video/mp4', current.bytesAcked, chunk, current.byteSize);
    } catch (error) {
      if (!finalChunk) return pause(current, error instanceof Error ? error.message : 'Upload chunk failed.', io.now());
      const reconciled = await io.querySession(token, sessionUri, current.byteSize);
      const decision = decideResume({ ...current, completionUncertain: true }, reconciled);
      if (decision.action === 'complete') return finish({ ...current, completionUncertain: true }, decision.video, io, token);
      if (decision.action === 'hold' || decision.action === 'fatal') return hold(current);
      if (decision.action === 'resume') {
        current = { ...current, bytesAcked: decision.fromByte, completionUncertain: false };
        return pause(current, 'The last chunk was interrupted. The existing session will be resumed.', io.now());
      }
      return pause(current, error instanceof Error ? error.message : 'Upload chunk failed.', io.now());
    }
    if (query.type === 'complete' && query.video) {
      current = { ...current, bytesAcked: current.byteSize, progressBytes: current.byteSize, completionUncertain: false };
      return finish(current, query.video, io, token);
    }
    if (query.type === 'incomplete') {
      const acked = query.acked ?? current.bytesAcked;
      if (acked <= current.bytesAcked) {
        return pause(current, 'YouTube did not confirm new bytes. The existing upload session will be checked before anything else is sent.', io.now());
      }
      current = { ...current, bytesAcked: acked, progressBytes: acked, completionUncertain: false, status: 'uploading', errorCode: null, errorMessage: null };
      await io.persist(current);
      continue;
    }
    if (query.type === 'expired') {
      const decision = decideResume(current, query);
      if (decision.action === 'hold') return hold(current);
      return pause(current, 'YouTube ended the upload session before it could be confirmed.', io.now());
    }
    if (query.type === 'fatal') return fail(current, query.code || 'youtube_error', query.message || 'YouTube rejected the upload.');
    return pause(current, query.message || 'YouTube asked for the upload to be retried.', io.now(), query.code);
  }
  if (current.bytesAcked < current.byteSize) {
    current.status = 'uploading';
    current.nextAttemptAt = new Date(io.now());
    current.errorCode = null;
    current.errorMessage = null;
  }
  return current;
}

async function finish(job: UploadJobState, video: YoutubeVideo, io: UploadIo, token: string): Promise<UploadJobState> {
  let detailed = video;
  if (video.id) {
    try {
      detailed = await io.getVideo(token, video.id);
    } catch {
      detailed = video;
    }
  }
  if (detailed.snippet?.channelId && detailed.snippet.channelId !== job.channelId) {
    return fail(
      { ...job, youtubeVideoId: detailed.id || job.youtubeVideoId },
      'wrong_channel',
      `YouTube created the video on channel ${detailed.snippet.channelId}, not the selected channel ${job.channelId}. Do not start another upload until you have checked both channels.`,
    );
  }
  let next = applyVerifiedVideo({ ...job, completionUncertain: false }, detailed);
  next = await maybeThumbnail(next, io, token);
  return next;
}

async function maybeThumbnail(job: UploadJobState, io: UploadIo, token: string): Promise<UploadJobState> {
  if (!job.thumbnailAssetId || !job.youtubeVideoId) return job;
  if (job.thumbnailStatus === 'set' || job.thumbnailStatus === 'ineligible' || job.thumbnailStatus === 'failed') return job;
  const asset = await io.loadAsset(job.userEmail, job.thumbnailAssetId);
  if (!asset || asset.userEmail !== job.userEmail || asset.kind !== 'image' || asset.status !== 'ready') return job;
  try {
    const bytes = await io.readFile(asset);
    if (bytes.length > MAX_THUMBNAIL_BYTES) {
      return { ...job, thumbnailStatus: 'failed', thumbnailError: 'Thumbnails must be 2 MB or smaller.' };
    }
    await io.setThumbnail(token, job.youtubeVideoId, bytes, asset.contentType || 'image/jpeg');
    return { ...job, thumbnailStatus: 'set', thumbnailError: null };
  } catch (error) {
    const code = error instanceof YoutubeUserError ? error.code : 'thumbnail_failed';
    const message = error instanceof Error ? error.message : 'The thumbnail was not set.';
    if (code === 'forbidden') return { ...job, thumbnailStatus: 'ineligible', thumbnailError: message };
    if (code === 'videoNotFound' || code === 'transient') {
      if (job.status === 'processed') return { ...job, thumbnailStatus: 'failed', thumbnailError: message };
      return { ...job, thumbnailStatus: 'pending', thumbnailError: message };
    }
    return { ...job, thumbnailStatus: 'failed', thumbnailError: message };
  }
}

function fail(job: UploadJobState, code: string, message: string): UploadJobState {
  return { ...job, status: 'failed', errorCode: code, errorMessage: message, nextAttemptAt: null, completionUncertain: false };
}

function hold(job: UploadJobState): UploadJobState {
  return {
    ...job,
    status: 'uncertain',
    errorCode: 'ambiguous_completion',
    errorMessage: AMBIGUOUS,
    nextAttemptAt: null,
    completionUncertain: true,
  };
}

export function pause(job: UploadJobState, message: string, now: number, code = 'transient'): UploadJobState {
  // API limits are cooldowns, not repeated network failures. Preserve the job,
  // session and key instead of exhausting six attempts in a few minutes.
  const cooldown = code === 'uploadLimitExceeded' ? 60 * 60_000
    : ['quotaExceeded', 'dailyLimitExceeded'].includes(code) ? 6 * 60 * 60_000
      : code === 'rateLimitExceeded' ? 60_000
        : code === 'userRateLimitExceeded' ? 60_000 : 0;
  if (cooldown) return {
    ...job, status: job.youtubeVideoId ? 'processing' : 'uploading',
    errorCode: code, errorMessage: redactSecrets(message).slice(0, 400),
    nextAttemptAt: new Date(now + cooldown),
  };
  const attemptCount = job.attemptCount + 1;
  if (attemptCount >= MAX_TRANSIENT_ATTEMPTS) {
    if (job.completionUncertain) return hold({ ...job, attemptCount });
    return fail({ ...job, attemptCount }, 'retries_exhausted', message);
  }
  const delay = Math.min(5 * 60_000, 5_000 * 2 ** attemptCount);
  const status: JobStatus = job.status === 'waiting_media' ? 'waiting_media' : 'uploading';
  return {
    ...job,
    status,
    attemptCount,
    errorCode: 'transient',
    errorMessage: redactSecrets(message).slice(0, 400),
    nextAttemptAt: new Date(now + delay),
  };
}

type JobRow = {
  id: string;
  userEmail: string;
  connectionId: string;
  channelId: string;
  channelTitle: string;
  idempotencyKey: string;
  requestHash: string;
  mediaAssetId: string;
  thumbnailAssetId: string | null;
  status: string;
  progressBytes: number | bigint;
  byteSize: number | bigint;
  bytesAcked: number | bigint;
  attemptCount: number;
  completionUncertain: boolean;
  nextAttemptAt: Date | null;
  resumableSessionEnc: string | null;
  youtubeVideoId: string | null;
  requestedVisibility: string;
  publicationIntent: boolean;
  publishAt: Date | null;
  metadataJson: string;
  actualVisibility: string | null;
  restriction: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  thumbnailError: string | null;
  thumbnailStatus: string | null;
};

function rowToJob(row: JobRow): UploadJobState {
  return {
    id: row.id,
    userEmail: row.userEmail,
    connectionId: row.connectionId,
    channelId: row.channelId,
    channelTitle: row.channelTitle,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    mediaAssetId: row.mediaAssetId,
    thumbnailAssetId: row.thumbnailAssetId,
    status: row.status as JobStatus,
    progressBytes: byteCount(row.progressBytes),
    byteSize: byteCount(row.byteSize),
    bytesAcked: byteCount(row.bytesAcked),
    attemptCount: row.attemptCount,
    completionUncertain: row.completionUncertain,
    nextAttemptAt: row.nextAttemptAt,
    resumableSessionEnc: row.resumableSessionEnc,
    youtubeVideoId: row.youtubeVideoId,
    requestedVisibility: row.requestedVisibility as Visibility,
    publicationIntent: row.publicationIntent,
    publishAt: row.publishAt,
    metadata: JSON.parse(row.metadataJson) as NormalizedUpload,
    actualVisibility: row.actualVisibility,
    restriction: row.restriction,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    thumbnailError: row.thumbnailError,
    thumbnailStatus: row.thumbnailStatus,
  };
}

function jobData(job: UploadJobState) {
  return {
    status: job.status,
    progressBytes: BigInt(byteCount(job.bytesAcked)),
    byteSize: BigInt(byteCount(job.byteSize)),
    bytesAcked: BigInt(byteCount(job.bytesAcked)),
    attemptCount: job.attemptCount,
    completionUncertain: job.completionUncertain,
    nextAttemptAt: job.nextAttemptAt,
    resumableSessionEnc: job.resumableSessionEnc,
    youtubeVideoId: job.youtubeVideoId,
    requestedVisibility: job.requestedVisibility,
    publicationIntent: job.publicationIntent,
    publishAt: job.publishAt,
    metadataJson: JSON.stringify(job.metadata),
    actualVisibility: job.actualVisibility,
    restriction: job.restriction,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage?.slice(0, 500) ?? null,
    thumbnailError: job.thumbnailError?.slice(0, 500) ?? null,
    thumbnailStatus: job.thumbnailStatus,
  };
}

export async function enqueueVideoUpload(input: EnqueueInput, options?: { schedule?: boolean }): Promise<Record<string, unknown>> {
  if (!youtubeConfigured()) {
    throw new YoutubeUserError('not_configured', 'Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and YOUTUBE_TOKEN_ENCRYPTION_KEY on the server.');
  }
  const job = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "YoutubeMediaAsset"
      WHERE "userEmail" = ${input.accountId} AND id = ${input.mediaAssetId} FOR UPDATE`;
    return enqueueWithRepo({
      findConnection: async (accountId, connectionId) => tx.youtubeConnection.findFirst({
        where: { id: connectionId, userEmail: accountId },
        select: { id: true, userEmail: true, channelId: true, channelTitle: true, status: true, statusDetail: true },
      }),
      findAsset: async (accountId, assetId) => {
        const row = await tx.youtubeMediaAsset.findFirst({
          where: { id: assetId, userEmail: accountId },
          select: { id: true, userEmail: true, kind: true, status: true, byteSize: true, expiresAt: true },
        });
        return row ? { ...row, byteSize: row.byteSize === null ? null : byteCount(row.byteSize) } : null;
      },
      findJobByKey: async (accountId, idempotencyKey) => {
        const row = await tx.youtubeUploadJob.findUnique({ where: { userEmail_idempotencyKey: { userEmail: accountId, idempotencyKey } } });
        return row ? rowToJob(row) : null;
      },
      insertJob: async (created) => {
        await tx.youtubeUploadJob.create({ data: { id: created.id, userEmail: created.userEmail, connectionId: created.connectionId, channelId: created.channelId, channelTitle: created.channelTitle, idempotencyKey: created.idempotencyKey, requestHash: created.requestHash, mediaAssetId: created.mediaAssetId, thumbnailAssetId: created.thumbnailAssetId, ...jobData(created) } });
      },
    }, input);
  }, { isolationLevel: 'ReadCommitted' });
  if (options?.schedule !== false) scheduleYoutubeWork();
  return toPublicJob(job);
}

export async function uploadStatus(accountId: string, jobId: string): Promise<Record<string, unknown>> {
  const row = await prisma.youtubeUploadJob.findFirst({ where: { id: jobId, userEmail: accountId } });
  if (!row) throw new YoutubeUserError('not_found', 'That upload job does not belong to this account.');
  return {
    ...toPublicJob(rowToJob(row)),
    updatedAt: row.updatedAt.toISOString(),
    workerLeaseAt: row.lockedAt?.toISOString() ?? null,
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    // Kept null for backwards compatibility: YouTube videos never auto-expire.
    deletesAt: null,
    automaticYoutubeDeletion: false,
    localMediaRetentionDays: 7,
  };
}

const workerGlobal = globalThis as typeof globalThis & { lotlisterYoutubeWorker?: ReturnType<typeof createYoutubeWorker> };

let operatorHolds: Promise<void> | undefined;
export function applyConfiguredYoutubeHolds(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.argv.includes('build')) return Promise.resolve();
  operatorHolds ??= applyOperatorHolds(process.env.YOUTUBE_UPLOAD_HOLDS, {
    read: async jobId => {
      const row = await prisma.youtubeUploadJob.findFirst({ where: { id: jobId } });
      return row ? { jobId: row.id, connectionId: row.connectionId, channelId: row.channelId,
        idempotencyKey: row.idempotencyKey, userEmail: row.userEmail } : null;
    },
    hold: holdUnstartedUpload,
    log: jobId => log.info('youtube operator hold verified', { jobId }),
  });
  return operatorHolds;
}

export function startYoutubeWorker(): void {
  if (workerGlobal.lotlisterYoutubeWorker || !youtubeConfigured()
    || process.env.YOUTUBE_WORKER_ENABLED === 'false'
    || process.env.NEXT_PHASE === 'phase-production-build' || process.argv.includes('build')) return;
  workerGlobal.lotlisterYoutubeWorker = createYoutubeWorker(
    () => processPendingYoutubeJobs({ budgetMs: 60_000, maxJobs: 8 }),
    (error) => log.error('youtube drain failed', { message: error instanceof Error ? redactSecrets(error.message).slice(0, 300) : 'failed' }),
  );
  workerGlobal.lotlisterYoutubeWorker.wake();
}

export function scheduleYoutubeWork(): void {
  startYoutubeWorker();
  workerGlobal.lotlisterYoutubeWorker?.wake();
}

export async function processPendingYoutubeJobs(options?: { budgetMs?: number; maxJobs?: number }): Promise<{ processed: number }> {
  if (!youtubeConfigured() || process.env.YOUTUBE_WORKER_ENABLED === 'false') return { processed: 0 };
  await expireLocalVideoFiles().catch((error: unknown) => {
    log.warn('local video cleanup failed', { message: error instanceof Error ? redactSecrets(error.message).slice(0, 200) : 'failed' });
  });
  await applyConfiguredYoutubeHolds();
  const budgetMs = options?.budgetMs ?? 60_000;
  const maxJobs = options?.maxJobs ?? 2;
  const started = Date.now();
  let processed = 0;
  const visited: string[] = [];
  const channels: string[] = [];
  while (processed < maxJobs && Date.now() - started < budgetMs) {
    const claimed = await claimNextJob(visited, channels).catch((error: unknown) => {
      log.warn('youtube claim failed', { message: error instanceof Error ? redactSecrets(error.message).slice(0, 200) : 'failed' });
      return null;
    });
    if (!claimed) break;
    visited.push(claimed.id);
    channels.push(claimed.channelId);
    // Give large uploads a slice rather than the entire drain budget.
    await runClaimed(claimed, Math.min(started + budgetMs, Date.now() + 20_000));
    processed += 1;
  }
  return { processed };
}

export async function claimNextJob(visited: string[] = [], channels: string[] = []): Promise<JobRow | null> {
  const token = randomBytes(16).toString('hex');
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 120_000);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "YoutubeUploadJob" AS job
    SET "lockedAt" = ${now}, "lockToken" = ${token}, "updatedAt" = ${now}
    WHERE job."id" = (
      SELECT candidate."id" FROM "YoutubeUploadJob" AS candidate
      WHERE candidate."status" IN ('queued', 'waiting_media', 'uploading', 'uploaded', 'processing')
        ${visited.length ? Prisma.sql`AND candidate."id" NOT IN (${Prisma.join(visited)})` : Prisma.empty}
        ${channels.length ? Prisma.sql`AND candidate."channelId" NOT IN (${Prisma.join(channels)})` : Prisma.empty}
        AND (candidate."nextAttemptAt" IS NULL OR candidate."nextAttemptAt" <= ${now})
        AND (candidate."lockedAt" IS NULL OR candidate."lockedAt" < ${staleBefore})
        AND EXISTS (
          SELECT 1 FROM "YoutubeConnection" AS connection
          WHERE connection."id" = candidate."connectionId"
            AND connection."status" = 'connected'
        )
        AND NOT EXISTS (
          SELECT 1 FROM "YoutubeUploadJob" AS blocked
          WHERE blocked."status" IN ('queued', 'uploading', 'uploaded', 'processing')
            AND blocked."nextAttemptAt" > ${now}
            AND (
              blocked."errorCode" IN ('quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded')
              OR (blocked."channelId" = candidate."channelId" AND blocked."userEmail" = candidate."userEmail"
                  AND (blocked."errorCode" = 'userRateLimitExceeded'
                    OR (blocked."errorCode" = 'uploadLimitExceeded' AND candidate."youtubeVideoId" IS NULL AND candidate."resumableSessionEnc" IS NULL)))
            )
        )
      ORDER BY COALESCE(candidate."nextAttemptAt", candidate."createdAt") ASC, candidate."createdAt" ASC, candidate."id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING job."id"
  `;
  const id = rows[0]?.id;
  if (!id) return null;
  const row = await prisma.youtubeUploadJob.findFirst({ where: { id, lockToken: token } });
  return row;
}

async function runClaimed(row: JobRow, deadline: number): Promise<void> {
  const lockToken = (row as JobRow & { lockToken?: string | null }).lockToken ?? null;
  const write = async (job: UploadJobState, lock: { lockedAt: Date | null; lockToken: string | null }) => {
    const updated = await prisma.youtubeUploadJob.updateMany({
      where: { id: job.id, lockToken: lockToken ?? undefined },
      data: { ...jobData(job), lockedAt: lock.lockedAt, lockToken: lock.lockToken },
    });
    if (updated.count === 0) throw new YoutubeUserError('lock_lost', 'Upload lock lost');
    if (job.youtubeVideoId) {
      await prisma.youtubeUploadJob.updateMany({
        where: { id: job.id, uploadedAt: null },
        data: { uploadedAt: new Date() },
      });
    }
  };
  const io = prismaIo(async (job) => write(job, { lockedAt: new Date(), lockToken }));
  io.deadline = () => deadline;
  // Long downloads/API calls must not let another process steal a live lease.
  let heartbeatPending: Promise<unknown> | undefined;
  const heartbeat = setInterval(() => {
    if (heartbeatPending) return;
    heartbeatPending = prisma.youtubeUploadJob.updateMany({
      where: { id: row.id, lockToken: lockToken ?? undefined },
      data: { lockedAt: new Date() },
    }).catch(() => undefined).finally(() => { heartbeatPending = undefined; });
  }, 30_000);
  heartbeat.unref();
  try {
    const next = await advanceUpload(rowToJob(row), io);
    await write(next, { lockedAt: null, lockToken: null });
    log.info('youtube job', { jobId: next.id, status: next.status, errorCode: next.errorCode });
  } catch (error) {
    if (error instanceof YoutubeUserError && error.code === 'lock_lost') return;
    const latest = await prisma.youtubeUploadJob.findFirst({ where: { id: row.id, lockToken: lockToken ?? undefined } }).catch(() => null);
    const current = rowToJob(latest ?? row);
    const message = error instanceof Error ? redactSecrets(error.message) : 'Upload failed.';
    const reconnect = error instanceof YoutubeUserError && error.code === 'reconnect_required';
    if (reconnect) await markConnectionReconnect(row.connectionId, message).catch(() => undefined);
    const paused = reconnect
      ? { ...current, status: 'queued' as const, errorCode: 'reconnect_required', errorMessage: message, nextAttemptAt: null }
      : pause(current, message, Date.now(), error instanceof YoutubeUserError ? error.code : 'transient');
    await write(paused, { lockedAt: null, lockToken: null }).catch(() => undefined);
    log.warn('youtube job error', { jobId: row.id, status: paused.status, errorCode: paused.errorCode });
  } finally {
    clearInterval(heartbeat);
    await heartbeatPending;
  }
}

/** Only holds uploads that provably have not started. This is not video deletion.
 * The conditional update races safely with claimNextJob's row lock.
 */
export async function holdUnstartedUpload(accountId: string, jobId: string): Promise<Record<string, unknown>> {
  const row = await prisma.youtubeUploadJob.findFirst({ where: { id: jobId, userEmail: accountId } });
  if (!row) throw new YoutubeUserError('not_found', 'That upload job does not belong to this account.');
  if (row.status === 'held') return toPublicJob(rowToJob(row));
  // A rejected session-start request is stored as `uploading` by pause(),
  // even though no transfer exists. After reconnecting, that legacy job cannot
  // be claimed on its old connection. Recover only an expired, explicit quota
  // wait, with the same no-session/no-bytes/no-worker proof as queued work.
  // Matching its observed deadline and error in the UPDATE also rejects a
  // concurrent retry that changes either value. Never shorten a quota wait.
  // Before quota reasons were preserved, the API mapped this exact local
  // uploadLimitExceeded message to `transient`. Do not accept arbitrary
  // transient failures: they can represent an ambiguous session creation.
  // The old retry delay was short, so also require a full channel cooldown.
  const legacyChannelLimit = row.errorCode === 'transient'
    && row.errorMessage === 'This YouTube channel has hit an upload limit. Wait and try again later with a new idempotency key only after you confirm the video was not created.'
    && row.updatedAt.getTime() <= Date.now() - 60 * 60_000;
  const expiredQuotaWait = row.status === 'uploading'
    && (legacyChannelLimit || ['uploadLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].includes(row.errorCode ?? ''))
    && row.nextAttemptAt !== null && row.nextAttemptAt.getTime() <= Date.now();
  const stateGuard = expiredQuotaWait
    ? { status: 'uploading', errorCode: row.errorCode, errorMessage: row.errorMessage, updatedAt: row.updatedAt, nextAttemptAt: row.nextAttemptAt }
    : { status: { in: ['queued', 'waiting_media'] } };
  const result = await prisma.youtubeUploadJob.updateMany({
    where: {
      id: jobId, userEmail: accountId, ...stateGuard,
      lockToken: null, lockedAt: null, youtubeVideoId: null, resumableSessionEnc: null,
      bytesAcked: 0, progressBytes: 0, uploadedAt: null, completionUncertain: false,
    },
    data: { status: 'held', nextAttemptAt: null, errorCode: 'operator_hold', errorMessage: 'Held by the account owner before transfer. No video was created by this job.' },
  });
  if (!result.count) throw new YoutubeUserError('job_started', 'The job is active, has started, or has uncertain completion. Reconcile it before taking further action; nothing was canceled.');
  return uploadStatus(accountId, jobId);
}

function prismaIo(persist: (job: UploadJobState) => Promise<void>): UploadIo {
  return {
    now: () => Date.now(),
    deadline: () => Date.now() + 60_000,
    persist,
    loadAsset: async (accountId, assetId) => {
      const row = await prisma.youtubeMediaAsset.findFirst({ where: { id: assetId, userEmail: accountId } });
      return row ? { ...row, byteSize: row.byteSize === null ? null : byteCount(row.byteSize) } : null;
    },
    markAssetReady: async (assetId, byteSize, contentType) => {
      await prisma.youtubeMediaAsset.update({ where: { id: assetId }, data: { status: 'ready', byteSize: BigInt(byteCount(byteSize)), contentType, errorMessage: null } });
    },
    markAssetFailed: async (assetId, message) => {
      await prisma.youtubeMediaAsset.update({ where: { id: assetId }, data: { status: 'failed', errorMessage: message.slice(0, 400) } });
    },
    downloadAsset: async (asset, maxBytes) => {
      if (!asset.sourceUrl) throw new YoutubeUserError('invalid_media', 'Missing source URL.');
      const saved = await downloadPublicHttps(asset.sourceUrl, resolveMediaPath(asset.storagePath), { maxBytes });
      return { byteSize: saved.byteSize, contentType: saved.sniffed.contentType };
    },
    accessToken: (job) => getValidAccessToken(job.userEmail, job.connectionId),
    readSlice: async (asset, start, length) => {
      const handle = await fs.open(resolveMediaPath(asset.storagePath), 'r');
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        if (bytesRead !== length) throw new YoutubeUserError('invalid_media', 'The stored video is shorter than expected.');
        return buffer;
      } finally {
        await handle.close();
      }
    },
    startSession: (token, job, contentType) => startResumableSession(token, job.metadata, job.byteSize, contentType),
    querySession: (token, sessionUri, total) => probeOrUpload({ token, sessionUri, total }),
    uploadChunk: (token, sessionUri, contentType, start, chunk, total) => probeOrUpload({ token, sessionUri, total, start, chunk, contentType }),
    getVideo: (token, videoId) => getVideo(token, videoId),
    setThumbnail: (token, videoId, bytes, contentType) => setThumbnail(token, videoId, bytes, contentType),
    readFile: (asset) => fs.readFile(resolveMediaPath(asset.storagePath)),
    encrypt: (value) => encryptString(value),
    decrypt: (value) => decryptString(value),
  };
}

export function storagePathFor(accountId: string, assetId: string): string {
  return relativeMediaPath(accountId, assetId);
}
