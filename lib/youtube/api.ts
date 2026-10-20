import { CHUNK_BYTES } from './config';
import { assertGoogleUploadUrl, buildInsertBody, parseGoogleError, redactSecrets } from './policy';
import { type NormalizedUpload, type SessionQuery, type YoutubeVideo, YoutubeUserError } from './types';

const DATA_API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';

async function authed(url: string, token: string, init: RequestInit = {}, resumablePut = false): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
  const response = await fetch(url, { ...init, headers, signal, redirect: 'manual' });
  // YouTube uses 308 without Location as "Resume Incomplete" for resumable
  // PUTs. It is a progress acknowledgement, not a request to forward a token.
  const resumeIncomplete = resumablePut && init.method === 'PUT'
    && response.status === 308 && !response.headers.has('location');
  if (response.status >= 300 && response.status < 400 && !resumeIncomplete) {
    throw new YoutubeUserError('upstream_redirect', 'YouTube returned a redirect. The access token was not forwarded.');
  }
  return response;
}

async function readError(response: Response): Promise<never> {
  const text = await response.text();
  const parsed = parseGoogleError(response.status, text);
  const limited = ['uploadLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].includes(parsed.reason);
  const code = limited ? parsed.reason : parsed.kind === 'reconnect_required' ? 'reconnect_required'
    : parsed.kind === 'transient' ? 'transient'
      : parsed.kind === 'configuration' ? 'not_configured'
        : parsed.reason || 'youtube_error';
  throw new YoutubeUserError(code, parsed.message);
}

export async function listMyChannel(token: string): Promise<{ channelId: string; channelTitle: string; channelHandle: string | null }> {
  const url = `${DATA_API}/channels?part=snippet&mine=true`;
  const response = await authed(url, token);
  if (!response.ok) await readError(response);
  const body = await response.json() as { items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }> };
  const channel = body.items?.[0];
  if (!channel?.id || !channel.snippet?.title) {
    throw new YoutubeUserError(
      'no_channel',
      'Google did not return a YouTube channel for this login. On the consent screen, choose the Google account that owns the channel you want, and pick that channel if YouTube asks.',
    );
  }
  return {
    channelId: channel.id,
    channelTitle: channel.snippet.title,
    channelHandle: channel.snippet.customUrl ?? null,
  };
}

export async function getVideo(token: string, videoId: string): Promise<YoutubeVideo> {
  const url = `${DATA_API}/videos?part=snippet,status,processingDetails,contentDetails,statistics&id=${encodeURIComponent(videoId)}`;
  const response = await authed(url, token);
  if (response.status === 401) throw new YoutubeUserError('reconnect_required', 'YouTube refused the access token. Reconnect the channel.');
  if (!response.ok) await readError(response);
  const body = await response.json() as { items?: YoutubeVideo[] };
  const video = body.items?.[0];
  if (!video?.id) {
    throw new YoutubeUserError('not_found', 'YouTube did not return that video for this channel. Check the video id and connectionId.');
  }
  return video;
}

/** Owner-authenticated uploads inventory, including nonpublic editions. Never
 * return a partial list as complete: cap, malformed pages, and missing videos
 * fail closed so a cleanup cannot choose keepers from an incomplete ranking. */
export async function listChannelVideos(token: string, channelId: string): Promise<YoutubeVideo[]> {
  const channelResponse = await authed(`${DATA_API}/channels?part=contentDetails&mine=true`, token);
  if (!channelResponse.ok) await readError(channelResponse);
  const channels = await channelResponse.json() as { items?: Array<{ id?: string; contentDetails?: { relatedPlaylists?: { uploads?: string } } }> };
  const uploads = channels.items?.find(c => c.id === channelId)?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new YoutubeUserError('channel_mismatch', 'The authorized channel did not return its uploads playlist.');
  const ids = new Set<string>();
  const pageTokens = new Set<string>();
  let pageToken = '';
  do {
    if (pageTokens.has(pageToken) || pageTokens.size >= 100) throw new YoutubeUserError('incomplete_inventory', 'The inventory could not be completed safely.');
    pageTokens.add(pageToken);
    const query = new URLSearchParams({ part: 'contentDetails', playlistId: uploads, maxResults: '50' });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await authed(`${DATA_API}/playlistItems?${query}`, token);
    if (!response.ok) await readError(response);
    const page = await response.json() as { items?: Array<{ contentDetails?: { videoId?: string } }>; nextPageToken?: string };
    if (!Array.isArray(page.items)) throw new YoutubeUserError('incomplete_inventory', 'YouTube omitted inventory items.');
    for (const item of page.items) {
      const id = item.contentDetails?.videoId;
      if (!id) throw new YoutubeUserError('incomplete_inventory', 'An upload has no video ID.');
      ids.add(id);
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  const videos: YoutubeVideo[] = [];
  const allIds = [...ids];
  for (let offset = 0; offset < allIds.length; offset += 50) {
    const batch = allIds.slice(offset, offset + 50);
    const query = new URLSearchParams({ part: 'snippet,status,contentDetails,statistics', id: batch.join(',') });
    const response = await authed(`${DATA_API}/videos?${query}`, token);
    if (!response.ok) await readError(response);
    const body = await response.json() as { items?: YoutubeVideo[] };
    if (!Array.isArray(body.items) || body.items.length !== batch.length
      || new Set(body.items.map(v => v.id)).size !== batch.length
      || body.items.some(v => !v.id || !batch.includes(v.id) || v.snippet?.channelId !== channelId)) {
      throw new YoutubeUserError('incomplete_inventory', 'YouTube did not return every requested video on the selected channel.');
    }
    videos.push(...body.items);
  }
  return videos;
}

/** Call only after the cleanup service has verified ownership, keepers and intent. */
export async function deleteVideo(token: string, videoId: string): Promise<void> {
  const response = await authed(`${DATA_API}/videos?id=${encodeURIComponent(videoId)}`, token, { method: 'DELETE' });
  if (!response.ok) await readError(response);
  if (response.status !== 204) throw new YoutubeUserError('deletion_unconfirmed', 'YouTube did not return its deletion success status.');
}

export async function updateVideo(token: string, part: string, body: Record<string, unknown>): Promise<YoutubeVideo> {
  const response = await authed(`${DATA_API}/videos?part=${encodeURIComponent(part)}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  if (!response.ok) await readError(response);
  return response.json() as Promise<YoutubeVideo>;
}

export async function startResumableSession(token: string, upload: NormalizedUpload, byteSize: number, contentType: string): Promise<string> {
  const insert = buildInsertBody(upload);
  const response = await authed(
    `${UPLOAD_API}/videos?uploadType=resumable&part=${encodeURIComponent(insert.part)}`,
    token,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(byteSize),
        'X-Upload-Content-Type': contentType || 'video/mp4',
      },
      body: JSON.stringify(insert.body),
    },
  );
  if (!response.ok) await readError(response);
  const location = response.headers.get('location');
  if (!location) throw new YoutubeUserError('youtube_error', 'YouTube did not return a resumable upload session.');
  assertGoogleUploadUrl(location);
  return location;
}

export async function probeOrUpload(input: {
  token: string;
  sessionUri: string;
  total: number;
  start?: number;
  chunk?: Buffer;
  contentType?: string;
}): Promise<SessionQuery> {
  assertGoogleUploadUrl(input.sessionUri);
  const probing = !input.chunk;
  const start = input.start ?? 0;
  const chunk = input.chunk;
  const headers: Record<string, string> = probing
    ? { 'Content-Length': '0', 'Content-Range': `bytes */${input.total}` }
    : {
        'Content-Length': String(chunk!.length),
        'Content-Type': input.contentType || 'video/mp4',
        'Content-Range': `bytes ${start}-${start + chunk!.length - 1}/${input.total}`,
      };
  let response: Response;
  try {
    response = await authed(input.sessionUri, input.token, {
      method: 'PUT',
      headers,
      body: probing ? undefined : new Uint8Array(chunk!),
    }, true);
  } catch (error) {
    if (error instanceof YoutubeUserError) throw error;
    const message = error instanceof Error ? redactSecrets(error.message) : 'network error';
    return { type: 'retry', message };
  }
  if (response.status === 308) {
    const match = /bytes=(\d+)-(\d+)/.exec(response.headers.get('range') ?? '');
    return { type: 'incomplete', acked: match ? Number(match[2]) + 1 : start };
  }
  if (response.status === 200 || response.status === 201) {
    const video = await response.json() as YoutubeVideo;
    if (!video.id) return { type: 'retry', message: 'YouTube accepted the upload but did not return a video id.' };
    return { type: 'complete', videoId: video.id, video };
  }
  if (response.status === 404) return { type: 'expired' };
  const text = await response.text();
  const parsed = parseGoogleError(response.status, text);
  if (parsed.kind === 'reconnect_required') throw new YoutubeUserError('reconnect_required', parsed.message);
  if (parsed.kind === 'transient' || ['uploadLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].includes(parsed.reason)) {
    return { type: 'retry', code: parsed.reason, message: parsed.message };
  }
  return { type: 'fatal', code: parsed.reason || 'youtube_error', message: parsed.message };
}

export async function setThumbnail(token: string, videoId: string, bytes: Buffer, contentType: string): Promise<void> {
  const response = await authed(
    `${UPLOAD_API}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(bytes),
    },
  );
  if (!response.ok) await readError(response);
}

export { CHUNK_BYTES };
