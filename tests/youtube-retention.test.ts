import { afterEach, describe, expect, it, vi } from 'vitest';
import { YoutubeUserError } from '../lib/youtube/types';
import { retentionDecision, UPLOAD_RETENTION_MS } from '../lib/youtube/retention';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  token: vi.fn(),
  getVideo: vi.fn(),
  deleteVideo: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ default: { youtubeUploadJob: { findMany: mocks.findMany, update: mocks.update } } }));
vi.mock('../lib/youtube/connections', () => ({ getValidAccessToken: mocks.token }));
vi.mock('../lib/youtube/api', () => ({ getVideo: mocks.getVideo, deleteVideo: mocks.deleteVideo }));

import { expireLotListerUploads } from '../lib/youtube/retention';

const week = UPLOAD_RETENTION_MS;
const now = new Date('2026-10-20T12:00:00.000Z');

afterEach(() => {
  vi.clearAllMocks();
});

describe('LotLister upload retention', () => {
  it('keeps a video until seven days after YouTube accepted it', () => {
    const uploadedAt = new Date(now.getTime() - week + 1);
    expect(retentionDecision({ youtubeVideoId: 'abc', uploadedAt, status: 'processed' }, now)).toBe('keep');
    expect(retentionDecision({ youtubeVideoId: 'abc', uploadedAt: new Date(now.getTime() - week), status: 'processed' }, now)).toBe('delete');
    expect(retentionDecision({ youtubeVideoId: null, uploadedAt: new Date(0), status: 'processed' }, now)).toBe('keep');
    expect(retentionDecision({ youtubeVideoId: 'abc', uploadedAt: new Date(0), status: 'deleted' }, now)).toBe('keep');
  });

  it('deletes a due LotLister upload after YouTube confirms it is gone', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'job1', userEmail: 'seller', connectionId: 'conn', channelId: 'channel', youtubeVideoId: 'video1' }]);
    mocks.token.mockResolvedValue('token');
    mocks.getVideo
      .mockResolvedValueOnce({ id: 'video1', snippet: { channelId: 'channel' } })
      .mockRejectedValueOnce(new YoutubeUserError('not_found', 'gone'));
    mocks.deleteVideo.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue({});
    const result = await expireLotListerUploads(now);
    expect(result.deleted).toEqual(['video1']);
    expect(mocks.deleteVideo).toHaveBeenCalledWith('token', 'video1');
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job1' },
      data: expect.objectContaining({ status: 'deleted' }),
    }));
  });

  it('does not delete a video that belongs to another channel', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'job1', userEmail: 'seller', connectionId: 'conn', channelId: 'channel', youtubeVideoId: 'video1' }]);
    mocks.token.mockResolvedValue('token');
    mocks.getVideo.mockResolvedValue({ id: 'video1', snippet: { channelId: 'someone-else' } });
    mocks.update.mockResolvedValue({});
    const result = await expireLotListerUploads(now);
    expect(result.deleted).toEqual([]);
    expect(mocks.deleteVideo).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ errorCode: 'retention_blocked' }),
    }));
  });
});
