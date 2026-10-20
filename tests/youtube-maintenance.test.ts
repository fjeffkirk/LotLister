import { describe, expect, it, vi } from 'vitest';
import { applyOperatorHolds } from '../lib/youtube/maintenance';

const target = { jobId: 'job_original', connectionId: 'conn_brain', channelId: 'brain', idempotencyKey: 'original_key' };
function setup() {
  return { read: vi.fn().mockResolvedValue({ ...target, userEmail: 'owner' }), hold: vi.fn().mockResolvedValue({ status: 'held' }), log: vi.fn() };
}

describe('deployment operator holds', () => {
  it('does nothing without explicit configuration', async () => {
    const io = setup();
    await applyOperatorHolds(undefined, io);
    expect(io.read).not.toHaveBeenCalled();
  });
  it('uses the stored account and safe hold without touching the replacement', async () => {
    const io = setup();
    await applyOperatorHolds(JSON.stringify([target]), io);
    expect(io.hold.mock.calls).toEqual([['owner', 'job_original']]);
    expect(io.log).toHaveBeenCalledWith('job_original');
  });
  it.each(['jobId', 'connectionId', 'channelId', 'idempotencyKey'])('refuses mismatched %s', async field => {
    const io = setup();
    io.read.mockResolvedValue({ ...target, userEmail: 'owner', [field]: 'wrong' });
    await expect(applyOperatorHolds(JSON.stringify([target]), io)).rejects.toThrow('identity mismatch');
    expect(io.hold).not.toHaveBeenCalled();
  });
  it('validates every target before holding any', async () => {
    const io = setup();
    io.read.mockResolvedValueOnce({ ...target, userEmail: 'owner' }).mockResolvedValueOnce(null);
    await expect(applyOperatorHolds(JSON.stringify([target, { ...target, jobId: 'missing' }]), io)).rejects.toThrow();
    expect(io.hold).not.toHaveBeenCalled();
  });
  it('fails closed if the normal safe hold refuses started work', async () => {
    const io = setup();
    io.hold.mockRejectedValue(new Error('job_started'));
    await expect(applyOperatorHolds(JSON.stringify([target]), io)).rejects.toThrow('job_started');
    expect(io.log).not.toHaveBeenCalled();
  });
  it('rejects malformed configuration without mutations', async () => {
    const io = setup();
    await expect(applyOperatorHolds('{invalid', io)).rejects.toThrow();
    await expect(applyOperatorHolds(JSON.stringify([{ ...target, sql: 'unsupported' }]), io)).rejects.toThrow();
    expect(io.hold).not.toHaveBeenCalled();
  });
});
