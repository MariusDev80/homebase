import { TestBed } from '@angular/core/testing';
import { PendingWrites } from './pending-writes';

describe('PendingWrites', () => {
  it('runs every registered flusher and waits for the slowest', async () => {
    const pending = TestBed.inject(PendingWrites);
    let release!: () => void;
    const slow = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const fast = vi.fn().mockResolvedValue(undefined);
    pending.register(slow);
    pending.register(fast);
    let done = false;
    const all = pending.flushAll().then(() => (done = true));
    await Promise.resolve();
    expect(fast).toHaveBeenCalledTimes(1);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    release();
    await all;
    expect(done).toBe(true);
  });

  it('a failing flusher never blocks the others nor rejects (allSettled)', async () => {
    const pending = TestBed.inject(PendingWrites);
    const ok = vi.fn().mockResolvedValue(undefined);
    pending.register(() => Promise.reject(new Error('boom')));
    pending.register(ok);
    await expect(pending.flushAll()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('does not call a flusher any more once it is unregistered', async () => {
    const pending = TestBed.inject(PendingWrites);
    const flush = vi.fn().mockResolvedValue(undefined);
    const unregister = pending.register(flush);
    expect(pending.count).toBe(1);
    unregister();
    expect(pending.count).toBe(0);
    await pending.flushAll();
    expect(flush).not.toHaveBeenCalled();
  });
});
