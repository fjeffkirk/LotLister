import { getPublicBaseUrl } from '../ebay';
import { YoutubeUserError } from './types';

/**
 * Minimum scopes for the operations this integration actually calls.
 * Checked against Google's method pages on 2026-10-12:
 * - videos.insert and thumbnails.set accept youtube.upload
 *   https://developers.google.com/youtube/v3/docs/videos/insert
 *   https://developers.google.com/youtube/v3/docs/thumbnails/set
 * - videos.update does not list youtube.upload. It requires youtube, youtube.force-ssl, or youtubepartner.
 *   youtube.force-ssl is the narrower of those (see/edit videos) and is what metadata, privacy, and scheduling use.
 *   https://developers.google.com/youtube/v3/docs/videos/update
 * - youtube.readonly is "View your YouTube account" and is what channels.list?mine=true and videos.list use
 *   to read the channel id and the verified upload/processing/privacy state.
 *   https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
 * youtubepartner and the full youtube manage-account scope are not requested.
 */
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.readonly',
] as const;

export const YOUTUBE_CALLBACK_PATH = '/api/youtube/callback';

const DEFAULT_MAX_UPLOAD_BYTES = 400 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
export const UPLOAD_URL_TTL_MS = 30 * 60 * 1000;
export const SCHEDULE_LEAD_MS = 2 * 60 * 1000;
export const CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_TRANSIENT_ATTEMPTS = 6;

export function youtubeCallbackUrl(origin: string): string {
  return `${getPublicBaseUrl(origin)}${YOUTUBE_CALLBACK_PATH}`;
}

export function missingYoutubeEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!env.GOOGLE_OAUTH_CLIENT_ID?.trim()) missing.push('GOOGLE_OAUTH_CLIENT_ID');
  if (!env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()) missing.push('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!env.YOUTUBE_TOKEN_ENCRYPTION_KEY?.trim()) missing.push('YOUTUBE_TOKEN_ENCRYPTION_KEY');
  return missing;
}

export function youtubeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return missingYoutubeEnv(env).length === 0;
}

export function maxUploadBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.YOUTUBE_MAX_UPLOAD_BYTES);
  if (!Number.isFinite(raw) || raw < 1024) return DEFAULT_MAX_UPLOAD_BYTES;
  return Math.min(Math.floor(raw), 1024 * 1024 * 1024);
}

export function googleCredentials(env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret: string } {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) {
    throw new YoutubeUserError('not_configured', `YouTube OAuth is not configured. Set ${missingYoutubeEnv(env).join(', ')} on the server.`);
  }
  return { clientId, clientSecret };
}
