import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn() }));
vi.mock('../lib/prisma', () => ({ default: { youtubeMediaAsset: db } }));
import { appendMediaChunk, finalizeMediaChunks, parseUploadRange, readChunkProgress, withMediaUploadLock } from '../lib/youtube/chunked-media';
import { MIN_FREE_DISK_BYTES, signUploadGrant } from '../lib/youtube/media';
import { acceptMediaBytes, acceptMediaChunk, finishMediaTransfer, mediaTransferStatus } from '../lib/youtube/service';

let directory: string;
let destination: string;
const file = Buffer.alloc(128, 42);
file.write('ftyp', 4); file.write('isom', 8);
const hash = createHash('sha256').update(file).digest('hex');
const options = { total: file.length, limit: 1024, sha256: hash };
const disk = (freeBytes = 10 * 1024 ** 3) => ({ type: 0, bsize: 1, blocks: 10 * 1024 ** 3, bfree: freeBytes, bavail: freeBytes, files: 100, ffree: 90 });
const append = (start: number, end: number, bytes = file.subarray(start, end + 1)) => appendMediaChunk(Readable.from([bytes]), destination,
  { ...options, contentRange: `bytes ${start}-${end}/${file.length}` });
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lotlister-chunks-'));
  destination = path.join(directory, 'video.bin');
  vi.spyOn(fs, 'statfs').mockResolvedValue(disk());
  vi.stubEnv('YOUTUBE_TOKEN_ENCRYPTION_KEY', 'test-configuration-at-least-32-characters');
  vi.stubEnv('YOUTUBE_MAX_UPLOAD_BYTES', '1024');
  db.findFirst.mockReset(); db.update.mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('resumable media ingestion', () => {
  it('commits sequential chunks, verifies the entire hash, and safely repeats finalization', async () => {
    expect((await append(0, 63)).offset).toBe(64);
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await append(64, 127);
    const result = await finalizeMediaChunks(destination, { ...options, kind: 'video' });
    expect(result).toMatchObject({ byteSize: 128, sha256: hash, sniffed: { kind: 'video' } });
    expect(await fs.readFile(destination)).toEqual(file);
    expect(await finalizeMediaChunks(destination, { ...options, kind: 'video' })).toEqual(result);
  });
  it('does not overwrite committed bytes for duplicate, overlapping, or skipped ranges', async () => {
    await append(0, 63);
    for (const [start, end] of [[0, 63], [32, 95], [65, 127]]) {
      await expect(append(start, end)).rejects.toMatchObject({ code: 'upload_conflict' });
    }
    expect((await readChunkProgress(destination))?.offset).toBe(64);
    expect(await fs.readFile(`${destination}.resumable`)).toEqual(file.subarray(0, 64));
  });
  it('rolls back short, oversized, and interrupted chunk bodies without losing completed chunks', async () => {
    await append(0, 63);
    for (const bytes of [Buffer.alloc(63), Buffer.alloc(65)]) {
      await expect(append(64, 127, bytes)).rejects.toMatchObject({ code: 'invalid_range' });
      expect((await fs.stat(`${destination}.resumable`)).size).toBe(64);
    }
    const broken = Readable.from((async function* () { yield Buffer.alloc(20); throw new Error('disconnected'); })());
    await expect(appendMediaChunk(broken, destination, { ...options, contentRange: 'bytes 64-127/128' })).rejects.toThrow('disconnected');
    expect((await readChunkProgress(destination))?.offset).toBe(64);
    await append(64, 127);
    await expect(finalizeMediaChunks(destination, { ...options, kind: 'video' })).resolves.toMatchObject({ sha256: hash });
  });
  it('recovers an uncommitted tail left by a killed process', async () => {
    await append(0, 63);
    await fs.appendFile(`${destination}.resumable`, Buffer.alloc(20, 99));
    await append(64, 127);
    expect(await fs.readFile(`${destination}.resumable`)).toEqual(file);
  });
  it('requires exact total, chunk limit, file cap, integer ranges, and an unchanged checksum', async () => {
    for (const range of ['bytes 0-63/129', 'bytes 64-63/128', 'bytes -1-63/128', 'bytes 0-128/128', 'bytes 0-1/9007199254740992', 'bytes */128']) {
      expect(() => parseUploadRange(range, 128, 1024)).toThrow();
    }
    expect(() => parseUploadRange('bytes 0-67108864/67108865', 67108865, 67108865)).toThrow(/64 MiB/);
    expect(() => parseUploadRange('bytes 0-63/128', 128, 127)).toThrow(/limit/);
    await append(0, 63);
    await expect(appendMediaChunk(Readable.from([file.subarray(64)]), destination, { ...options, sha256: 'a'.repeat(64), contentRange: 'bytes 64-127/128' }))
      .rejects.toMatchObject({ code: 'upload_conflict' });
  });
  it('never finalizes incomplete, corrupt, wrong-type, or unexpectedly overwritten media', async () => {
    await append(0, 63);
    await expect(finalizeMediaChunks(destination, { ...options, kind: 'video' })).rejects.toMatchObject({ code: 'upload_conflict' });
    await append(64, 127, Buffer.alloc(64));
    await expect(finalizeMediaChunks(destination, { ...options, kind: 'video' })).rejects.toMatchObject({ code: 'checksum_mismatch' });
    await fs.writeFile(`${destination}.resumable`, file);
    await expect(finalizeMediaChunks(destination, { ...options, kind: 'image' })).rejects.toMatchObject({ code: 'invalid_media' });
    await fs.writeFile(destination, 'keep');
    await expect(finalizeMediaChunks(destination, { ...options, kind: 'video' })).rejects.toMatchObject({ code: 'upload_conflict' });
    expect(await fs.readFile(destination, 'utf8')).toBe('keep');
  });
  it('retains disk headroom and rolls back when capacity drops while writing', async () => {
    vi.mocked(fs.statfs).mockResolvedValue(disk(MIN_FREE_DISK_BYTES + 127));
    await expect(append(0, 63)).rejects.toMatchObject({ code: 'insufficient_storage' });
    vi.mocked(fs.statfs).mockResolvedValueOnce(disk()).mockResolvedValue(disk(MIN_FREE_DISK_BYTES));
    await expect(append(0, 63)).rejects.toMatchObject({ code: 'insufficient_storage' });
    expect((await readChunkProgress(destination))?.offset).toBe(0);
    vi.mocked(fs.statfs).mockResolvedValue(disk());
    await append(0, 63);
  });
  it('excludes simultaneous requests for one asset but permits other assets', async () => {
    await withMediaUploadLock('a', async () => {
      await expect(withMediaUploadLock('a', async () => 1)).rejects.toMatchObject({ code: 'upload_busy' });
      await expect(withMediaUploadLock('b', async () => 2)).resolves.toBe(2);
    });
    await expect(withMediaUploadLock('a', async () => 3)).resolves.toBe(3);
  });
});

describe('signed transfer service', () => {
  const id = 'ma_test123456';
  const token = (extra = {}) => signUploadGrant({ assetId: id, accountId: 'owner', exp: Math.floor(Date.now() / 1000) + 600, maxBytes: 128, ...extra });
  it('checks signatures, expiry, asset binding, ownership, and prepared byte count', async () => {
    await expect(mediaTransferStatus(id, 'forged')).rejects.toMatchObject({ code: 'upload_unauthorized' });
    await expect(mediaTransferStatus(id, token({ exp: 1 }))).rejects.toMatchObject({ code: 'upload_expired' });
    await expect(mediaTransferStatus('ma_other12345', token())).rejects.toMatchObject({ code: 'upload_unauthorized' });
    db.findFirst.mockResolvedValue(null);
    await expect(mediaTransferStatus(id, token())).rejects.toMatchObject({ code: 'upload_unauthorized' });
    expect(db.findFirst).toHaveBeenCalledWith({ where: { id, userEmail: 'owner' } });
    db.findFirst.mockResolvedValue({ id, status: 'pending', byteSize: BigInt(129) });
    await expect(mediaTransferStatus(id, token())).rejects.toMatchObject({ code: 'upload_unauthorized' });
    expect(db.update).not.toHaveBeenCalled();
  });
  it('guards direct PUT with the same lock and rejects ready assets without overwriting', async () => {
    await withMediaUploadLock(id, async () => {
      await expect(acceptMediaBytes(id, token(), Readable.from([file]))).rejects.toMatchObject({ code: 'upload_busy' });
      await expect(acceptMediaChunk(id, token(), Readable.from([file]), 'bytes 0-127/128', hash)).rejects.toMatchObject({ code: 'upload_busy' });
      await expect(finishMediaTransfer(id, token(), hash)).rejects.toMatchObject({ code: 'upload_busy' });
    });
    db.findFirst.mockResolvedValue({ id, status: 'ready', byteSize: BigInt(128), kind: 'video', storagePath: 'youtube/ready.bin' });
    await expect(acceptMediaBytes(id, token(), Readable.from([file]))).rejects.toMatchObject({ code: 'already_uploaded' });
    await expect(acceptMediaChunk(id, token(), Readable.from([file]), 'bytes 0-127/128', hash)).rejects.toMatchObject({ code: 'already_uploaded' });
    expect(db.update).not.toHaveBeenCalled();
  });
});
