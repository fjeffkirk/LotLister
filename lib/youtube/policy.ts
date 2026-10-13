import { createHash } from 'crypto';
import { SCHEDULE_LEAD_MS } from './config';
import {
  type NormalizedUpload,
  type SessionQuery,
  type UploadJobState,
  type Visibility,
  type YoutubeVideo,
  YoutubeUserError,
} from './types';

const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;
const OFFSET_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/;
const NAIVE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export interface UploadInput {
  connectionId: string;
  mediaAssetId: string;
  thumbnailAssetId?: string | null;
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
}

export function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(refresh_token|access_token|client_secret|code)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/ya29\.[A-Za-z0-9_\-]+/g, '[redacted]')
    .replace(/upload_id=[^&\s]+/gi, 'upload_id=[redacted]')
    .replace(/https:\/\/www\.googleapis\.com\/upload\/\S+/gi, 'https://www.googleapis.com/upload/[redacted]');
}

export function assertSameAccount(owner: string, actor: string, label: string): void {
  if (owner !== actor) {
    throw new YoutubeUserError('not_found', `That ${label} does not belong to this account.`);
  }
}

export function assertSameChannel(videoChannelId: string | undefined, connectionChannelId: string): void {
  if (!videoChannelId || videoChannelId !== connectionChannelId) {
    throw new YoutubeUserError(
      'wrong_channel',
      'This video is not on the selected YouTube channel. Pass the connectionId for the channel that owns it. Compare the channel id in LotLister settings with YouTube Studio before trying again.',
    );
  }
}

export function watchUrl(videoId: string | null | undefined): string | null {
  if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function studioUrl(videoId: string | null | undefined): string | null {
  if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
  return `https://studio.youtube.com/video/${videoId}/edit`;
}

function requireDeclaration(name: string, value: unknown, sentence: string): boolean {
  if (typeof value !== 'boolean') {
    throw new YoutubeUserError('declaration_required', `${name} is required. ${sentence}`);
  }
  return value;
}

function cleanTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const cleaned = tags.map((tag) => tag.trim()).filter(Boolean);
  if (cleaned.some((tag) => tag.length > 100 || /[,\r\n]/.test(tag))) {
    throw new YoutubeUserError('invalid_tags', 'Each tag must be 100 characters or fewer and cannot contain commas or line breaks.');
  }
  if (cleaned.length > 30 || cleaned.reduce((sum, tag) => sum + tag.length, 0) > 500) {
    throw new YoutubeUserError('invalid_tags', 'YouTube allows at most 30 tags and 500 characters of tags in total.');
  }
  return cleaned;
}

function cleanLanguage(value: string | undefined, label: string): string | null {
  if (!value) return null;
  const language = value.trim();
  if (!LANGUAGE.test(language)) {
    throw new YoutubeUserError('invalid_language', `${label} must be a BCP-47 tag such as en or en-US.`);
  }
  return language;
}

export function assertTimeZone(timeZone: string): void {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new YoutubeUserError('invalid_schedule', `timeZone "${timeZone}" is not a valid IANA timezone such as America/New_York.`);
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatWall(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}`;
}

function offsetAt(instantMs: number, timeZone: string): number {
  const wall = formatWall(new Date(instantMs), timeZone);
  const match = NAIVE_TIME.exec(wall);
  if (!match) return 0;
  const asUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? '0'));
  return asUtc - instantMs;
}

function zonedWallToUtc(wall: string, timeZone: string): Date {
  const match = NAIVE_TIME.exec(wall);
  if (!match) {
    throw new YoutubeUserError('invalid_schedule', 'publishAt must look like 2026-10-20T09:00:00. Add a timeZone, or include Z or a numeric offset.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw new YoutubeUserError('invalid_schedule', 'publishAt is not a real calendar time.');
  }
  assertTimeZone(timeZone);
  const wanted = `${match[1]}-${match[2]}-${match[3]}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = offsetAt(utcGuess, timeZone);
  let utc = utcGuess - firstOffset;
  const secondOffset = offsetAt(utc, timeZone);
  if (secondOffset !== firstOffset) utc = utcGuess - secondOffset;
  if (formatWall(new Date(utc), timeZone) !== wanted) {
    throw new YoutubeUserError('invalid_schedule', `That local time does not exist in ${timeZone} (daylight-saving gap). Pick a different time or send publishAt with a numeric offset.`);
  }
  const neighbors = [utc - 3600_000, utc + 3600_000];
  if (neighbors.some((candidate) => candidate !== utc && formatWall(new Date(candidate), timeZone) === wanted)) {
    throw new YoutubeUserError('invalid_schedule', `That local time happens twice in ${timeZone}. Send publishAt with Z or a numeric offset so the instant is unambiguous.`);
  }
  return new Date(utc);
}

export function resolvePublishInstant(publishAt: string, timeZone: string | undefined, now: Date): Date {
  const value = publishAt.trim();
  let instant: Date;
  if (OFFSET_TIME.test(value)) {
    if (timeZone) assertTimeZone(timeZone);
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) throw new YoutubeUserError('invalid_schedule', 'publishAt could not be parsed.');
    instant = new Date(parsed);
  } else if (NAIVE_TIME.test(value)) {
    if (!timeZone?.trim()) {
      throw new YoutubeUserError('invalid_schedule', 'Pass timeZone as an IANA name such as America/New_York, or include Z or a numeric offset on publishAt.');
    }
    instant = zonedWallToUtc(value, timeZone.trim());
  } else {
    throw new YoutubeUserError('invalid_schedule', 'publishAt must be an ISO-8601 time like 2026-10-20T09:00:00 with timeZone, or 2026-10-20T13:00:00Z.');
  }
  if (instant.getTime() < now.getTime() + SCHEDULE_LEAD_MS) {
    throw new YoutubeUserError(
      'invalid_schedule',
      'That publish time is not at least 2 minutes in the future. YouTube publishes immediately when publishAt is in the past, so this request was rejected before anything was scheduled.',
    );
  }
  return instant;
}

export function normalizeUploadRequest(input: UploadInput, now: Date): NormalizedUpload {
  const title = input.title?.trim() ?? '';
  if (!title || title.length > 100) {
    throw new YoutubeUserError('invalid_title', 'Title is required and must be 100 characters or fewer.');
  }
  const description = input.description ?? '';
  if (description.length > 5000) {
    throw new YoutubeUserError('invalid_description', 'Description must be 5000 characters or fewer.');
  }
  if (!/^\d{1,3}$/.test(input.categoryId?.trim() ?? '')) {
    throw new YoutubeUserError('invalid_category', 'categoryId is required and must be a YouTube numeric category id such as 22. LotLister does not pick one for you.');
  }
  const madeForKids = requireDeclaration(
    'madeForKids',
    input.madeForKids,
    'Pass true or false. LotLister will not guess whether the video is made for kids.',
  );
  const containsSyntheticMedia = requireDeclaration(
    'containsSyntheticMedia',
    input.containsSyntheticMedia,
    'Pass true or false to declare whether the video contains altered or synthetic media. LotLister will not invent this declaration.',
  );
  const visibility: Visibility = input.visibility ?? 'private';
  if (!['private', 'unlisted', 'public'].includes(visibility)) {
    throw new YoutubeUserError('invalid_visibility', 'visibility must be private, unlisted, or public.');
  }
  const scheduling = Boolean(input.publishAt?.trim());
  if ((visibility !== 'private' || scheduling) && input.publicationIntent !== true) {
    throw new YoutubeUserError(
      'publication_intent_required',
      'Public, unlisted, and scheduled uploads require publicationIntent set to boolean true. Omit visibility to keep the video private.',
    );
  }
  if (scheduling && visibility !== 'private') {
    throw new YoutubeUserError(
      'invalid_schedule',
      'Scheduling requires the video to stay private until YouTube publishes it. Omit visibility or set it to private, and pass publicationIntent true.',
    );
  }
  const publishAt = scheduling ? resolvePublishInstant(input.publishAt!.trim(), input.timeZone, now).toISOString() : null;
  const language = cleanLanguage(input.language, 'language');
  const audioLanguage = cleanLanguage(input.audioLanguage, 'audioLanguage') ?? language;
  const tags = cleanTags(input.tags);
  const normalized: Omit<NormalizedUpload, 'requestHash'> = {
    privacyStatus: scheduling ? 'private' : visibility,
    publishAt,
    publicationIntent: input.publicationIntent === true,
    title,
    description,
    tags,
    categoryId: input.categoryId.trim(),
    defaultLanguage: language,
    defaultAudioLanguage: audioLanguage,
    madeForKids,
    containsSyntheticMedia,
  };
  const requestHash = createHash('sha256').update(JSON.stringify({
    connectionId: input.connectionId,
    mediaAssetId: input.mediaAssetId,
    thumbnailAssetId: input.thumbnailAssetId ?? null,
    ...normalized,
    publicationIntent: undefined,
  })).digest('hex');
  return { ...normalized, requestHash };
}

export function buildInsertBody(upload: NormalizedUpload): { part: string; body: Record<string, unknown> } {
  const snippet: Record<string, unknown> = {
    title: upload.title,
    description: upload.description,
    categoryId: upload.categoryId,
  };
  if (upload.tags.length > 0) snippet.tags = upload.tags;
  if (upload.defaultLanguage) snippet.defaultLanguage = upload.defaultLanguage;
  if (upload.defaultAudioLanguage) snippet.defaultAudioLanguage = upload.defaultAudioLanguage;
  const status: Record<string, unknown> = {
    privacyStatus: upload.privacyStatus,
    selfDeclaredMadeForKids: upload.madeForKids,
    containsSyntheticMedia: upload.containsSyntheticMedia,
  };
  if (upload.publishAt) status.publishAt = upload.publishAt;
  return { part: 'snippet,status', body: { snippet, status } };
}

export interface MetadataPatch {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  language?: string | null;
  audioLanguage?: string | null;
  madeForKids?: boolean;
  containsSyntheticMedia?: boolean;
}

export function buildMetadataUpdate(existing: YoutubeVideo, patch: MetadataPatch): { part: string; body: Record<string, unknown> } {
  if (!existing.id) throw new YoutubeUserError('not_found', 'YouTube did not return a video id.');
  const snippetKeys = ['title', 'description', 'tags', 'categoryId', 'language', 'audioLanguage'] as const;
  const touchesSnippet = snippetKeys.some((key) => patch[key] !== undefined);
  const touchesStatus = patch.madeForKids !== undefined || patch.containsSyntheticMedia !== undefined;
  if (!touchesSnippet && !touchesStatus) {
    throw new YoutubeUserError('nothing_to_update', 'Pass at least one metadata field to change. Fields you omit are left as they are.');
  }
  const body: Record<string, unknown> = { id: existing.id };
  const parts: string[] = [];
  if (touchesSnippet) {
    const snippet = existing.snippet ?? {};
    const title = patch.title !== undefined ? patch.title.trim() : snippet.title ?? '';
    if (!title || title.length > 100) {
      throw new YoutubeUserError('invalid_title', 'The resulting title must be 1 to 100 characters. YouTube requires a title whenever snippet metadata is sent.');
    }
    const description = patch.description !== undefined ? patch.description : snippet.description ?? '';
    if (description.length > 5000) throw new YoutubeUserError('invalid_description', 'Description must be 5000 characters or fewer.');
    const categoryId = patch.categoryId !== undefined ? patch.categoryId.trim() : snippet.categoryId ?? '';
    if (!/^\d{1,3}$/.test(categoryId)) {
      throw new YoutubeUserError('invalid_category', 'YouTube requires categoryId when snippet metadata is updated. Pass the existing category or a new numeric category id.');
    }
    const tags = patch.tags !== undefined ? cleanTags(patch.tags) : [...(snippet.tags ?? [])];
    const defaultLanguage = patch.language !== undefined ? cleanLanguage(patch.language ?? undefined, 'language') : snippet.defaultLanguage ?? null;
    const defaultAudioLanguage = patch.audioLanguage !== undefined
      ? cleanLanguage(patch.audioLanguage ?? undefined, 'audioLanguage')
      : snippet.defaultAudioLanguage ?? null;
    const nextSnippet: Record<string, unknown> = { title, description, tags, categoryId };
    if (defaultLanguage) nextSnippet.defaultLanguage = defaultLanguage;
    if (defaultAudioLanguage) nextSnippet.defaultAudioLanguage = defaultAudioLanguage;
    body.snippet = nextSnippet;
    parts.push('snippet');
  }
  if (touchesStatus) {
    body.status = preservedStatus(existing, {
      selfDeclaredMadeForKids: patch.madeForKids,
      containsSyntheticMedia: patch.containsSyntheticMedia,
    });
    parts.push('status');
  }
  return { part: parts.join(','), body };
}

function preservedStatus(existing: YoutubeVideo, patch: {
  privacyStatus?: Visibility;
  publishAt?: string | null;
  selfDeclaredMadeForKids?: boolean;
  containsSyntheticMedia?: boolean;
}): Record<string, unknown> {
  const current = existing.status ?? {};
  const privacy = patch.privacyStatus ?? (current.privacyStatus as Visibility | undefined) ?? 'private';
  const status: Record<string, unknown> = { privacyStatus: privacy };
  if (current.embeddable !== undefined) status.embeddable = current.embeddable;
  if (current.license) status.license = current.license;
  if (current.publicStatsViewable !== undefined) status.publicStatsViewable = current.publicStatsViewable;
  const made = patch.selfDeclaredMadeForKids !== undefined ? patch.selfDeclaredMadeForKids : current.selfDeclaredMadeForKids;
  if (made !== undefined) status.selfDeclaredMadeForKids = made;
  const synthetic = patch.containsSyntheticMedia !== undefined ? patch.containsSyntheticMedia : current.containsSyntheticMedia;
  if (synthetic !== undefined) status.containsSyntheticMedia = synthetic;
  const clearingSchedule = patch.privacyStatus === 'public' || patch.privacyStatus === 'unlisted';
  if (!clearingSchedule) {
    if (patch.publishAt) status.publishAt = patch.publishAt;
    else if (patch.publishAt === undefined && current.publishAt) status.publishAt = current.publishAt;
  }
  return status;
}

export function buildPublishBody(existing: YoutubeVideo, visibility: 'public' | 'unlisted'): { part: string; body: Record<string, unknown> } {
  if (!existing.id) throw new YoutubeUserError('not_found', 'YouTube did not return a video id.');
  return {
    part: 'status',
    body: { id: existing.id, status: preservedStatus(existing, { privacyStatus: visibility, publishAt: null }) },
  };
}

export function buildScheduleBody(existing: YoutubeVideo, publishAt: string): { part: string; body: Record<string, unknown> } {
  if (!existing.id) throw new YoutubeUserError('not_found', 'YouTube did not return a video id.');
  const blocked = scheduleBlockReason(existing);
  if (blocked) throw new YoutubeUserError('not_schedulable', blocked);
  return {
    part: 'status',
    body: { id: existing.id, status: preservedStatus(existing, { privacyStatus: 'private', publishAt }) },
  };
}

export function scheduleBlockReason(video: YoutubeVideo): string | null {
  const privacy = video.status?.privacyStatus;
  const upload = video.status?.uploadStatus;
  const processing = video.processingDetails?.processingStatus;
  if (upload === 'rejected') return 'YouTube rejected this video, so it cannot be scheduled.';
  if (upload === 'failed' || upload === 'deleted' || processing === 'failed') {
    return 'YouTube did not finish this video successfully, so it cannot be scheduled.';
  }
  if (privacy === 'public' || privacy === 'unlisted') {
    return `YouTube only schedules a video while it is private and has never been published. This video is already ${privacy}.`;
  }
  if (privacy && privacy !== 'private') {
    return `This video's privacy status is ${privacy}. Scheduling requires privacyStatus private.`;
  }
  if (!privacy) return 'YouTube did not confirm that this video is private, so it was not scheduled.';
  return null;
}

export function requirePublicationIntent(value: unknown, action: string): void {
  if (value !== true) {
    throw new YoutubeUserError('publication_intent_required', `${action} requires publicationIntent set to boolean true.`);
  }
}

export type VideoLifecycle = 'uploaded' | 'processing' | 'processed' | 'rejected' | 'failed';

export function interpretVideo(video: YoutubeVideo): { state: VideoLifecycle; reason: string | null } {
  const upload = video.status?.uploadStatus;
  const processing = video.processingDetails?.processingStatus;
  if (upload === 'rejected') return { state: 'rejected', reason: video.status?.rejectionReason || 'rejected' };
  if (upload === 'failed' || upload === 'deleted') return { state: 'failed', reason: video.status?.failureReason || upload || 'failed' };
  if (processing === 'failed') return { state: 'failed', reason: video.processingDetails?.processingFailureReason || 'processing_failed' };
  if (processing === 'succeeded' || upload === 'processed') return { state: 'processed', reason: null };
  if (processing === 'processing') return { state: 'processing', reason: null };
  if (upload === 'uploaded') return { state: 'uploaded', reason: null };
  return { state: 'uploaded', reason: null };
}

export function visibilityReport(requested: string, actual: string | null | undefined): {
  actualVisibility: string | null;
  matchesRequest: boolean;
  restriction: string | null;
} {
  if (!actual) {
    return {
      actualVisibility: null,
      matchesRequest: false,
      restriction: 'YouTube has not returned a privacy status yet. Do not assume the requested visibility was applied.',
    };
  }
  if (actual === requested) return { actualVisibility: actual, matchesRequest: true, restriction: null };
  const audit = (requested === 'public' || requested === 'unlisted') && actual === 'private'
    ? ' Uploads from API projects that have not passed the YouTube API compliance audit stay private, and requesting public or unlisted does not override that.'
    : '';
  return {
    actualVisibility: actual,
    matchesRequest: false,
    restriction: `Requested ${requested}, but YouTube reports ${actual}.${audit}`,
  };
}

export function regionNotes(video: YoutubeVideo): string | null {
  const region = video.contentDetails?.regionRestriction;
  if (region?.blocked?.length) return `YouTube reports this video is blocked in: ${region.blocked.join(', ')}.`;
  if (region?.allowed?.length) return `YouTube reports this video is only viewable in: ${region.allowed.join(', ')}.`;
  return null;
}

export type ResumeAction =
  | { action: 'resume'; fromByte: number }
  | { action: 'complete'; video: YoutubeVideo }
  | { action: 'restart' }
  | { action: 'hold' }
  | { action: 'retry'; message: string }
  | { action: 'fatal'; code: string; message: string };

export function decideResume(job: { completionUncertain: boolean; bytesAcked: number; byteSize: number }, query: SessionQuery): ResumeAction {
  if (query.type === 'complete' && query.video?.id) return { action: 'complete', video: query.video };
  if (query.type === 'incomplete') return { action: 'resume', fromByte: query.acked ?? 0 };
  if (query.type === 'retry') return { action: 'retry', message: query.message || 'YouTube did not finish the status check.' };
  if (query.type === 'fatal') return { action: 'fatal', code: query.code || 'youtube_error', message: query.message || 'YouTube rejected the upload session.' };
  const finishedOrUnknown = job.completionUncertain || (job.byteSize > 0 && job.bytesAcked >= job.byteSize);
  if (finishedOrUnknown) return { action: 'hold' };
  return { action: 'restart' };
}

export function decideIdempotency(existing: { requestHash: string } | null, requestHash: string): 'create' | 'reuse' | 'conflict' {
  if (!existing) return 'create';
  return existing.requestHash === requestHash ? 'reuse' : 'conflict';
}

export function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

export function explainYoutubeFailure(reason: string, message: string): string {
  const clean = redactSecrets(message || reason).slice(0, 400);
  switch (reason) {
    case 'invalid_grant':
    case 'invalid_rapt':
      return 'The Google refresh token expired or was revoked. Reconnect this YouTube channel in LotLister settings. Tokens are not permanent, especially while the OAuth consent screen is in Testing.';
    case 'invalid_client':
      return 'Google rejected the OAuth client. Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET on Render.';
    case 'invalidPublishAt':
      return 'YouTube rejected the scheduled time. The video must be private, must never have been published, and publishAt must be a future ISO-8601 time.';
    case 'forbiddenPrivacySetting':
      return 'YouTube rejected this privacy setting. Leave the upload private, or complete the YouTube API compliance audit before requesting public or unlisted.';
    case 'quotaExceeded':
      return 'This Google Cloud project has used its YouTube Data API quota. videos.insert costs about 1,600 units and the default daily quota is 10,000, which is roughly six uploads.';
    case 'uploadLimitExceeded':
      return 'This YouTube channel has hit an upload limit. Wait and try again later with a new idempotency key only after you confirm the video was not created.';
    case 'forbidden':
      return `${clean} If this was a custom thumbnail, that channel needs phone verification in YouTube Studio → Settings → Channel → Feature eligibility. Verification on a different channel does not count.`;
    case 'videoNotFound':
      return 'YouTube could not find that video for this channel. Check the video id and the connectionId.';
    default:
      return clean || 'YouTube returned an error.';
  }
}

export function parseGoogleError(status: number, body: string): { reason: string; message: string; kind: 'reconnect_required' | 'transient' | 'configuration' | 'permanent' } {
  let reason = '';
  let message = '';
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { message?: string; status?: string; errors?: Array<{ reason?: string; message?: string }> };
      error_description?: string;
    };
    if (typeof parsed.error === 'string') {
      reason = parsed.error;
      message = parsed.error_description || parsed.error;
    } else if (parsed.error) {
      reason = parsed.error.errors?.[0]?.reason || parsed.error.status || '';
      message = parsed.error.errors?.[0]?.message || parsed.error.message || '';
    }
  } catch {
    message = body.slice(0, 180);
  }
  const kind = reason === 'invalid_client'
    ? 'configuration'
    : reason === 'invalid_grant' || reason === 'invalid_rapt' || status === 401
      ? 'reconnect_required'
      : status === 429 || status >= 500
        ? 'transient'
        : 'permanent';
  return { reason: reason || String(status), message: explainYoutubeFailure(reason, message), kind };
}

export function applyVerifiedVideo(job: UploadJobState, video: YoutubeVideo): UploadJobState {
  const interpreted = interpretVideo(video);
  const visibility = visibilityReport(job.requestedVisibility, video.status?.privacyStatus);
  const region = regionNotes(video);
  const restriction = [visibility.restriction, region].filter(Boolean).join(' ') || null;
  const next: UploadJobState = {
    ...job,
    youtubeVideoId: video.id || job.youtubeVideoId,
    actualVisibility: visibility.actualVisibility,
    restriction,
    completionUncertain: false,
    errorCode: interpreted.reason,
    errorMessage: interpreted.reason ? explainYoutubeFailure(interpreted.reason, interpreted.reason) : null,
    nextAttemptAt: null,
  };
  if (interpreted.state === 'rejected' || interpreted.state === 'failed') {
    next.status = interpreted.state === 'rejected' ? 'rejected' : 'failed';
    return next;
  }
  if (interpreted.state === 'processed') {
    next.status = 'processed';
    next.progressBytes = next.byteSize || next.progressBytes;
    return next;
  }
  next.status = interpreted.state === 'processing' ? 'processing' : 'uploaded';
  next.nextAttemptAt = new Date(Date.now() + (interpreted.state === 'processing' ? 30_000 : 15_000));
  next.errorCode = null;
  next.errorMessage = null;
  return next;
}

const TERMINAL = new Set(['processed', 'rejected', 'failed', 'uncertain']);

export function toPublicJob(job: UploadJobState, now = Date.now()): Record<string, unknown> {
  const percent = job.byteSize > 0 ? Math.min(100, Math.round((job.bytesAcked / job.byteSize) * 100)) : 0;
  const visibility = visibilityReport(job.requestedVisibility, job.actualVisibility);
  const processingVerified = job.status === 'processed';
  const videoAccepted = Boolean(job.youtubeVideoId) && job.status !== 'rejected' && !(job.status === 'failed' && !job.youtubeVideoId);
  return {
    jobId: job.id,
    status: job.status,
    terminal: TERMINAL.has(job.status),
    processingVerified,
    videoAccepted,
    connectionId: job.connectionId,
    channelId: job.channelId,
    channelTitle: job.channelTitle,
    requestedVisibility: job.requestedVisibility,
    publicationIntent: job.publicationIntent,
    requestedPublishAt: job.publishAt?.toISOString() ?? job.metadata.publishAt,
    youtubeVideoId: job.youtubeVideoId,
    watchUrl: watchUrl(job.youtubeVideoId),
    studioUrl: studioUrl(job.youtubeVideoId),
    actualVisibility: job.actualVisibility,
    visibilityMatchesRequest: job.actualVisibility ? visibility.matchesRequest : false,
    restriction: job.restriction,
    progress: { bytesUploaded: job.bytesAcked, byteSize: job.byteSize, percent },
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage ? redactSecrets(job.errorMessage) : null } : null,
    thumbnailStatus: job.thumbnailStatus,
    thumbnailError: job.thumbnailError,
    idempotencyKey: job.idempotencyKey,
    nextStep: nextStep(job, now),
  };
}

function nextStep(job: UploadJobState, now: number): string {
  if (job.errorCode === 'reconnect_required') {
    return 'Reconnect this YouTube channel in LotLister settings. This same job will continue and will not start a second video.';
  }
  switch (job.status) {
    case 'waiting_media':
      return 'The video bytes are not in durable storage yet. PUT the raw file to the signed upload URL from youtube_media_upload_prepare, then poll youtube_upload_status with this job id.';
    case 'queued':
    case 'uploading':
      return 'The upload is still running. Poll youtube_upload_status. Do not start another upload with a new idempotency key.';
    case 'uploaded':
    case 'processing':
      return 'YouTube accepted the file and is still processing it. This is not a finished or public video. Poll youtube_upload_status again.';
    case 'processed':
      return job.actualVisibility
        ? `YouTube finished processing. Verified visibility is ${job.actualVisibility}.`
        : 'YouTube finished processing. Visibility was not returned; do not assume it is public.';
    case 'rejected':
      return 'YouTube rejected the video. Read error.message. Do not treat this as uploaded.';
    case 'failed':
      return job.youtubeVideoId
        ? 'YouTube created a video id but processing failed. Check the video in YouTube Studio before uploading again.'
        : 'No completed YouTube video was verified. If error.code is ambiguous_completion, check the channel in YouTube Studio before using a new idempotency key.';
    case 'uncertain':
      return 'The final upload response was lost and the resumable session could not be reconciled. Check this channel in YouTube Studio before using a new idempotency key. A retry with the same key will not start a second upload.';
    default:
      return now ? 'Poll youtube_upload_status.' : 'Poll youtube_upload_status.';
  }
}

export function assertGoogleUploadUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new YoutubeUserError('unsafe_upload', 'The resumable session URL from YouTube was not a URL.');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (host !== 'googleapis.com' && host !== 'www.googleapis.com' && !host.endsWith('.googleapis.com'))) {
    throw new YoutubeUserError('unsafe_upload', 'Refusing a resumable session URL that is not on https://googleapis.com.');
  }
  return url;
}
