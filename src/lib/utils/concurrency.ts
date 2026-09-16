/** Clamps a requested fan-out to at least one worker, tolerating NaN and fractions. */
export function normalizeConcurrencyLimit(concurrencyLimit: number): number {
  if (!Number.isFinite(concurrencyLimit) || concurrencyLimit < 1) {
    return 1;
  }

  return Math.max(1, Math.floor(concurrencyLimit));
}

/**
 * Runs `worker` over `items` with at most `concurrencyLimit` in flight, preserving input
 * order in `results`. `maxObservedInFlight` is reported so runs can prove the cap held.
 */
export async function mapWithBoundedConcurrency<T, R>(
  items: T[],
  concurrencyLimit: number,
  worker: (item: T, index: number) => Promise<R> | R,
): Promise<{ results: R[]; maxObservedInFlight: number }> {
  const normalizedConcurrencyLimit = normalizeConcurrencyLimit(concurrencyLimit);
  const results: R[] = [];
  results.length = items.length;
  let nextIndex = 0;
  let inFlight = 0;
  let maxObservedInFlight = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index]!;

      inFlight += 1;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);

      try {
        results[index] = await worker(item, index);
      } finally {
        inFlight -= 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(normalizedConcurrencyLimit, items.length) }, () => runWorker()),
  );

  return { results, maxObservedInFlight };
}
