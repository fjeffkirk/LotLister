import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import http from 'http';
import https from 'https';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { lookup } from 'dns/promises';
import { UPLOAD_URL_TTL_MS, maxUploadBytes } from './config';
import { encryptionKey } from './oauth';
import { isBlockedAddress, resolveRedirect, screenUrl, type DnsLookup } from './ssrf';
import { YoutubeUserError } from './types';
import { storageCapacity } from '../storage-capacity';

const UPLOADS_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');

// Leave room for card photos, metadata and filesystem overhead. Reservations cover
// simultaneous media transfers in this disk-backed, single-instance service.
export const MIN_FREE_DISK_BYTES = 256 * 1024 * 1024;
const storageGlobal = globalThis as typeof globalThis & { lotlisterMediaReservations?: { bytes: number } };
const reservations = storageGlobal.lotlisterMediaReservations ??= { bytes: 0 };

export async function checkUploadSpace(bytes: number): Promise<void> {
  const { freeBytes } = await storageCapacity();
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new YoutubeUserError('invalid_media', 'Provide a positive, safe integer byte size.');
  }
  if (bytes > freeBytes - MIN_FREE_DISK_BYTES - reservations.bytes) {
    throw new YoutubeUserError('insufficient_storage',
      `Not enough free upload storage. ${Math.max(0, freeBytes - MIN_FREE_DISK_BYTES - reservations.bytes)} bytes are available after reserving space for other files and active uploads.`);
  }
}

export async function reserveUploadSpace(bytes: number): Promise<() => void> {
  // Check and reserve in the same continuation, so concurrent callers cannot
  // both pass a check before either registers its reservation.
  const { freeBytes } = await storageCapacity();
  if (bytes > freeBytes - MIN_FREE_DISK_BYTES - reservations.bytes) {
    throw new YoutubeUserError('insufficient_storage', 'Not enough free disk space for this media transfer and the 256 MB safety reserve.');
  }
  reservations.bytes += bytes;
  return () => { reservations.bytes -= bytes; };
}

export interface SniffedMedia {
  kind: 'video' | 'image';
  contentType: string;
}

export function sniffMedia(header: Buffer): SniffedMedia | null {
  if (header.length >= 12 && header.toString('ascii', 4, 8) === 'ftyp') {
    const brand = header.toString('ascii', 8, 12);
    return { kind: 'video', contentType: brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4' };
  }
  if (header.length >= 4 && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
    return { kind: 'video', contentType: 'video/webm' };
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return { kind: 'image', contentType: 'image/jpeg' };
  }
  if (header.length >= 4 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
    return { kind: 'image', contentType: 'image/png' };
  }
  if (header.length >= 6 && (header.toString('ascii', 0, 6) === 'GIF87a' || header.toString('ascii', 0, 6) === 'GIF89a')) {
    return { kind: 'image', contentType: 'image/gif' };
  }
  return null;
}

export function accountStorageDir(accountId: string): string {
  const safe = accountId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 60) || 'account';
  const hash = createHmac('sha256', 'lotlister-youtube-path').update(accountId).digest('hex').slice(0, 12);
  return `${safe}-${hash}`;
}

export function relativeMediaPath(accountId: string, assetId: string): string {
  if (!/^[a-zA-Z0-9_-]{8,40}$/.test(assetId)) {
    throw new YoutubeUserError('invalid_asset', 'The media asset id is not valid.');
  }
  return path.posix.join('youtube', accountStorageDir(accountId), `${assetId}.bin`);
}

export function resolveMediaPath(relativePath: string): string {
  const root = path.resolve(UPLOADS_DIR);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new YoutubeUserError('invalid_asset', 'The media path is outside durable storage.');
  }
  return resolved;
}

export interface UploadGrant {
  assetId: string;
  accountId: string;
  exp: number;
  maxBytes: number;
}

export function signUploadGrant(grant: UploadGrant, secret: string = encryptionKey().toString('base64url')): string {
  const body = Buffer.from(JSON.stringify(grant), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function openUploadGrant(token: string, nowSeconds: number, secret: string = encryptionKey().toString('base64url')): UploadGrant {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) {
    throw new YoutubeUserError('upload_unauthorized', 'The upload URL is not valid. Call youtube_media_upload_prepare again.');
  }
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new YoutubeUserError('upload_unauthorized', 'The upload URL signature does not match. Prepare the upload again.');
  }
  const grant = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<UploadGrant>;
  if (!grant.assetId || !grant.accountId || typeof grant.exp !== 'number' || typeof grant.maxBytes !== 'number') {
    throw new YoutubeUserError('upload_unauthorized', 'The upload URL is incomplete. Prepare the upload again.');
  }
  if (grant.exp <= nowSeconds) {
    throw new YoutubeUserError('upload_expired', 'The signed upload URL has expired. Call youtube_media_upload_prepare again. No YouTube video was created.');
  }
  return { assetId: grant.assetId, accountId: grant.accountId, exp: grant.exp, maxBytes: grant.maxBytes };
}

export function uploadUrlFor(origin: string, assetId: string, grant: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/api/youtube/media/${assetId}?token=${encodeURIComponent(grant)}`;
}

export async function writeUploadStream(stream: Readable, destination: string, maxBytes: number): Promise<{ byteSize: number; sniffed: SniffedMedia }> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const release = await reserveUploadSpace(maxBytes).catch(error => {
    stream.destroy();
    throw error;
  });
  const temp = `${destination}.${randomBytes(6).toString('hex')}.partial`;
  const header = Buffer.alloc(32);
  let headerLen = 0;
  let size = 0;
  let nextSpaceCheck = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        callback(new YoutubeUserError('too_large', `The file exceeds the ${maxBytes} byte upload limit.`));
        return;
      }
      if (headerLen < header.length) {
        const count = Math.min(header.length - headerLen, buf.length);
        buf.copy(header, headerLen, 0, count);
        headerLen += count;
      }
      if (size >= nextSpaceCheck) {
        nextSpaceCheck = size + 64 * 1024 * 1024;
        storageCapacity().then(({ freeBytes }) => {
          if (freeBytes - buf.length < MIN_FREE_DISK_BYTES) {
            callback(new YoutubeUserError('insufficient_storage', 'Upload stopped to preserve free disk space for other files.'));
          } else callback(null, buf);
        }).catch(error => callback(error));
      } else callback(null, buf);
    },
  });
  try {
    await pipeline(stream, counter, createWriteStream(temp));
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    release();
  }
  const sniffed = sniffMedia(header.subarray(0, headerLen));
  if (!sniffed || size < 32) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw new YoutubeUserError('invalid_media', 'The file is not a recognized MP4, MOV, WebM, JPEG, PNG, or GIF. Base64 bodies are not accepted.');
  }
  await fs.rm(destination, { force: true }).catch(() => undefined);
  await fs.rename(temp, destination);
  return { byteSize: size, sniffed };
}

const REJECTED_TYPES = /^(text\/|application\/(json|xml|javascript|xhtml)|multipart\/form-data)/i;

export interface DownloadTransport {
  request(url: URL): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; stream: Readable }>;
}

export async function downloadPublicHttps(rawUrl: string, destination: string, options?: {
  maxBytes?: number;
  lookup?: DnsLookup;
  transport?: DownloadTransport;
}): Promise<{ byteSize: number; sniffed: SniffedMedia }> {
  const maxBytes = options?.maxBytes ?? maxUploadBytes();
  const lookupHost = options?.lookup;
  let current = await screenUrl(rawUrl, lookupHost);
  const transport = options?.transport ?? nodeTransport();
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await transport.request(current);
    const status = response.status;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = headerValue(response.headers.location);
      if (!location || hop === 3) throw new YoutubeUserError('unsafe_url', 'The source URL redirected too many times or omitted a location.');
      current = await screenUrl(resolveRedirect(current, location).toString(), lookupHost);
      continue;
    }
    if (status < 200 || status >= 300) {
      throw new YoutubeUserError('source_rejected', `The source URL returned HTTP ${status}.`);
    }
    const contentType = headerValue(response.headers['content-type']) ?? '';
    if (REJECTED_TYPES.test(contentType)) {
      throw new YoutubeUserError('invalid_media', 'The source URL returned a document instead of a video or image.');
    }
    const declared = Number(headerValue(response.headers['content-length']) ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new YoutubeUserError('too_large', `The source file exceeds the ${maxBytes} byte limit.`);
    }
    // A known content length avoids reserving the full configured cap for a
    // small remote file; the stream still cannot exceed the server's limit.
    const transferLimit = Number.isSafeInteger(declared) && declared > 0 ? Math.min(declared, maxBytes) : maxBytes;
    return writeUploadStream(response.stream, destination, transferLimit);
  }
  throw new YoutubeUserError('unsafe_url', 'The source URL redirected too many times.');
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function nodeTransport(): DownloadTransport {
  return {
    request(url: URL) {
      return new Promise((resolve, reject) => {
        const req = https.request(url, {
          method: 'GET',
          headers: { 'User-Agent': 'LotLister-YouTube/1.0' },
          lookup: (hostname, options, callback) => {
            lookup(hostname, { all: true, verbatim: true })
              .then((records) => {
                if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
                  callback(new Error('blocked address'), '', 4);
                  return;
                }
                const family = records[0].family === 6 ? 6 : 4;
                callback(null, records[0].address, family);
              })
              .catch((error: Error) => callback(error, '', 4));
          },
        }, (response: http.IncomingMessage) => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            stream: response,
          });
        });
        req.setTimeout(60_000, () => req.destroy(new Error('source timeout')));
        req.on('error', reject);
        req.end();
      });
    },
  };
}

export function newAssetExpiry(now = Date.now()): Date {
  return new Date(now + UPLOAD_URL_TTL_MS);
}
