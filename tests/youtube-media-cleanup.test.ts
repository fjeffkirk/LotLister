import { readFile, mkdir, writeFile, access, rm, truncate } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), update: vi.fn(), findJob: vi.fn(), deleteVideo: vi.fn(), token: vi.fn() }));
vi.mock('../lib/prisma', () => ({ default: { $transaction: mocks.transaction,
  youtubeMediaAsset: { update: mocks.update }, youtubeUploadJob: { findFirst: mocks.findJob } } }));
vi.mock('../lib/youtube/api', () => ({ deleteVideo: mocks.deleteVideo }));
vi.mock('../lib/youtube/connections', () => ({ getValidAccessToken: mocks.token }));
import { deleteFailedMedia, applyConfiguredFailedMediaCleanup, deleteCompletedMedia, applyConfiguredCompletedMediaCleanup } from '../lib/youtube/media-cleanup';
import { relativeMediaPath, resolveMediaPath } from '../lib/youtube/media';

let db: PGlite;
const account = 'manual-media-cleanup-test';
const target = { jobId: 'yt_failed_source', connectionId: 'connection_hushnaut', channelId: 'UC' + 'a'.repeat(22),
  idempotencyKey: 'immutable_original_key', mediaAssetId: 'ma_failed_source', expectedByteSize: 18,
  backupReference: 'durable-original-master', deletionIntent: true as const };
const file = () => resolveMediaPath(relativeMediaPath(account, target.mediaAssetId));
let race = false;

beforeAll(async () => {
  db = new PGlite({ parsers: { 1114: value => new Date(value.replace(' ', 'T') + 'Z') } });
  for (const migration of ['20261012120000_youtube', '20261020200000_youtube_upload_retention', '20261023160000_youtube_large_uploads']) {
    await db.exec(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
  }
  await mkdir(path.dirname(file()), { recursive: true });
});

describe('explicit completed-source cleanup using real SQL and files', () => {
  const completed = { ...target, expectedYoutubeVideoId: 'r117xuJoT9g' };
  beforeEach(async () => {
    await db.query('UPDATE "YoutubeUploadJob" SET status=\'processed\', "youtubeVideoId"=$1, "uploadedAt"=NOW(), "byteSize"=$2, "bytesAcked"=$2',
      [completed.expectedYoutubeVideoId, target.expectedByteSize]);
  });
  it('removes the completed local source while preserving the entire job and YouTube video', async () => {
    const before = (await db.query('SELECT * FROM "YoutubeUploadJob"')).rows;
    expect(await deleteCompletedMedia(account, completed)).toMatchObject({ localFileDeleted: true, freedBytes: 18, youtubeVideoDeleted: false, uploadHistoryPreserved: true });
    expect(await exists()).toBe(false);
    expect((await db.query('SELECT * FROM "YoutubeUploadJob"')).rows).toEqual(before);
    expect(mocks.deleteVideo).not.toHaveBeenCalled(); expect(mocks.token).not.toHaveBeenCalled();
    expect(await deleteCompletedMedia(account, completed)).toMatchObject({ alreadyDeleted: true, freedBytes: 0 });
  });
  it.each(['uploaded', 'processing', 'uploading', 'queued', 'failed', 'rejected', 'uncertain', 'held'])('preserves %s source files', async status => {
    await db.query('UPDATE "YoutubeUploadJob" SET status=$1', [status]);
    await expect(deleteCompletedMedia(account, completed)).rejects.toThrow('Only an unleased');
    expect(await exists()).toBe(true);
  });
  it.each(['"youtubeVideoId"=\'differentid\'', '"uploadedAt"=NULL', '"byteSize"=19', '"bytesAcked"=17'])('requires exact accepted video and bytes: %s', async clause => {
    await db.exec('UPDATE "YoutubeUploadJob" SET ' + clause);
    await expect(deleteCompletedMedia(account, completed)).rejects.toThrow('fully acknowledged');
    expect(await exists()).toBe(true);
  });
  it.each(['"lockedAt"=NOW()', '"lockToken"=\'worker\'', '"completionUncertain"=true'])('preserves leased or uncertain work: %s', async clause => {
    await db.exec('UPDATE "YoutubeUploadJob" SET ' + clause);
    await expect(deleteCompletedMedia(account, completed)).rejects.toThrow();
    expect(await exists()).toBe(true);
  });
  it('retains the channel, account, backup, shared-file and size protections', async () => {
    await expect(deleteCompletedMedia('different-account', completed)).rejects.toThrow();
    await expect(deleteCompletedMedia(account, { ...completed, expectedByteSize: 19 })).rejects.toThrow();
    await expect(deleteCompletedMedia(account, { ...completed, backupReference: '' })).rejects.toThrow();
    await expect(deleteCompletedMedia(account, { ...completed, deletionIntent: false as any })).rejects.toThrow();
    vi.stubEnv('YOUTUBE_MEDIA_CLEANUP_CHANNEL_IDS', '');
    await expect(deleteCompletedMedia(account, completed)).rejects.toThrow('not enabled');
    vi.stubEnv('YOUTUBE_MEDIA_CLEANUP_CHANNEL_IDS', target.channelId);
    race = true;
    await expect(deleteCompletedMedia(account, completed)).rejects.toThrow('Another upload references');
    expect(await exists()).toBe(true);
  });
  it('accepts only configured exact completed targets and remains off by default', async () => {
    await applyConfiguredCompletedMediaCleanup();expect(mocks.transaction).not.toHaveBeenCalled();
    vi.stubEnv('YOUTUBE_COMPLETED_MEDIA_CLEANUP', JSON.stringify([completed]));
    await applyConfiguredCompletedMediaCleanup();expect(await exists()).toBe(false);
    expect(mocks.findJob).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ youtubeVideoId: completed.expectedYoutubeVideoId }) }));
  });
  it('fails closed on an operator identity mismatch or a build', async () => {
    vi.stubEnv('YOUTUBE_COMPLETED_MEDIA_CLEANUP', JSON.stringify([completed]));
    mocks.findJob.mockResolvedValue(null);
    await expect(applyConfiguredCompletedMediaCleanup()).rejects.toThrow('identity mismatch');
    vi.stubEnv('NEXT_PHASE','phase-production-build');
    await applyConfiguredCompletedMediaCleanup();expect(await exists()).toBe(true);
  });
});
afterAll(async () => { vi.unstubAllEnvs(); await db.close(); await rm(path.dirname(file()), { recursive: true, force: true }); });
beforeEach(async () => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); race = false;
  vi.stubEnv('YOUTUBE_MEDIA_CLEANUP_CHANNEL_IDS', target.channelId);
  await db.exec('TRUNCATE "YoutubeMediaAsset", "YoutubeUploadJob"');
  const update = async (database: Pick<PGlite, 'query'>, { where, data }: any) => {
    await database.query('UPDATE "YoutubeMediaAsset" SET status=$1,"errorMessage"=$2 WHERE id=$3', [data.status, data.errorMessage ?? null, where.id]);
  };
  mocks.update.mockImplementation(args => update(db, args));
  mocks.transaction.mockImplementation(async (work: any) => db.transaction(async tx => work({
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = Prisma.sql(strings, ...values);
      const result = await tx.query(query.text, query.values);
      if (query.text.includes('FROM "YoutubeMediaAsset"') && race) {
        // Simulate a reference committed before the asset lock was acquired.
        await tx.query(`INSERT INTO "YoutubeUploadJob" (id,"userEmail","connectionId","channelId","channelTitle","idempotencyKey","requestHash","mediaAssetId",status,"requestedVisibility","metadataJson","updatedAt") VALUES ('shared',$1,'connection','channel','channel','shared','h',$2,'queued','private','{}',NOW())`, [account, target.mediaAssetId]);
      }
      return result.rows;
    },
    youtubeMediaAsset: { update: (args: any) => update(tx as any, args) },
  })));
  mocks.findJob.mockResolvedValue({ userEmail: account });
  await writeFile(file(), 'local source bytes');
  await db.query(`INSERT INTO "YoutubeMediaAsset" (id,"userEmail",kind,status,filename,"contentType","storagePath","byteSize") VALUES ($1,$2,'video','ready','test.mp4','video/mp4',$3,$4)`, [target.mediaAssetId, account, relativeMediaPath(account, target.mediaAssetId), target.expectedByteSize]);
  await db.query(`INSERT INTO "YoutubeUploadJob" (id,"userEmail","connectionId","channelId","channelTitle","idempotencyKey","requestHash","mediaAssetId",status,"requestedVisibility","metadataJson","updatedAt","youtubeVideoId") VALUES ($1,$2,$3,$4,'Hushnaut',$5,'h',$6,'failed','private','{}',NOW(),'preserve_youtube_id')`, [target.jobId, account, target.connectionId, target.channelId, target.idempotencyKey, target.mediaAssetId]);
});
const exists = () => access(file()).then(() => true, () => false);

describe('explicit failed-source cleanup using real SQL and files', () => {
  it('frees only the source and preserves the failed job, video ID and thumbnail', async () => {
    const thumbnail = path.join(path.dirname(file()), 'thumbnail.bin');
    await writeFile(thumbnail, 'keep thumbnail');
    const before = (await db.query('SELECT * FROM "YoutubeUploadJob"')).rows;
    expect(await deleteFailedMedia(account, target)).toMatchObject({ localFileDeleted: true, freedBytes: 18, youtubeVideoDeleted: false });
    expect(await exists()).toBe(false);
    expect(await readFile(thumbnail, 'utf8')).toBe('keep thumbnail');
    expect((await db.query('SELECT * FROM "YoutubeUploadJob"')).rows).toEqual(before);
    expect(mocks.deleteVideo).not.toHaveBeenCalled(); expect(mocks.token).not.toHaveBeenCalled();
    expect(await deleteFailedMedia(account, target)).toMatchObject({ alreadyDeleted: true, freedBytes: 0 });
  });
  it('does not enable local cleanup through YouTube deletion permission', async () => {
    vi.stubEnv('YOUTUBE_MEDIA_CLEANUP_CHANNEL_IDS', '');
    vi.stubEnv('YOUTUBE_CLEANUP_CHANNEL_IDS', target.channelId);
    await expect(deleteFailedMedia(account, target)).rejects.toThrow('not enabled');
    expect(await exists()).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('handles sources beyond the old 32-bit counter without loading them into memory', async () => {
    const size = 3333358141;
    await truncate(file(), size);
    await db.query('UPDATE "YoutubeMediaAsset" SET "byteSize"=$1', [size]);
    expect(await deleteFailedMedia(account, { ...target, expectedByteSize: size })).toMatchObject({ freedBytes: size });
  });
  it.each(['queued', 'waiting_media', 'uploading', 'uploaded', 'processing', 'held', 'uncertain', 'processed'])('refuses %s work', async status => {
    await db.query('UPDATE "YoutubeUploadJob" SET status=$1', [status]);
    await expect(deleteFailedMedia(account, target)).rejects.toThrow('Only an unleased');
    expect(await exists()).toBe(true);
  });
  it.each(['"lockedAt"=NOW()', '"lockToken"=\'worker\'', '"completionUncertain"=true'])('refuses unsafe terminal work: %s', async clause => {
    await db.exec('UPDATE "YoutubeUploadJob" SET ' + clause);
    await expect(deleteFailedMedia(account, target)).rejects.toThrow(); expect(await exists()).toBe(true);
  });
  it.each(['connectionId', 'channelId', 'idempotencyKey', 'mediaAssetId'])('refuses wrong %s', async field => {
    const value = field === 'channelId' ? 'UC' + 'b'.repeat(22) : 'different_identifier';
    await expect(deleteFailedMedia(account, { ...target, [field]: value })).rejects.toThrow();
    expect(await exists()).toBe(true);
  });
  it('refuses another account, wrong byte size, missing intent and missing backup', async () => {
    await expect(deleteFailedMedia('different-account', target)).rejects.toThrow();
    await expect(deleteFailedMedia(account, { ...target, expectedByteSize: 19 })).rejects.toThrow();
    await expect(deleteFailedMedia(account, { ...target, deletionIntent: false as any })).rejects.toThrow();
    await expect(deleteFailedMedia(account, { ...target, backupReference: '' })).rejects.toThrow();
    expect(await exists()).toBe(true);
  });
  it('refuses shared media, including a reference discovered after locking', async () => {
    race = true;
    await expect(deleteFailedMedia(account, target)).rejects.toThrow('Another upload references');
    expect(await exists()).toBe(true);
  });
  it.each(['kind=\'image\'', '"storagePath"=\'../../outside\''])('refuses non-video or noncanonical path: %s', async clause => {
    await db.exec('UPDATE "YoutubeMediaAsset" SET ' + clause);
    await expect(deleteFailedMedia(account, target)).rejects.toThrow(); expect(await exists()).toBe(true);
  });
  it('refuses a file whose on-disk size changed', async () => {
    await writeFile(file(), 'unexpected bytes');
    await expect(deleteFailedMedia(account, target)).rejects.toThrow('approved size'); expect(await exists()).toBe(true);
  });
  it('recovers the deleting marker when a crash already removed the bytes', async () => {
    await db.exec('UPDATE "YoutubeMediaAsset" SET status=\'deleting\''); await rm(file());
    expect(await deleteFailedMedia(account, target)).toMatchObject({ localFileDeleted: true, freedBytes: 0 });
    expect((await db.query('SELECT status FROM "YoutubeMediaAsset"')).rows[0]).toEqual({ status: 'expired' });
  });
  it('does nothing without operator configuration and refuses mismatched operator targets', async () => {
    await applyConfiguredFailedMediaCleanup(); expect(mocks.transaction).not.toHaveBeenCalled();
    vi.stubEnv('YOUTUBE_FAILED_MEDIA_CLEANUP', JSON.stringify([target]));
    mocks.findJob.mockResolvedValue(null);
    await expect(applyConfiguredFailedMediaCleanup()).rejects.toThrow('identity mismatch'); expect(await exists()).toBe(true);
  });
  it('applies the same guarded cleanup to an exact operator target', async () => {
    vi.stubEnv('YOUTUBE_FAILED_MEDIA_CLEANUP', JSON.stringify([target]));
    await applyConfiguredFailedMediaCleanup(); expect(await exists()).toBe(false);
  });
});
