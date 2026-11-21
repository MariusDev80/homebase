/**
 * Runs fn on every item with at most `limit` calls in flight; results keep input order
 * (allSettled semantics: a rejection never stops the others).
 */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index]) };
      } catch (reason: unknown) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  const workers = Math.min(
    Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1,
    items.length,
  );
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
