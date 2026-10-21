import { readFile, mkdir, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), update: vi.fn(), deleteVideo: vi.fn(), token: vi.fn() }));
vi.mock('../lib/prisma', () => ({ default: { $transaction: mocks.transaction, youtubeMediaAsset: { update: mocks.update } } }));
vi.mock('../lib/youtube/api', () => ({ deleteVideo: mocks.deleteVideo }));
vi.mock('../lib/youtube/connections', () => ({ getValidAccessToken: mocks.token }));
import { expireLocalVideoFiles, LOCAL_MEDIA_RETENTION_MS } from '../lib/youtube/retention';
import { relativeMediaPath, resolveMediaPath } from '../lib/youtube/media';

let db: PGlite;
const account = 'local-retention-test';
const now = new Date('2026-10-21T12:00:00Z');
const old = new Date(now.getTime() - LOCAL_MEDIA_RETENTION_MS);
const file = (id: string) => resolveMediaPath(relativeMediaPath(account, id));
let insertDuringClaim: (() => Promise<void>) | null = null;

beforeAll(async () => {
  db = new PGlite({ parsers: { 1114: value => new Date(value.replace(' ', 'T') + 'Z') } });
  await db.exec(await readFile('prisma/migrations/20261012120000_youtube/migration.sql', 'utf8'));
  await db.exec(await readFile('prisma/migrations/20261020200000_youtube_upload_retention/migration.sql', 'utf8'));
  await mkdir(path.dirname(file('ma_old_video')), { recursive: true });
});
afterAll(async () => { await db.close(); await rm(path.dirname(file('ma_old_video')), { recursive: true, force: true }); });
beforeEach(async () => {
  vi.clearAllMocks(); insertDuringClaim = null;
  await db.exec('TRUNCATE "YoutubeMediaAsset", "YoutubeUploadJob"');
  const update = async (database: Pick<PGlite, 'query'>, { where, data }: any) => {
    await database.query('UPDATE "YoutubeMediaAsset" SET status=$1,"errorMessage"=$2 WHERE id=$3', [data.status, data.errorMessage ?? null, where.id]);
  };
  mocks.update.mockImplementation(args => update(db, args));
  mocks.transaction.mockImplementation(async (work: any) => db.transaction(async tx => work({
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = Prisma.sql(strings, ...values);
      const result = await tx.query(query.text, query.values);
      if (query.text.includes('FOR UPDATE') && insertDuringClaim) {
        // Emulate an enqueue committed between the candidate snapshot and guard.
        await tx.query(`INSERT INTO "YoutubeUploadJob" (id,"userEmail","connectionId","channelId","channelTitle","idempotencyKey","requestHash","mediaAssetId",status,"requestedVisibility","metadataJson","updatedAt") VALUES ('raced',$1,'c','c','c','raced','h','ma_old_video','queued','private','{}',$2)`, [account, now]);
      }
      return result.rows;
    },
    youtubeMediaAsset: { update: (args: any) => update(tx as any, args) },
  })));
});
async function asset(id = 'ma_old_video', overrides: Record<string, unknown> = {}) {
  const data = { id, userEmail: account, kind: 'video', status: 'ready', filename: 'test.mp4', contentType: 'video/mp4', storagePath: relativeMediaPath(account, id), createdAt: old, ...overrides };
  const keys = Object.keys(data);
  await db.query(`INSERT INTO "YoutubeMediaAsset" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})`, Object.values(data));
  await writeFile(file(id), 'local source bytes');
}
async function job(id: string, overrides: Record<string, unknown> = {}) {
  const data = { id, userEmail: account, connectionId: 'c', channelId: 'channel', channelTitle: 'channel', idempotencyKey: id, requestHash: 'h', mediaAssetId: 'ma_old_video', status: 'processed', requestedVisibility: 'public', actualVisibility: 'public', youtubeVideoId: 'keep_on_youtube', uploadedAt: old, metadataJson: '{}', updatedAt: now, ...overrides };
  const keys=Object.keys(data);
  await db.query(`INSERT INTO "YoutubeUploadJob" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(data));
}
async function exists(id='ma_old_video') { return access(file(id)).then(()=>true,()=>false); }

describe('local-only video retention with real SQL and files', () => {
  it('removes local bytes after a week while preserving YouTube ID, visibility, job and metadata', async () => {
    await asset(); await job('done');
    expect(await expireLocalVideoFiles(now)).toEqual({deletedAssets:['ma_old_video'],skipped:[]});
    expect(await exists()).toBe(false);
    expect((await db.query('SELECT status FROM "YoutubeMediaAsset"')).rows[0]).toEqual({status:'expired'});
    expect((await db.query('SELECT status,"youtubeVideoId","actualVisibility" FROM "YoutubeUploadJob"')).rows[0]).toEqual({status:'processed',youtubeVideoId:'keep_on_youtube',actualVisibility:'public'});
    expect(mocks.deleteVideo).not.toHaveBeenCalled(); expect(mocks.token).not.toHaveBeenCalled();
  });
  it.each(['queued','waiting_media','uploading','uploaded','processing','held','uncertain','failed','rejected'])('keeps bytes referenced by a %s job', async status => {
    await asset(); await job('pending',{status});
    expect((await expireLocalVideoFiles(now)).deletedAssets).toEqual([]); expect(await exists()).toBe(true);
  });
  it.each([{lockedAt:now},{lockToken:'worker'},{completionUncertain:true},{uploadedAt:null},{uploadedAt:new Date(old.getTime()+1)}])('keeps bytes when completed-state safety proof is incomplete: %j',async fields=>{
    await asset();await job('unsafe',fields);expect((await expireLocalVideoFiles(now)).deletedAssets).toEqual([]);expect(await exists()).toBe(true);
  });
  it('protects a shared file if another job still needs it',async()=>{
    await asset();await job('done');await job('pending',{status:'queued',youtubeVideoId:null});expect((await expireLocalVideoFiles(now)).deletedAssets).toEqual([]);
  });
  it('retains fresh files and thumbnail images but cleans old unused video files',async()=>{
    await asset();await asset('ma_fresh_video',{createdAt:new Date(old.getTime()+1)});await asset('ma_old_cover',{kind:'image'});
    expect((await expireLocalVideoFiles(now)).deletedAssets).toEqual(['ma_old_video']);expect(await exists('ma_fresh_video')).toBe(true);expect(await exists('ma_old_cover')).toBe(true);
  });
  it('does not follow a noncanonical or other-account storage path',async()=>{
    await asset('ma_old_video',{storagePath:'../../outside'});expect((await expireLocalVideoFiles(now)).deletedAssets).toEqual([]);expect(await exists()).toBe(true);
  });
  it('rechecks references after locking before claiming the file',async()=>{
    await asset();insertDuringClaim=async()=>{};expect((await expireLocalVideoFiles(now)).deletedAssets).toEqual([]);expect(await exists()).toBe(true);
  });
  it('resumes cleanup after a crash, including an already absent file',async()=>{
    await asset('ma_old_video',{status:'deleting'});await rm(file('ma_old_video'));expect((await expireLocalVideoFiles(now)).deletedAssets).toEqual(['ma_old_video']);
    expect((await expireLocalVideoFiles(now)).deletedAssets).toEqual([]);
  });
  it('retains a retryable cleanup marker on filesystem failure',async()=>{
    await asset();await rm(file('ma_old_video'));await mkdir(file('ma_old_video'));
    expect((await expireLocalVideoFiles(now)).skipped).toEqual(['ma_old_video']);
    expect((await db.query('SELECT status FROM "YoutubeMediaAsset"')).rows[0]).toEqual({status:'deleting'});
    await rm(file('ma_old_video'),{recursive:true});
  });
});
