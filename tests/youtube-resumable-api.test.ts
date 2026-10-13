import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVideo, probeOrUpload } from '../lib/youtube/api';

const sessionUri = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=test';
const token = 'test-only-token';
const input = { token, sessionUri, total: 1024 };

afterEach(() => vi.unstubAllGlobals());

describe('YouTube resumable HTTP responses', () => {
  it('accepts an empty-session 308 probe and retains manual redirect handling', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 308 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeOrUpload(input)).resolves.toEqual({ type: 'incomplete', acked: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(sessionUri);
    expect(init.method).toBe('PUT');
    expect(init.redirect).toBe('manual');
    expect(init.headers.get('Content-Range')).toBe('bytes */1024');
  });

  it('accepts a chunk acknowledgement and resumes at the first unreceived byte', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {
      status: 308, headers: { Range: 'bytes=0-511' },
    })));
    await expect(probeOrUpload({ ...input, start: 256, chunk: Buffer.alloc(256) }))
      .resolves.toEqual({ type: 'incomplete', acked: 512 });
  });

  it('recognizes the completed video response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'video-test' }), { status: 200 })));
    await expect(probeOrUpload(input)).resolves.toEqual({ type: 'complete', videoId: 'video-test', video: { id: 'video-test' } });
  });

  it.each([301, 302, 303, 307, 308])('rejects HTTP %i with a redirect destination without forwarding credentials', async status => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status, headers: { Location: 'https://other.example/upload' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeOrUpload(input)).rejects.toMatchObject({ code: 'upstream_redirect' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
  });

  it('does not allow 308 responses through ordinary Data API calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 308 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getVideo(token, 'video-test')).rejects.toMatchObject({ code: 'upstream_redirect' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
