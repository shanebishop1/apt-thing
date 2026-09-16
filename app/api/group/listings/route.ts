import { NextRequest, NextResponse } from "next/server";
import { authorizeGroupRequest } from "@/lib/api-auth";
import { createListingFromSharedApi } from "@/lib/shared-listing-api";
import { readSharedListingSnapshot, type D1DatabaseLike } from "@/lib/shared-listing-store";

type AppRouteEnv = Partial<
  Record<"DB" | "GEMINI_API_KEY" | "REALTYAPI_KEY" | "REALTYAPI_BASE_URL", unknown>
>;

export async function GET(request: NextRequest) {
  const auth = await authorizeGroupRequest(request, { displayName: "Group Listings API" });
  if (!auth.ok) return auth.response;

  const env = await getAppRouteEnv();
  if (!isD1Database(env?.DB)) {
    return NextResponse.json({ ok: false, error: "d1-binding-missing" }, { status: 503 });
  }

  // Group scope always comes from the authenticated identity, never from the query string.
  const snapshot = await readSharedListingSnapshot(env.DB, auth.identity.groupId);
  return NextResponse.json({ ok: true, snapshot });
}

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const auth = await authorizeGroupRequest(request, { body, displayName: "Group Listings API" });
  if (!auth.ok) return auth.response;

  const env = await getAppRouteEnv();
  if (!isD1Database(env?.DB)) {
    return NextResponse.json({ ok: false, error: "d1-binding-missing" }, { status: 503 });
  }
  const identity = auth.identity;
  const rawUrl = typeof body.url === "string" ? body.url : "";

  try {
    const result = await createListingFromSharedApi({
      db: env.DB,
      rawUrl,
      identity,
      env: {
        GEMINI_API_KEY:
          typeof env.GEMINI_API_KEY === "string" ? env.GEMINI_API_KEY : process.env.GEMINI_API_KEY,
        REALTYAPI_KEY:
          typeof env.REALTYAPI_KEY === "string" ? env.REALTYAPI_KEY : process.env.REALTYAPI_KEY,
        REALTYAPI_BASE_URL:
          typeof env.REALTYAPI_BASE_URL === "string"
            ? env.REALTYAPI_BASE_URL
            : process.env.REALTYAPI_BASE_URL,
      },
    });
    const snapshot = await readSharedListingSnapshot(env.DB, identity.groupId);
    return NextResponse.json({ ok: true, result, snapshot });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "create-listing-failed" },
      { status: 400 },
    );
  }
}

async function getAppRouteEnv(): Promise<AppRouteEnv | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return context?.env as AppRouteEnv | undefined;
  } catch {
    return { GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  }
}

async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isD1Database(value: unknown): value is D1DatabaseLike {
  return Boolean(value && typeof value === "object" && "prepare" in value);
}
