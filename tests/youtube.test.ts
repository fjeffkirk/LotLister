import { Readable } from 'stream';
import { afterEach, describe, expect, it } from 'vitest';
import { youtubeCallbackUrl, YOUTUBE_SCOPES } from '../lib/youtube/config';
import { advanceUpload, enqueueWithRepo, type AssetRecord, type ConnectionRecord, type UploadIo, type UploadRepo } from '../lib/youtube/jobs';
import { downloadPublicHttps, openUploadGrant, signUploadGrant, sniffMedia } from '../lib/youtube/media';
import {
  assertCallbackBinding,
  buildAuthorizeUrl,
  decryptString,
  encryptString,
  openState,
  sealState,
} from '../lib/youtube/oauth';
import {
  applyVerifiedVideo,
  buildInsertBody,
  buildMetadataUpdate,
  buildPublishBody,
  buildScheduleBody,
  decideResume,
  interpretVideo,
  normalizeUploadRequest,
  redactSecrets,
  scheduleBlockReason,
  toPublicJob,
  visibilityReport,
} from '../lib/youtube/policy';
import { assertAddressesPublic, isBlockedAddress, screenUrl } from '../lib/youtube/ssrf';
import { type UploadJobState, type YoutubeVideo } from '../lib/youtube/types';

const NOW = new Date('2026-10-12T15:00:00.000Z');

const baseUpload = {
  connectionId: 'conn_ai_channel',
  mediaAssetId: 'ma_1234567890abcdef12345678',
  title: 'Shop update',
  description: 'A finished video',
  tags: ['cards'],
  categoryId: '22',
  madeForKids: false,
  containsSyntheticMedia: true,
};

function upload(overrides: Record<string, unknown> = {}) {
  return normalizeUploadRequest({ ...baseUpload, ...overrides } as typeof baseUpload, NOW);
}

describe('YouTube OAuth and tenant binding', () => {
  const previous = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY;
  afterEach(() => {
    if (previous === undefined) delete process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY;
    else process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = previous;
  });

  it('keeps refresh tokens encrypted and out of the ciphertext', () => {
    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = 'lotlister-test-key-lotlister-test';
    const token = 'ya29.super-secret-refresh-token';
    const stored = encryptString(token);
    expect(stored).not.toContain('ya29');
    expect(stored).not.toContain(token);
    expect(decryptString(stored)).toBe(token);
    expect(() => decryptString(`${stored.slice(0, -4)}aaaa`)).toThrow(/could not be decrypted/);
  });

  it('binds the OAuth callback to the LotLister account that started it', () => {
    const secret = 'oauth-state-secret-oauth-state-secret';
    const sealed = sealState({ nonce: 'nonce-1', accountId: 'ebay-user-1', exp: 2_000_000_000 }, secret);
    expect(assertCallbackBinding({
      sealed,
      cookieNonce: 'nonce-1',
      currentAccountId: 'ebay-user-1',
      secret,
      nowSeconds: 1_700_000_000,
    }).accountId).toBe('ebay-user-1');
    expect(() => assertCallbackBinding({
      sealed,
      cookieNonce: 'nonce-1',
      currentAccountId: 'ebay-user-2',
      secret,
      nowSeconds: 1_700_000_000,
    })).toThrow(/different LotLister account/);
    expect(() => assertCallbackBinding({
      sealed,
      cookieNonce: 'other-nonce',
      currentAccountId: 'ebay-user-1',
      secret,
      nowSeconds: 1_700_000_000,
    })).toThrow(/expired or did not match/);
    expect(openState(`${sealed}x`, secret, 1_700_000_000)).toBeNull();
    expect(openState(sealed, secret, 2_000_000_001)).toBeNull();
  });

  it('requests offline access and the minimum YouTube scopes', () => {
    const url = new URL(buildAuthorizeUrl({
      clientId: 'client',
      redirectUri: youtubeCallbackUrl('https://lotlister.onrender.com/'),
      state: 'signed-state',
      codeChallenge: 'challenge',
    }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toContain('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('redirect_uri')).toBe('https://lotlister.onrender.com/api/youtube/callback');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...YOUTUBE_SCOPES]);
    expect(url.searchParams.get('scope')).not.toContain('youtubepartner');
  });

  it('rejects a tampered upload grant and an expired one', () => {
    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = 'lotlister-test-key-lotlister-test';
    const grant = signUploadGrant({ assetId: 'ma_1234567890abcdef12345678', accountId: 'ebay-user-1', exp: 2_000_000_000, maxBytes: 1000 });
    expect(openUploadGrant(grant, 1_700_000_000).accountId).toBe('ebay-user-1');
    expect(() => openUploadGrant(grant, 2_000_000_001)).toThrow(/expired/);
    expect(() => openUploadGrant(`${grant}x`, 1_700_000_000)).toThrow(/signature/);
  });
});

describe('source URL safety', () => {
  it('rejects private, metadata, and non-https targets', async () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('10.1.2.3')).toBe(true);
    expect(isBlockedAddress('172.16.5.1')).toBe(true);
    expect(isBlockedAddress('192.168.1.9')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('fe80::1')).toBe(true);
    expect(isBlockedAddress('fc00::1')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(() => assertAddressesPublic(['1.1.1.1', '10.0.0.2'])).toThrow(/private/);
    await expect(screenUrl('http://cdn.example/video.mp4', async () => ['1.1.1.1'])).rejects.toThrow(/https/);
    await expect(screenUrl('https://user:pass@cdn.example/video.mp4', async () => ['1.1.1.1'])).rejects.toThrow(/password/);
    await expect(screenUrl('https://169.254.169.254/latest/meta-data', async () => ['169.254.169.254'])).rejects.toThrow(/private|internal/);
    await expect(screenUrl('https://metadata.google.internal/', async () => ['1.1.1.1'])).rejects.toThrow(/not allowed/);
    await expect(screenUrl('https://cdn.example/video.mp4', async () => ['10.0.0.5'])).rejects.toThrow(/private/);
    await expect(screenUrl('https://cdn.example/video.mp4', async () => ['1.1.1.1'])).resolves.toBeInstanceOf(URL);
  });

  it('does not follow a redirect to an internal address', async () => {
    const calls: string[] = [];
    await expect(downloadPublicHttps('https://cdn.example/video.mp4', 'unused.mp4', {
      lookup: async () => ['1.1.1.1'],
      transport: {
        async request(url) {
          calls.push(url.hostname);
          return { status: 302, headers: { location: 'http://127.0.0.1/latest' }, stream: Readable.from([]) };
        },
      },
    })).rejects.toThrow(/https|private|not allowed|internal/);
    expect(calls).toEqual(['cdn.example']);
  });

  it('recognizes video and image bytes and rejects documents', () => {
    const mp4 = Buffer.alloc(16);
    mp4.write('ftyp', 4, 'ascii');
    mp4.write('isom', 8, 'ascii');
    expect(sniffMedia(mp4)?.contentType).toBe('video/mp4');
    expect(sniffMedia(Buffer.from([0xff, 0xd8, 0xff, 0x00]))?.kind).toBe('image');
    expect(sniffMedia(Buffer.from('<!doctype html>'))).toBeNull();
  });
});

describe('upload policy', () => {
  it('defaults to private and requires explicit publication intent', () => {
    const created = upload();
    expect(created.privacyStatus).toBe('private');
    expect(created.publicationIntent).toBe(false);
    const body = buildInsertBody(created).body as { status: { privacyStatus: string; containsSyntheticMedia: boolean } };
    expect(body.status.privacyStatus).toBe('private');
    expect(body.status.containsSyntheticMedia).toBe(true);
    expect(() => upload({ visibility: 'public' })).toThrow(/publicationIntent/);
    expect(() => upload({ visibility: 'unlisted' })).toThrow(/publicationIntent/);
    const published = upload({ visibility: 'public', publicationIntent: true });
    expect(published.privacyStatus).toBe('public');
    expect(published.requestHash).not.toBe(created.requestHash);
  });

  it('requires the caller to declare kids and synthetic content', () => {
    expect(() => upload({ madeForKids: undefined })).toThrow(/made for kids/);
    expect(() => upload({ containsSyntheticMedia: undefined })).toThrow(/synthetic/);
  });

  it('validates schedule time zones and refuses times YouTube would publish immediately', () => {
    expect(() => upload({ publishAt: '2026-10-12T10:00:00', timeZone: 'America/New_York', publicationIntent: true })).toThrow(/2 minutes/);
    expect(() => upload({ publishAt: '2026-10-20T09:00:00', publicationIntent: true })).toThrow(/timeZone/);
    expect(() => upload({ publishAt: '2026-03-08T02:30:00', timeZone: 'America/New_York', publicationIntent: true })).toThrow(/does not exist/);
    expect(() => upload({ publishAt: '2026-11-01T01:30:00', timeZone: 'America/New_York', publicationIntent: true })).toThrow(/twice/);
    const scheduled = upload({
      publishAt: '2026-10-20T09:00:00',
      timeZone: 'America/New_York',
      publicationIntent: true,
    });
    expect(scheduled.privacyStatus).toBe('private');
    expect(scheduled.publishAt).toBe('2026-10-20T13:00:00.000Z');
    const zoned = upload({ publishAt: '2026-10-20T13:00:00Z', timeZone: 'America/New_York', publicationIntent: true });
    expect(zoned.publishAt).toBe('2026-10-20T13:00:00.000Z');
  });

  it('preserves metadata that is not being changed', () => {
    const existing: YoutubeVideo = {
      id: 'abcdefghijk',
      snippet: { title: 'Old', description: 'Keep me', tags: ['one'], categoryId: '22', defaultLanguage: 'en', channelId: 'UC_AI' },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true, publishAt: '2026-10-20T13:00:00.000Z' },
    };
    const titleOnly = buildMetadataUpdate(existing, { title: 'New' });
    expect(titleOnly.part).toBe('snippet');
    expect(titleOnly.body).not.toHaveProperty('status');
    expect((titleOnly.body.snippet as { tags: string[]; description: string }).tags).toEqual(['one']);
    expect((titleOnly.body.snippet as { description: string }).description).toBe('Keep me');
    const declaration = buildMetadataUpdate(existing, { containsSyntheticMedia: false });
    expect(declaration.part).toBe('status');
    expect(declaration.body).not.toHaveProperty('snippet');
    const status = declaration.body.status as { privacyStatus: string; publishAt: string; containsSyntheticMedia: boolean; selfDeclaredMadeForKids: boolean };
    expect(status.privacyStatus).toBe('private');
    expect(status.publishAt).toBe('2026-10-20T13:00:00.000Z');
    expect(status.selfDeclaredMadeForKids).toBe(false);
    expect(status.containsSyntheticMedia).toBe(false);
  });

  it('keeps a public video ineligible for scheduling and reports forced-private results', () => {
    expect(scheduleBlockReason({ status: { privacyStatus: 'public', uploadStatus: 'processed' } })).toMatch(/already public/);
    expect(scheduleBlockReason({ status: { privacyStatus: 'private', uploadStatus: 'rejected' } })).toMatch(/rejected/);
    const video: YoutubeVideo = {
      id: 'abcdefghijk',
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, uploadStatus: 'processed' },
    };
    const scheduled = buildScheduleBody(video, '2026-10-20T13:00:00.000Z');
    expect((scheduled.body.status as { privacyStatus: string }).privacyStatus).toBe('private');
    const published = buildPublishBody(video, 'public');
    expect((published.body.status as { privacyStatus: string; selfDeclaredMadeForKids: boolean }).selfDeclaredMadeForKids).toBe(false);
    expect(published.body.status).not.toHaveProperty('publishAt');
    const report = visibilityReport('public', 'private');
    expect(report.matchesRequest).toBe(false);
    expect(report.restriction).toMatch(/compliance audit/);
  });

  it('does not treat uploaded or rejected videos as processed', () => {
    expect(interpretVideo({ status: { uploadStatus: 'uploaded' } }).state).toBe('uploaded');
    expect(interpretVideo({ status: { uploadStatus: 'rejected', rejectionReason: 'claim' } }).state).toBe('rejected');
    expect(interpretVideo({ processingDetails: { processingStatus: 'failed', processingFailureReason: 'transcodeFailed' } }).state).toBe('failed');
    expect(interpretVideo({ status: { uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' } }).state).toBe('processed');
    const job = sampleJob();
    const verified = applyVerifiedVideo(job, {
      id: 'abcdefghijk',
      status: { uploadStatus: 'uploaded', privacyStatus: 'private' },
      processingDetails: { processingStatus: 'processing' },
    });
    expect(verified.status).toBe('processing');
    expect(toPublicJob(verified).processingVerified).toBe(false);
    const hidden = toPublicJob({ ...job, resumableSessionEnc: 'ya29.SECRET', errorCode: 'transient', errorMessage: 'Bearer ya29.SECRET failed' });
    expect(JSON.stringify(hidden)).not.toContain('ya29');
    expect(JSON.stringify(hidden)).not.toContain('resumableSession');
    expect(redactSecrets('upload_id=abc Bearer ya29.SECRET')).not.toContain('ya29');
  });
});

describe('upload jobs', () => {
  const connection: ConnectionRecord = {
    id: 'conn_ai_channel',
    userEmail: 'ebay-user-1',
    channelId: 'UC_AI',
    channelTitle: 'AI channel',
    status: 'connected',
    statusDetail: null,
  };
  const asset: AssetRecord = {
    id: 'ma_1234567890abcdef12345678',
    userEmail: 'ebay-user-1',
    kind: 'video',
    status: 'ready',
    byteSize: 100,
    expiresAt: null,
  };

  function input(overrides: Record<string, unknown> = {}) {
    return { accountId: 'ebay-user-1', idempotencyKey: 'upload-key-1', ...baseUpload, ...overrides };
  }

  it('reuses one job for the same idempotency key and blocks a different payload', async () => {
    const jobs = new Map<string, UploadJobState>();
    let inserts = 0;
    const repo: UploadRepo = {
      async findConnection(accountId, connectionId) {
        return accountId === connection.userEmail && connectionId === connection.id ? connection : null;
      },
      async findAsset(accountId, assetId) {
        return accountId === asset.userEmail && assetId === asset.id ? asset : null;
      },
      async findJobByKey(_accountId, key) {
        return jobs.get(key) ?? null;
      },
      async insertJob(job) {
        inserts += 1;
        if (jobs.has(job.idempotencyKey)) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        jobs.set(job.idempotencyKey, job);
      },
    };
    const [first, second] = await Promise.all([
      enqueueWithRepo(repo, input()),
      enqueueWithRepo(repo, input()),
    ]);
    expect(first.id).toBe(second.id);
    expect(jobs.size).toBe(1);
    const insertsAfterRace = inserts;
    await expect(enqueueWithRepo(repo, input({ title: 'Different title' }))).rejects.toThrow(/different upload/);
    expect(inserts).toBe(insertsAfterRace);
    // Local file expiry must never create a duplicate or hide an existing job.
    const expiredRepo = { ...repo, findAsset: async () => ({ ...asset, status: 'expired' }) };
    expect((await enqueueWithRepo(expiredRepo, input())).id).toBe(first.id);
    await expect(enqueueWithRepo(expiredRepo, input({ idempotencyKey: 'new-key-expired' }))).rejects.toThrow(/not ready/);
    expect(inserts).toBe(insertsAfterRace);
    await expect(enqueueWithRepo(repo, input({ accountId: 'someone-else' }))).rejects.toThrow(/belongs to this account/);
    const reconnecting = { ...connection, status: 'reconnect_required', statusDetail: 'Reconnect this YouTube channel in LotLister settings.' };
    await expect(enqueueWithRepo({ ...repo, findConnection: async () => reconnecting }, input({ idempotencyKey: 'upload-key-2' }))).rejects.toThrow(/Reconnect/);
  });

  it('reconciles an uncertain final chunk instead of starting another upload', async () => {
    const starts: string[] = [];
    const persisted: boolean[] = [];
    const io = fakeIo({
      startSession: async (_token, job) => {
        starts.push(job.metadata.privacyStatus);
        return 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=1';
      },
      uploadChunk: async () => {
        throw new Error('socket hang up');
      },
      querySession: async () => ({
        type: 'complete',
        videoId: 'abcdefghijk',
        video: processedVideo('private'),
      }),
      persist: async (job) => {
        persisted.push(job.completionUncertain);
      },
    });
    const result = await advanceUpload(sampleJob(), io);
    expect(starts).toEqual(['private']);
    expect(persisted).toContain(true);
    expect(result.status).toBe('processed');
    expect(result.youtubeVideoId).toBe('abcdefghijk');
    expect(result.actualVisibility).toBe('private');
    expect(toPublicJob(result).processingVerified).toBe(true);
  });

  it('holds the job when a finished session disappears', async () => {
    let started = 0;
    const io = fakeIo({
      startSession: async () => {
        started += 1;
        return 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=new';
      },
      querySession: async () => ({ type: 'expired' }),
    });
    const result = await advanceUpload({
      ...sampleJob(),
      resumableSessionEnc: 'enc:https://www.googleapis.com/upload/youtube/v3/videos?upload_id=old',
      completionUncertain: true,
      bytesAcked: 100,
      status: 'uploading',
    }, io);
    expect(started).toBe(0);
    expect(result.status).toBe('uncertain');
    expect(result.errorCode).toBe('ambiguous_completion');
    expect(decideResume({ completionUncertain: false, bytesAcked: 0, byteSize: 100 }, { type: 'expired' }).action).toBe('restart');
  });

  it('records a privacy restriction instead of claiming the video is public', async () => {
    const io = fakeIo({
      startSession: async () => 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=1',
      uploadChunk: async () => ({ type: 'complete', videoId: 'abcdefghijk', video: processedVideo('private') }),
    });
    const job = sampleJob();
    job.metadata = { ...job.metadata, privacyStatus: 'public', publicationIntent: true };
    job.requestedVisibility = 'public';
    job.publicationIntent = true;
    const result = await advanceUpload(job, io);
    const view = toPublicJob(result);
    expect(result.status).toBe('processed');
    expect(view.visibilityMatchesRequest).toBe(false);
    expect(view.actualVisibility).toBe('private');
    expect(String(view.restriction)).toMatch(/private/);
  });

  it('marks rejected and failed processing without calling them processed', async () => {
    const rejectedVideo: YoutubeVideo = {
      id: 'abcdefghijk',
      snippet: { channelId: 'UC_AI' },
      status: { uploadStatus: 'rejected', rejectionReason: 'claim', privacyStatus: 'private' },
    };
    const rejected = await advanceUpload(sampleJob(), fakeIo({
      startSession: async () => 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=1',
      uploadChunk: async () => ({ type: 'complete', video: rejectedVideo }),
      getVideo: async () => rejectedVideo,
    }));
    expect(rejected.status).toBe('rejected');
    expect(toPublicJob(rejected).processingVerified).toBe(false);
    const failed = applyVerifiedVideo(sampleJob(), {
      id: 'abcdefghijk',
      status: { uploadStatus: 'uploaded', privacyStatus: 'private' },
      processingDetails: { processingStatus: 'failed', processingFailureReason: 'transcodeFailed' },
    });
    expect(failed.status).toBe('failed');
    expect(toPublicJob(failed).videoAccepted).toBe(true);
    expect(toPublicJob(failed).processingVerified).toBe(false);
  });
});


function processedVideo(privacy: string): YoutubeVideo {
  return {
    id: 'abcdefghijk',
    snippet: { channelId: 'UC_AI', title: 'Shop update', categoryId: '22' },
    status: { uploadStatus: 'processed', privacyStatus: privacy },
    processingDetails: { processingStatus: 'succeeded' },
  };
}

function sampleJob(): UploadJobState {
  const metadata = upload();
  return {
    id: 'yt_job_1234567890abcd',
    userEmail: 'ebay-user-1',
    connectionId: 'conn_ai_channel',
    channelId: 'UC_AI',
    channelTitle: 'AI channel',
    idempotencyKey: 'upload-key-1',
    requestHash: metadata.requestHash,
    mediaAssetId: 'ma_1234567890abcdef12345678',
    thumbnailAssetId: null,
    status: 'queued',
    progressBytes: 0,
    byteSize: 100,
    bytesAcked: 0,
    attemptCount: 0,
    completionUncertain: false,
    nextAttemptAt: null,
    resumableSessionEnc: null,
    youtubeVideoId: null,
    requestedVisibility: 'private',
    publicationIntent: false,
    publishAt: null,
    metadata,
    actualVisibility: null,
    restriction: null,
    errorCode: null,
    errorMessage: null,
    thumbnailError: null,
    thumbnailStatus: null,
  };
}

function fakeIo(overrides: Partial<UploadIo>): UploadIo {
  const io: UploadIo = {
    now: () => NOW.getTime(),
    deadline: () => NOW.getTime() + 60_000,
    persist: async () => undefined,
    loadAsset: async () => ({
      id: 'ma_1234567890abcdef12345678',
      userEmail: 'ebay-user-1',
      kind: 'video',
      status: 'ready',
      storagePath: 'youtube/test/file.bin',
      byteSize: 100,
      contentType: 'video/mp4',
      sourceUrl: null,
      expiresAt: null,
      errorMessage: null,
    }),
    markAssetReady: async () => undefined,
    markAssetFailed: async () => undefined,
    downloadAsset: async () => ({ byteSize: 100, contentType: 'video/mp4' }),
    accessToken: async () => 'access-token',
    readSlice: async (_asset, _start, length) => Buffer.alloc(length),
    startSession: async () => 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=1',
    querySession: async () => ({ type: 'incomplete', acked: 0 }),
    uploadChunk: async () => ({ type: 'complete', video: processedVideo('private') }),
    getVideo: async () => processedVideo('private'),
    setThumbnail: async () => undefined,
    readFile: async () => Buffer.alloc(0),
    encrypt: (value) => `enc:${value}`,
    decrypt: (value) => value.replace(/^enc:/, ''),
  };
  return { ...io, ...overrides };
}
