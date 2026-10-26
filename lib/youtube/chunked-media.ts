import { createHash, randomBytes } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { MIN_FREE_DISK_BYTES, reserveUploadSpace, sniffMedia } from './media';
import { storageCapacity } from '../storage-capacity';
import { YoutubeUserError } from './types';

// Render persistent disks are attached to one service instance. Share the lock
// across route bundles and hold it through database updates, including legacy PUT.
const globals = globalThis as typeof globalThis & { lotlisterUploadLocks?: Set<string> };
const locks = globals.lotlisterUploadLocks ??= new Set<string>();
export async function withMediaUploadLock<T>(assetId: string, action: () => Promise<T>): Promise<T> {
  if (locks.has(assetId)) throw new YoutubeUserError('upload_busy', 'A transfer for this asset is active. Retry after it finishes.');
  locks.add(assetId);
  try { return await action(); } finally { locks.delete(assetId); }
}

export const MAX_UPLOAD_CHUNK_BYTES = 64 * 1024 * 1024;
type Progress = { version: 1; total: number; offset: number; sha256: string };
const statePath = (destination: string) => `${destination}.resumable.json`;
const dataPath = (destination: string) => `${destination}.resumable`;
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export async function readChunkProgress(destination: string): Promise<Progress | null> {
  let text: string;
  try { text = await fs.readFile(statePath(destination), 'utf8'); }
  catch (error) { if (absent(error)) return null; throw error; }
  const state = JSON.parse(text) as Progress;
  if (state.version !== 1 || !Number.isSafeInteger(state.total) || state.total < 32
    || !Number.isSafeInteger(state.offset) || state.offset < 0 || state.offset > state.total
    || !/^[a-f0-9]{64}$/.test(state.sha256)) {
    throw new YoutubeUserError('invalid_progress', 'The saved transfer state is invalid. Do not overwrite it.');
  }
  return state;
}

async function saveProgress(destination: string, state: Progress) {
  const temp = `${statePath(destination)}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(state), { flag: 'wx', flush: true });
    await fs.rename(temp, statePath(destination));
  } finally { await fs.rm(temp, { force: true }).catch(() => undefined); }
}

export function parseUploadRange(value: string, total: number, limit: number) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value);
  const [start, end, declared] = match ? match.slice(1).map(Number) : [];
  if (!match || ![start, end, declared, total].every(Number.isSafeInteger)
    || start < 0 || end < start || end >= declared || declared !== total || total < 32) {
    throw new YoutubeUserError('invalid_range', 'Content-Range must describe an exact portion of the prepared file.');
  }
  if (total > limit || end - start + 1 > MAX_UPLOAD_CHUNK_BYTES) {
    throw new YoutubeUserError('too_large', 'The file exceeds its upload limit or this chunk exceeds 64 MiB.');
  }
  return { start, end, total, length: end - start + 1 };
}

function validateHash(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new YoutubeUserError('invalid_checksum', 'Send the whole-file SHA-256 in X-Upload-SHA256.');
}

/** Caller holds the asset lock and has checked the signed grant and owner. */
export async function appendMediaChunk(stream: Readable, destination: string, input: {
  contentRange: string; total: number; limit: number; sha256: string;
}) {
  const range = parseUploadRange(input.contentRange, input.total, input.limit);
  validateHash(input.sha256);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  let state = await readChunkProgress(destination);
  if (state && (state.total !== input.total || state.sha256 !== input.sha256)) {
    throw new YoutubeUserError('upload_conflict', 'The file size or checksum changed during this transfer.');
  }
  if (range.start !== (state?.offset ?? 0)) {
    throw new YoutubeUserError('upload_conflict', `Resume at byte ${state?.offset ?? 0}; query GET on the upload URL after an interrupted response.`);
  }
  // Reserve the outstanding bytes; previously committed bytes already use disk.
  const release = await reserveUploadSpace(input.total - range.start);
  const partial = dataPath(destination);
  const offset = range.start;
  try {
    if (!state) {
      // Never truncate an unrecognized file, including a completed destination.
      if (await fs.stat(destination).then(() => true, e => { if (absent(e)) return false; throw e; })) {
        throw new YoutubeUserError('upload_conflict', 'A completed file already exists. Finalize or inspect this asset.');
      }
      state = { version: 1, total: input.total, offset: 0, sha256: input.sha256 };
      await saveProgress(destination, state);
    }
    let actual: number;
    try { actual = (await fs.stat(partial)).size; }
    catch (error) {
      if (!absent(error) || offset !== 0) throw error;
      await fs.writeFile(partial, '', { flag: 'wx' }); actual = 0;
    }
    if (actual < offset) throw new YoutubeUserError('invalid_progress', 'Committed upload bytes are missing.');
    // A killed process can leave an uncommitted tail. Its durable offset is the
    // authority; successful chunks are never overwritten on a retry.
    if (actual > offset) await fs.truncate(partial, offset);
    let received = 0;
    let nextSpaceCheck = 0;
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += bytes.length;
      if (received > range.length) return callback(new YoutubeUserError('invalid_range', 'The request body exceeds Content-Range.'));
      if (received >= nextSpaceCheck) {
        nextSpaceCheck = received + 8 * 1024 * 1024;
        storageCapacity().then(({ freeBytes }) => callback(freeBytes - bytes.length < MIN_FREE_DISK_BYTES
          ? new YoutubeUserError('insufficient_storage', 'Transfer stopped to preserve the free disk reserve.') : null, bytes)).catch(callback);
      } else callback(null, bytes);
    } });
    try {
      await pipeline(stream, counter, createWriteStream(partial, { flags: 'r+', start: offset, flush: true }));
      if (received !== range.length) throw new YoutubeUserError('invalid_range', 'The request body is shorter than Content-Range.');
      const committed = { ...state, offset: offset + received };
      await saveProgress(destination, committed);
      return committed;
    } catch (error) {
      await fs.truncate(partial, offset);
      throw error;
    }
  } finally { release(); }
}

/** Hash and type-check the complete file before an atomic rename. Repeating
 * finalize also recovers a crash between the rename and the database update. */
export async function finalizeMediaChunks(destination: string, input: { total: number; limit: number; sha256: string; kind: string }) {
  validateHash(input.sha256);
  const state = await readChunkProgress(destination);
  if (!state || state.offset !== input.total || state.total !== input.total || state.sha256 !== input.sha256) {
    throw new YoutubeUserError('upload_conflict', 'All exact file bytes must be committed before finalization.');
  }
  if (input.total > input.limit) throw new YoutubeUserError('too_large', 'The file exceeds the current upload limit.');
  let source = dataPath(destination);
  try { await fs.stat(source); }
  catch (error) { if (!absent(error)) throw error; source = destination; }
  if ((await fs.stat(source)).size !== input.total) throw new YoutubeUserError('invalid_progress', 'The stored byte count does not match the prepared file.');
  const hash = createHash('sha256');
  let header = Buffer.alloc(0);
  for await (const chunk of createReadStream(source)) {
    hash.update(chunk);
    if (header.length < 32) header = Buffer.concat([header, chunk.subarray(0, 32 - header.length)]);
  }
  if (hash.digest('hex') !== state.sha256) throw new YoutubeUserError('checksum_mismatch', 'The stored SHA-256 does not match the source. The asset was not made ready.');
  const sniffed = sniffMedia(header);
  if (!sniffed || sniffed.kind !== input.kind) throw new YoutubeUserError('invalid_media', 'The stored file type does not match this upload.');
  if (source !== destination) {
    // Never replace an unexpected completed file.
    if (await fs.stat(destination).then(() => true, e => { if (absent(e)) return false; throw e; })) {
      throw new YoutubeUserError('upload_conflict', 'A completed file already exists.');
    }
    await fs.rename(source, destination);
  }
  return { byteSize: input.total, sha256: state.sha256, sniffed };
}
