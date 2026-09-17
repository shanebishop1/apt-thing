/** Field readers for loosely typed provider payloads (RealtyAPI, Gemini, JSON-LD). */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Unwraps the common `{ data | result | listing: {...} }` provider envelopes. */
export function firstRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.data)) return value.data;
  if (isRecord(value.result)) return value.result;
  if (isRecord(value.listing)) return value.listing;
  return value;
}

/** First non-blank string (or finite number rendered as a string) among `names`. */
export function stringField(record: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/** First finite number among `names`, tolerating currency-formatted strings. */
export function numberField(record: Record<string, unknown>, names: string[]): number | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[$,]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

/** First array among `names`, narrowed to its string entries. */
export function stringArrayField(
  record: Record<string, unknown>,
  names: string[],
): string[] | undefined {
  for (const name of names) {
    const value = record[name];
    if (Array.isArray(value))
      return value.filter((item): item is string => typeof item === "string");
  }
  return undefined;
}

/** `T` with every already-optional property also accepting an explicit `undefined`. */
export type WithUndefined<T> = {
  [K in keyof T]: undefined extends T[K] ? T[K] | undefined : T[K];
};

/**
 * Drops keys whose value is `undefined` so the literal satisfies `T` under
 * `exactOptionalPropertyTypes`: a field that is conceptually absent stays absent
 * instead of being written as an explicit `undefined`. Pass `T` explicitly so the
 * literal is checked (and its string literals narrowed) against the target type.
 */
export function withDefined<T extends object>(value: WithUndefined<T>): T {
  const defined: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) defined[key] = entry;
  }
  // Removing the undefined-valued keys is exactly what turns WithUndefined<T> back
  // into T; TypeScript cannot follow that through Object.entries, so the one
  // assertion lives here instead of at every call site.
  return defined as T;
}
