import { afterEach, describe, expect, it, vi } from 'vitest';
import { listChannelVideos } from '../lib/youtube/api';
import { assertCleanupTarget, deleteOutsideTopFive, rankVideos } from '../lib/youtube/cleanup';

const connectionMock = vi.hoisted(() => ({ requireOwnedConnection: vi.fn(), getValidAccessToken: vi.fn() }));
vi.mock('../lib/youtube/connections', () => connectionMock);
const channel = 'UCEMhx0sbB4cfuIYxaWHXhrw';
const video = (id: string, views: string, visibility = 'public') => ({ id, snippet: { title: id, channelId: channel }, statistics: { viewCount: views }, status: { privacyStatus: visibility } });
const videos = Array.from({ length: 6 }, (_, i) => video(`video${i + 1}`, `${600 - 100 * i}`, i === 0 ? 'unlisted' : 'public'));
const keepers = videos.slice(0, 5).map(v => v.id);
const args = { connectionId: 'conn_test', expectedChannelId: channel, videoId: 'video6', expectedTitle: 'video6', protectedVideoIds: keepers, deletionIntent: true as const };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('complete channel inventory', () => {
  it('paginates uploads, deduplicates IDs and retains private/unlisted videos', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ items: [{ id: channel, contentDetails: { relatedPlaylists: { uploads: 'uploads_test' } } }] }))
      .mockResolvedValueOnce(json({ items: [{ contentDetails: { videoId: 'video1' } }], nextPageToken: 'page2' }))
      .mockResolvedValueOnce(json({ items: [{ contentDetails: { videoId: 'video1' } }, { contentDetails: { videoId: 'video2' } }] }))
      .mockResolvedValueOnce(json({ items: [video('video1', '8', 'private'), video('video2', '9', 'unlisted')] }));
    vi.stubGlobal('fetch', fetch);
    const result = await listChannelVideos('test-token', channel);
    expect(result.map(v => v.status?.privacyStatus)).toEqual(['private', 'unlisted']);
    expect(fetch.mock.calls[2][0]).toContain('pageToken=page2');
    expect(fetch.mock.calls[3][0]).toContain('statistics');
  });
  it('rejects missing video details rather than selecting an incomplete top five', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ items: [{ id: channel, contentDetails: { relatedPlaylists: { uploads: 'uploads_test' } } }] }))
      .mockResolvedValueOnce(json({ items: [{ contentDetails: { videoId: 'video1' } }] }))
      .mockResolvedValueOnce(json({ items: [] })));
    await expect(listChannelVideos('test-token', channel)).rejects.toMatchObject({ code: 'incomplete_inventory' });
  });
  it('rejects another authorized channel before reading uploads', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ items: [{ id: 'other', contentDetails: { relatedPlaylists: { uploads: 'wrong' } } }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(listChannelVideos('test-token', channel)).rejects.toMatchObject({ code: 'channel_mismatch' });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('keeper protection', () => {
  it('ranks across visibility without losing precision on large counts', () => {
    expect(rankVideos([video('a', '9007199254740992'), video('b', '9007199254740993')]).map(v => v.id)).toEqual(['b', 'a']);
    expect(rankVideos(videos)[0].id).toBe('video1');
  });
  it('does not treat missing views as zero', () => {
    expect(() => rankVideos([{ id: 'missing' }])).toThrow(/reported lifetime view count/);
  });
  it('protects every top-five ID and refuses a stale protected set', () => {
    for (const id of keepers) expect(() => assertCleanupTarget(videos, id, id, keepers)).toThrow(/protected top five/);
    expect(() => assertCleanupTarget(videos, 'video6', 'video6', [...keepers.slice(1), 'video6'])).toThrow(/top five differ/);
  });
  it('checks the exact target and accepts only a nonkeeper', () => {
    expect(() => assertCleanupTarget(videos, 'video6', 'wrong title', keepers)).toThrow(/exact title/);
    expect(assertCleanupTarget(videos, 'video6', 'video6', keepers).id).toBe('video6');
  });
  it('cannot delete while the channel gate is disabled, even with intent', async () => {
    vi.stubEnv('YOUTUBE_CLEANUP_CHANNEL_IDS', '');
    await expect(deleteOutsideTopFive('owner', args)).rejects.toMatchObject({ code: 'deletion_disabled' });
    expect(connectionMock.requireOwnedConnection).not.toHaveBeenCalled();
  });
  it('refuses mismatched channel ownership before any remote request', async () => {
    vi.stubEnv('YOUTUBE_CLEANUP_CHANNEL_IDS', channel);
    connectionMock.requireOwnedConnection.mockResolvedValue({ channelId: 'another_channel', status: 'connected' });
    await expect(deleteOutsideTopFive('owner', args)).rejects.toThrow();
    expect(connectionMock.getValidAccessToken).not.toHaveBeenCalled();
  });
  it('checks current ranking, deletes exactly one target, and requires an absence readback', async () => {
    vi.stubEnv('YOUTUBE_CLEANUP_CHANNEL_IDS', channel);
    connectionMock.requireOwnedConnection.mockResolvedValue({ channelId: channel, status: 'connected' });
    connectionMock.getValidAccessToken.mockResolvedValue('test-token');
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ items: [{ id: channel, contentDetails: { relatedPlaylists: { uploads: 'uploads_test' } } }] }))
      .mockResolvedValueOnce(json({ items: videos.map(v => ({ contentDetails: { videoId: v.id } })) }))
      .mockResolvedValueOnce(json({ items: videos }))
      .mockResolvedValueOnce(json({ items: [videos[5]] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ items: [] }));
    vi.stubGlobal('fetch', fetch);
    await expect(deleteOutsideTopFive('owner', args)).resolves.toMatchObject({ deleted: true, videoId: 'video6' });
    const writes = fetch.mock.calls.filter(([, init]) => init.method === 'DELETE');
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('https://www.googleapis.com/youtube/v3/videos?id=video6');
  });
});
