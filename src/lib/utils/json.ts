/** JSON parsing that never throws: callers fall back to their own defaults instead. */

export function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/** Reads a response body as JSON, returning undefined for empty or malformed payloads. */
export async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}
