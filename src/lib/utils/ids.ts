/**
 * Deterministic, dependency-free hash used to derive stable record ids. Ids must survive
 * re-runs of the same input (the daily loop re-inserts rows by id), so this is intentionally
 * a plain FNV-style rolling hash rather than a random or time-based value.
 */
export function stableHash(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hash = 0;
  for (const byte of bytes) hash = (hash * 31 + byte) >>> 0;
  return hash.toString(36);
}
