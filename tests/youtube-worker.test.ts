import { afterEach, describe, expect, it, vi } from 'vitest';
import { createYoutubeWorker } from '../lib/youtube/worker';

afterEach(() => vi.useRealTimers());

describe('persistent YouTube worker', () => {
  it('keeps draining after the initiating request and recovers from a failed tick', async () => {
    vi.useFakeTimers();
    const drain = vi.fn().mockRejectedValueOnce(new Error('database temporarily down')).mockResolvedValue({ processed: 1 });
    const error = vi.fn();
    const worker = createYoutubeWorker(drain, error);
    worker.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(drain).toHaveBeenCalledTimes(3);
    worker.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(drain).toHaveBeenCalledTimes(3);
  });

  it('coalesces wakes without overlapping drains and retains a wake during work', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const drain = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const worker = createYoutubeWorker(drain, vi.fn());
    worker.wake();
    await vi.advanceTimersByTimeAsync(0);
    worker.wake();
    worker.wake();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(drain).toHaveBeenCalledOnce();
    finish();
    await vi.advanceTimersByTimeAsync(1);
    expect(drain).toHaveBeenCalledTimes(2);
    worker.stop();
  });
});
