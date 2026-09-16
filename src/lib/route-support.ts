import { NextResponse } from "next/server";
import type { D1DatabaseLike } from "./shared-listing-store";

/**
 * Shared plumbing for `app/api/**` route handlers: Cloudflare env access, request body
 * parsing, and the small set of error responses every route returns the same way.
 */

/** Returns the Cloudflare env for the current request, or undefined outside the Workers runtime. */
export async function readCloudflareEnv<T>(): Promise<T | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return context?.env as T | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a server-only secret from the Cloudflare binding, falling back to `process.env`
 * for local `next dev`/test runs where the binding is absent.
 */
export function readServerSecret(
  env: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = env?.[name];
  return typeof value === "string" ? value : process.env[name];
}

/** Parses a JSON request body, returning `{}` for invalid, missing, or non-object payloads. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function isD1Database(value: unknown): value is D1DatabaseLike {
  return Boolean(value && typeof value === "object" && "prepare" in value);
}

/** The stable `{ ok: false, error }` envelope every route uses for failures. */
export function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export function d1BindingMissingResponse() {
  return jsonError(503, "d1-binding-missing");
}
