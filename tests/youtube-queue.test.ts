import { readFile, mkdtemp, writeFile, rm, truncate } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), find: vi.fn(), update: vi.fn(), asset: vi.fn(),
  start: vi.fn(), video: vi.fn(), chunk: vi.fn(), token: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ default: {
  $queryRaw: mocks.query,
  $transaction: vi.fn().mockResolvedValue([]),
  youtubeUploadJob: { findFirst: mocks.find, updateMany: mocks.update, findMany: vi.fn().mockResolvedValue([]) },
  youtubeMediaAsset: { findFirst: mocks.asset },
} }));
vi.mock('../lib/youtube/connections', () => ({ getValidAccessToken: mocks.token, markConnectionReconnect: vi.fn() }));
vi.mock('../lib/youtube/api', () => ({ startResumableSession: mocks.start, getVideo: mocks.video, probeOrUpload: mocks.chunk, setThumbnail: vi.fn() }));

import { claimNextJob, holdUnstartedUpload, processPendingYoutubeJobs, uploadStatus } from '../lib/youtube/jobs';
import { normalizeUploadRequest } from '../lib/youtube/policy';
import { YoutubeUserError } from '../lib/youtube/types';
import { encryptString } from '../lib/youtube/oauth';

let db: PGlite;
let dir: string;
const account = 'queue-test-account';
// Thin adapter around Prisma for tests. The actual production claim SQL runs
// against embedded Postgres, not an imitation of its scheduling predicates.
function whereSql(where: Record<string, unknown>, values: unknown[]) {
  return Object.entries(where).map(([key, value]) => {
    if (value === null) return `"${key}" IS NULL`;
    if (value && typeof value === 'object' && 'in' in value) {
      const params = (value.in as unknown[]).map(v => { values.push(v); return `$${values.length}`; });
      return `"${key}" IN (${params.join(',')})`;
    }
    values.push(value);
    return `"${key}" = $${values.length}`;
  }).join(' AND ');
}

beforeAll(async () => {
  // Match Prisma's UTC interpretation of Postgres TIMESTAMP, independent of the developer's timezone.
  db = new PGlite({ parsers: { 1114: value => new Date(value.replace(' ', 'T') + 'Z') } });
  await db.exec(await readFile('prisma/migrations/20261012120000_youtube/migration.sql', 'utf8'));
  await db.exec(await readFile('prisma/migrations/20261020200000_youtube_upload_retention/migration.sql', 'utf8'));
  await db.exec(await readFile('prisma/migrations/20261023160000_youtube_large_uploads/migration.sql', 'utf8'));
  dir = await mkdtemp(path.join(process.cwd(), 'data/uploads/queue-test-'));
  await writeFile(path.join(dir, 'video.bin'), Buffer.alloc(100));
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'YOUTUBE_TOKEN_ENCRYPTION_KEY']) vi.stubEnv(key, 'test-only-configuration-at-least-32-characters');
  vi.stubEnv('YOUTUBE_WORKER_ENABLED', 'true');
  await db.exec('TRUNCATE "YoutubeUploadJob", "YoutubeConnection"');
  for (const channel of ['doom', 'brain']) await db.query(
    'INSERT INTO "YoutubeConnection" (id,"userEmail","channelId","channelTitle","refreshTokenEncrypted",scopes) VALUES ($1,$2,$3,$3,$4,$4)',
    [`conn_${channel}`, account, channel, 'test'],
  );
  mocks.query.mockImplementation(async (strings, ...values) => {
    const query = Prisma.sql(strings, ...values);
    return (await db.query(query.text, query.values)).rows;
  });
  mocks.find.mockImplementation(async ({ where }) => {
    const values: unknown[] = [];
    return (await db.query(`SELECT * FROM "YoutubeUploadJob" WHERE ${whereSql(where, values)} LIMIT 1`, values)).rows[0] ?? null;
  });
  mocks.update.mockImplementation(async ({ where, data }) => {
    const values: unknown[] = [];
    const assignments = Object.entries(data).map(([key, value]) => { values.push(value); return `"${key}"=$${values.length}`; });
    const result = await db.query(`UPDATE "YoutubeUploadJob" SET ${assignments.join(',')} WHERE ${whereSql(where, values)} RETURNING id`, values);
    return { count: result.rows.length };
  });
  mocks.asset.mockImplementation(async ({ where }) => ({
    id: where.id, userEmail: account, kind: 'video', status: 'ready', byteSize: 100,
    contentType: 'video/mp4', storagePath: `${path.basename(dir)}/video.bin`, sourceUrl: null, expiresAt: null,
  }));
  mocks.token.mockResolvedValue('test-token');
  mocks.start.mockImplementation(async (_token, metadata) => {
    if (metadata.title === 'doom') throw new YoutubeUserError('uploadLimitExceeded', 'channel limit');
    return 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test';
  });
  const video = { id: 'brain_video', snippet: { channelId: 'brain' }, status: { uploadStatus: 'processed', privacyStatus: 'private' }, processingDetails: { processingStatus: 'succeeded' } };
  mocks.video.mockResolvedValue(video);
  mocks.chunk.mockResolvedValue({ type: 'complete', video });
});

async function job(id: string, channel: string, overrides: Record<string, unknown> = {}) {
  const metadata = normalizeUploadRequest({ connectionId: `conn_${channel}`, mediaAssetId: 'ma_test_asset', title: channel, categoryId: '28', madeForKids: false, containsSyntheticMedia: true }, new Date());
  const fields = {
    id, userEmail: account, connectionId: `conn_${channel}`, channelId: channel, channelTitle: channel,
    idempotencyKey: `key_${id}`, requestHash: metadata.requestHash, mediaAssetId: 'ma_test_asset', status: 'queued',
    requestedVisibility: 'private', metadataJson: JSON.stringify(metadata), byteSize: 100,
    createdAt: new Date(Date.now() - 60_000), ...overrides,
  };
  const keys = Object.keys(fields);
  await db.query(`INSERT INTO "YoutubeUploadJob" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(fields));
}

describe('YouTube queue with actual PostgreSQL claim predicates', () => {
  it('resumes and completes a 3.33 GB upload with BIGINT counters and JSON-safe status', async () => {
    const size = 3_333_358_141;
    const start = size - 64;
    const file = path.join(dir, 'video.bin');
    // A sparse file exercises large seek offsets without writing gigabytes.
    await truncate(file, size);
    try {
      mocks.asset.mockResolvedValue({ id: 'ma_test_asset', userEmail: account, kind: 'video', status: 'ready',
        byteSize: BigInt(size), contentType: 'video/mp4', storagePath: `${path.basename(dir)}/video.bin`, sourceUrl: null, expiresAt: null });
      await job('large', 'brain', { byteSize: size, progressBytes: start, bytesAcked: start,
        status: 'uploading', resumableSessionEnc: encryptString('https://www.googleapis.com/upload/youtube/v3/videos?upload_id=large') });
      mocks.chunk.mockResolvedValueOnce({ type: 'incomplete', acked: start })
        .mockResolvedValueOnce({ type: 'complete', video: await mocks.video() });
      expect(await processPendingYoutubeJobs()).toEqual({ processed: 1 });
      const result = await uploadStatus(account, 'large');
      expect(result).toMatchObject({ status: 'processed', actualVisibility: 'private',
        progress: { bytesUploaded: size, byteSize: size, percent: 100 } });
      expect(() => JSON.stringify(result)).not.toThrow();
      expect(mocks.chunk.mock.calls[1][0]).toMatchObject({ start, total: size });
      expect(mocks.start).not.toHaveBeenCalled();
    } finally { await truncate(file, 100); }
  });

  it('advances Brain Pickle in the same drain after doomish hits its channel limit', async () => {
    await job('a_doom', 'doom');
    await job('b_doom', 'doom');
    await job('c_brain', 'brain');
    expect(await processPendingYoutubeJobs({ maxJobs: 8 })).toEqual({ processed: 2 });
    expect(await uploadStatus(account, 'a_doom')).toMatchObject({ error: { code: 'uploadLimitExceeded' }, attemptCount: 0 });
    expect(await uploadStatus(account, 'b_doom')).toMatchObject({ status: 'queued' });
    expect(await uploadStatus(account, 'c_brain')).toMatchObject({ status: 'processed', youtubeVideoId: 'brain_video', actualVisibility: 'private', deletesAt: null, automaticYoutubeDeletion: false, localMediaRetentionDays: 7 });
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it('scopes channel cooldowns and honors project-wide quota cooldowns', async () => {
    await job('a', 'doom', { status: 'uploading', errorCode: 'uploadLimitExceeded', nextAttemptAt: new Date(Date.now() + 60_000) });
    await job('b', 'doom');
    await job('c', 'brain');
    expect((await claimNextJob())?.id).toBe('c');
    await db.exec(`UPDATE "YoutubeUploadJob" SET "errorCode"='quotaExceeded' WHERE id='a'`);
    expect(await claimNextJob()).toBeNull();
  });

  it('polls an already accepted video during an upload-limit cooldown without starting a session', async () => {
    await job('a', 'brain', { errorCode: 'uploadLimitExceeded', status: 'uploading', nextAttemptAt: new Date(Date.now() + 60_000) });
    await job('b', 'brain', { youtubeVideoId: 'brain_video', status: 'processing' });
    await processPendingYoutubeJobs();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(await uploadStatus(account, 'b')).toMatchObject({ status: 'processed' });
  });

  it('leaves a live lease alone, recovers a stale lease and never claims one job twice', async () => {
    await job('a', 'doom', { lockedAt: new Date(), lockToken: 'active-worker' });
    await job('b', 'brain', { lockedAt: new Date(Date.now() - 180_000), lockToken: 'dead-worker' });
    const results = await Promise.all([claimNextJob(), claimNextJob()]);
    expect(results.filter(Boolean).map(r => r!.id)).toEqual(['b']);
  });

  it('rotates a yielded old job behind untouched work and excludes visited channels', async () => {
    await job('a', 'doom', { status: 'uploading', nextAttemptAt: new Date(Date.now() - 1_000) });
    await job('b', 'brain');
    expect((await claimNextJob())?.id).toBe('b');
    expect(await claimNextJob([], ['doom'])).toBeNull();
    expect(await claimNextJob(['a'])).toBeNull();
  });

  it('holds only the owned unstarted original and keeps it held on retries', async () => {
    await job('original', 'brain');
    await expect(holdUnstartedUpload('other-account', 'original')).rejects.toMatchObject({ code: 'not_found' });
    await holdUnstartedUpload(account, 'original');
    expect(await holdUnstartedUpload(account, 'original')).toMatchObject({ status: 'held', terminal: true });
    expect(await claimNextJob()).toBeNull();
  });

  it('recovers a session-start quota rejection stranded by a disconnected connection', async () => {
    await job('original', 'doom');
    await processPendingYoutubeJobs();
    expect(mocks.chunk).not.toHaveBeenCalled();
    expect(await uploadStatus(account, 'original')).toMatchObject({ status: 'uploading', videoAccepted: false });
    await db.query('UPDATE "YoutubeUploadJob" SET "nextAttemptAt"=$1 WHERE id=$2', [new Date(Date.now() - 1_000), 'original']);
    await db.query('DELETE FROM "YoutubeConnection" WHERE id=$1', ['conn_doom']);
    expect(await claimNextJob()).toBeNull();
    const before = (await db.query<Record<string, unknown>>('SELECT * FROM "YoutubeUploadJob" WHERE id=$1', ['original'])).rows[0];
    expect(await holdUnstartedUpload(account, 'original')).toMatchObject({ status: 'held', terminal: true, videoAccepted: false });
    const after = (await db.query<Record<string, unknown>>('SELECT * FROM "YoutubeUploadJob" WHERE id=$1', ['original'])).rows[0];
    for (const key of ['idempotencyKey', 'requestHash', 'metadataJson', 'mediaAssetId', 'connectionId']) expect(after[key]).toEqual(before[key]);
  });

  const legacyLimitMessage = 'This YouTube channel has hit an upload limit. Wait and try again later with a new idempotency key only after you confirm the video was not created.';
  const legacyWait = () => ({ status: 'uploading', errorCode: 'transient', errorMessage: legacyLimitMessage,
    updatedAt: new Date(Date.now() - 2 * 60 * 60_000), nextAttemptAt: new Date(Date.now() - 60_000) });

  it('holds the exact historical channel-limit failure after reconnect without creating a video', async () => {
    await job('legacy', 'doom', legacyWait());
    await db.query('DELETE FROM "YoutubeConnection" WHERE id=$1', ['conn_doom']);
    const before = (await db.query<Record<string, unknown>>('SELECT * FROM "YoutubeUploadJob" WHERE id=$1', ['legacy'])).rows[0];
    expect(await claimNextJob()).toBeNull();
    expect(await holdUnstartedUpload(account, 'legacy')).toMatchObject({ status: 'held', terminal: true, videoAccepted: false, youtubeVideoId: null });
    const after = (await db.query<Record<string, unknown>>('SELECT * FROM "YoutubeUploadJob" WHERE id=$1', ['legacy'])).rows[0];
    for (const key of ['idempotencyKey', 'requestHash', 'metadataJson', 'mediaAssetId', 'connectionId']) expect(after[key]).toEqual(before[key]);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.chunk).not.toHaveBeenCalled();
  });

  it.each([
    { errorMessage: 'Session request timed out' },
    { errorMessage: legacyLimitMessage + ' changed' },
    { errorMessage: null },
    { updatedAt: new Date() },
    { nextAttemptAt: new Date(Date.now() + 60_000) },
    { nextAttemptAt: null },
    { lockToken: 'worker' },
    { lockedAt: new Date() },
    { resumableSessionEnc: 'session' },
    { youtubeVideoId: 'created' },
    { uploadedAt: new Date() },
    { bytesAcked: 1 },
    { progressBytes: 1 },
    { completionUncertain: true },
  ])('refuses unsafe legacy generic-error recovery: %j', async override => {
    await job('legacy', 'doom', { ...legacyWait(), ...override });
    await expect(holdUnstartedUpload(account, 'legacy')).rejects.toMatchObject({ code: 'job_started' });
  });

  it.each(['errorMessage', 'updatedAt'])('rejects concurrent legacy evidence changes to %s', async field => {
    await job('legacy', 'doom', legacyWait());
    const update = mocks.update.getMockImplementation()!;
    mocks.update.mockImplementationOnce(async args => {
      await db.query(`UPDATE "YoutubeUploadJob" SET "${field}"=$1 WHERE id=$2`, [field === 'updatedAt' ? new Date() : 'Session request timed out', 'legacy']);
      return update(args);
    });
    await expect(holdUnstartedUpload(account, 'legacy')).rejects.toMatchObject({ code: 'job_started' });
  });

  it.each([
    { nextAttemptAt: new Date(Date.now() + 60_000) },
    { nextAttemptAt: null },
    { errorCode: 'transient' },
    { errorCode: null },
    { lockToken: 'worker' },
    { lockedAt: new Date() },
    { resumableSessionEnc: 'existing-session' },
    { youtubeVideoId: 'already-created' },
    { uploadedAt: new Date() },
    { bytesAcked: 1 },
    { progressBytes: 1 },
    { completionUncertain: true },
  ])('refuses unsafe or still-cooling-down legacy quota recovery: %j', async override => {
    await job('original', 'doom', { status: 'uploading', errorCode: 'uploadLimitExceeded', nextAttemptAt: new Date(Date.now() - 1_000), ...override });
    await expect(holdUnstartedUpload(account, 'original')).rejects.toMatchObject({ code: 'job_started' });
    expect(await uploadStatus(account, 'original')).toMatchObject({ status: 'uploading', terminal: false });
  });

  it('refuses recovery if a worker claims the job after the initial read', async () => {
    await job('original', 'doom', { status: 'uploading', errorCode: 'uploadLimitExceeded', nextAttemptAt: new Date(Date.now() - 1_000) });
    const update = mocks.update.getMockImplementation()!;
    mocks.update.mockImplementationOnce(async args => {
      expect((await claimNextJob())?.id).toBe('original');
      return update(args);
    });
    await expect(holdUnstartedUpload(account, 'original')).rejects.toMatchObject({ code: 'job_started' });
  });

  it.each([
    { lockToken: 'worker', lockedAt: new Date() },
    { resumableSessionEnc: 'existing-session' },
    { youtubeVideoId: 'already-created' },
    { completionUncertain: true },
  ])('refuses an unsafe hold: %j', async override => {
    await job('original', 'brain', override);
    await expect(holdUnstartedUpload(account, 'original')).rejects.toMatchObject({ code: 'job_started' });
  });

  it('does not wake work from a status read and respects the maintenance switch', async () => {
    await job('a', 'brain');
    await uploadStatus(account, 'a');
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    vi.stubEnv('YOUTUBE_WORKER_ENABLED', 'false');
    expect(await processPendingYoutubeJobs()).toEqual({ processed: 0 });
  });
});
