import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const createAsset = vi.hoisted(() => vi.fn());
vi.mock('../lib/prisma', () => ({ default: { youtubeMediaAsset: { create: createAsset } } }));
import { maxUploadBytes, MAX_THUMBNAIL_BYTES } from '../lib/youtube/config';
import { byteCount } from '../lib/youtube/byte-count';
import { checkUploadSpace, MIN_FREE_DISK_BYTES, writeUploadStream } from '../lib/youtube/media';
import { prepareMedia } from '../lib/youtube/service';
import { GET } from '../app/api/storage/route';

const GB = 1024 ** 3;
const LARGE_VIDEO = 3_333_358_141;
let directory: string;
function disk(freeBytes = 4 * GB) {
  return { type: 0, bsize: 1, blocks: 5 * GB, bfree: freeBytes, bavail: freeBytes, files: 100, ffree: 90 };
}
function mp4() {
  const data = Buffer.alloc(64);
  data.write('ftyp', 4); data.write('isom', 8);
  return data;
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lotlister-storage-'));
  vi.stubEnv('UPLOAD_DIR', directory);
  vi.stubEnv('YOUTUBE_MAX_UPLOAD_BYTES', '');
  for (const key of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'YOUTUBE_TOKEN_ENCRYPTION_KEY']) {
    vi.stubEnv(key, 'test-configuration-at-least-32-characters');
  }
  vi.spyOn(fs, 'statfs').mockResolvedValue(disk());
  createAsset.mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('large video storage', () => {
  it('accepts the 3.33 GB master by default and respects an explicit cap above 1 GB', () => {
    expect(maxUploadBytes()).toBeGreaterThan(LARGE_VIDEO);
    expect(maxUploadBytes({ NODE_ENV: 'test', YOUTUBE_MAX_UPLOAD_BYTES: '6000000000' })).toBe(6_000_000_000);
    expect(maxUploadBytes({ NODE_ENV: 'test', YOUTUBE_MAX_UPLOAD_BYTES: '1048576' })).toBe(1048576);
    for (const value of ['NaN', '-1', '1.5', 'Infinity', '9007199254740992']) {
      expect(maxUploadBytes({ NODE_ENV: 'test', YOUTUBE_MAX_UPLOAD_BYTES: value })).toBe(4 * GB);
    }
  });

  it('prepares a multi-gigabyte video with BIGINT persistence and JSON-safe output', async () => {
    const result = await prepareMedia('owner', 'https://lotlister.example', {
      filename: 'sleep.mp4', contentType: 'video/mp4', byteSize: LARGE_VIDEO,
    });
    expect(createAsset.mock.calls[0][0].data.byteSize).toBe(BigInt(LARGE_VIDEO));
    expect(result.status).toBe('pending');
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(byteCount(BigInt(LARGE_VIDEO))).toBe(LARGE_VIDEO);
    expect(() => byteCount(BigInt('9007199254740993'))).toThrow(/unsafe/);
  });

  it('retains the thumbnail limit and rejects insufficient space before creating an asset', async () => {
    await expect(prepareMedia('owner', 'https://lotlister.example', {
      filename: 'thumb.png', contentType: 'image/png', byteSize: MAX_THUMBNAIL_BYTES + 1,
    })).rejects.toMatchObject({ code: 'too_large' });
    vi.mocked(fs.statfs).mockResolvedValue(disk(LARGE_VIDEO + MIN_FREE_DISK_BYTES - 1));
    await expect(prepareMedia('owner', 'https://lotlister.example', {
      filename: 'sleep.mp4', contentType: 'video/mp4', byteSize: LARGE_VIDEO,
    })).rejects.toMatchObject({ code: 'insufficient_storage' });
    expect(createAsset).not.toHaveBeenCalled();
  });

  it('reports actual filesystem usage and capacity, including files outside uploads', async () => {
    vi.mocked(fs.statfs).mockResolvedValue(disk(GB));
    const result = await (await GET()).json();
    expect(result.data).toMatchObject({ maxGB: 5, totalBytes: 5 * GB, freeBytes: GB, usedBytes: 4 * GB, percentUsed: 80 });
    expect(fs.statfs).toHaveBeenCalledWith(directory);
  });

  it('fails closed when capacity cannot be measured', async () => {
    vi.mocked(fs.statfs).mockRejectedValue(new Error('disk unavailable'));
    await expect(checkUploadSpace(100)).rejects.toThrow('disk unavailable');
  });

  it('rejects a concurrent overcommit and releases the reservation when the first upload finishes', async () => {
    vi.mocked(fs.statfs).mockResolvedValue(disk(5 * GB));
    let started!: () => void;
    let finish!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    const finishedPromise = new Promise<void>(resolve => { finish = resolve; });
    const stream = Readable.from((async function* () {
      started(); yield mp4(); await finishedPromise;
    })());
    const first = writeUploadStream(stream, path.join(directory, 'first.mp4'), 4 * GB);
    await startedPromise;
    try {
      await expect(writeUploadStream(Readable.from([mp4()]), path.join(directory, 'second.mp4'), 4 * GB))
        .rejects.toMatchObject({ code: 'insufficient_storage' });
    } finally { finish(); await first; }
    await expect(writeUploadStream(Readable.from([mp4()]), path.join(directory, 'second.mp4'), 4 * GB))
      .resolves.toMatchObject({ byteSize: 64 });
  });

  it('removes partial bytes and releases reservations if free space drops during a transfer', async () => {
    vi.mocked(fs.statfs).mockResolvedValueOnce(disk()).mockResolvedValue(disk(MIN_FREE_DISK_BYTES));
    await expect(writeUploadStream(Readable.from([mp4()]), path.join(directory, 'partial.mp4'), 64))
      .rejects.toMatchObject({ code: 'insufficient_storage' });
    expect(await fs.readdir(directory)).toEqual([]);
    vi.mocked(fs.statfs).mockResolvedValue(disk());
    await expect(writeUploadStream(Readable.from([mp4()]), path.join(directory, 'valid.mp4'), 64))
      .resolves.toMatchObject({ byteSize: 64 });
  });

  it('widens existing database records without losing them and stores counts above 2 GB', async () => {
    const db = new PGlite();
    try {
      await db.exec(await fs.readFile('prisma/migrations/20261012120000_youtube/migration.sql', 'utf8'));
      await db.exec(`INSERT INTO "YoutubeMediaAsset" (id,"userEmail",kind,status,filename,"contentType","byteSize","storagePath")
        VALUES ('old','owner','video','ready','old.mp4','video/mp4',100,'old.bin');`);
      await db.exec(await fs.readFile('prisma/migrations/20261023160000_youtube_large_uploads/migration.sql', 'utf8'));
      expect((await db.query<{ byteSize: bigint }>('SELECT "byteSize" FROM "YoutubeMediaAsset"')).rows.map(r => Number(r.byteSize))).toEqual([100]);
      await db.query('UPDATE "YoutubeMediaAsset" SET "byteSize"=$1 WHERE id=$2', [BigInt(LARGE_VIDEO), 'old']);
      expect(Number((await db.query<{ byteSize: bigint }>('SELECT "byteSize" FROM "YoutubeMediaAsset"')).rows[0].byteSize)).toBe(LARGE_VIDEO);
    } finally { await db.close(); }
  });
});
