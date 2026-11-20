import { mapLimited } from './map-limited';

describe('mapLimited', () => {
  it('never runs more than `limit` calls at once and keeps the input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 30 }, (_, i) => i);
    const results = await mapLimited(items, 8, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Later items finish first, to prove that the order is the input order.
      await new Promise((resolve) => setTimeout(resolve, 30 - n));
      inFlight--;
      return n * 2;
    });
    expect(peak).toBe(8);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual(
      items.map((n) => n * 2),
    );
  });

  it('settles every item even when some reject', async () => {
    const results = await mapLimited([1, 2, 3], 2, (n) =>
      n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(n),
    );
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect((results[1] as PromiseRejectedResult).reason).toEqual(new Error('boom'));
  });

  it('turns a synchronous throw into a rejection and handles an empty list', async () => {
    const results = await mapLimited([1], 4, () => {
      throw new Error('sync');
    });
    expect(results[0].status).toBe('rejected');
    expect(await mapLimited([], 8, () => Promise.resolve(1))).toEqual([]);
  });
});
