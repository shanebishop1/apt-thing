import { NextRequest, NextResponse } from "next/server";
import { authorizeGroupRequest } from "@/lib/api-auth";
import {
  d1BindingMissingResponse,
  isD1Database,
  jsonError,
  readCloudflareEnv,
  readJsonObject,
  readServerSecret,
} from "@/lib/route-support";
import { createListingFromSharedApi } from "@/lib/shared-listing-api";
import { readSharedListingSnapshot } from "@/lib/shared-listing-store";

type AppRouteEnv = Partial<
  Record<"DB" | "GEMINI_API_KEY" | "REALTYAPI_KEY" | "REALTYAPI_BASE_URL", unknown>
>;

export async function GET(request: NextRequest) {
  const auth = await authorizeGroupRequest(request, { displayName: "Group Listings API" });
  if (!auth.ok) return auth.response;

  const env = await readCloudflareEnv<AppRouteEnv>();
  if (!isD1Database(env?.DB)) return d1BindingMissingResponse();

  // Group scope always comes from the authenticated identity, never from the query string.
  const snapshot = await readSharedListingSnapshot(env.DB, auth.identity.groupId);
  return NextResponse.json({ ok: true, snapshot });
}

export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  const auth = await authorizeGroupRequest(request, { body, displayName: "Group Listings API" });
  if (!auth.ok) return auth.response;

  const env = await readCloudflareEnv<AppRouteEnv>();
  if (!isD1Database(env?.DB)) return d1BindingMissingResponse();
  const identity = auth.identity;
  const rawUrl = typeof body.url === "string" ? body.url : "";

  try {
    const result = await createListingFromSharedApi({
      db: env.DB,
      rawUrl,
      identity,
      env: {
        GEMINI_API_KEY: readServerSecret(env, "GEMINI_API_KEY"),
        REALTYAPI_KEY: readServerSecret(env, "REALTYAPI_KEY"),
        REALTYAPI_BASE_URL: readServerSecret(env, "REALTYAPI_BASE_URL"),
      },
    });
    const snapshot = await readSharedListingSnapshot(env.DB, identity.groupId);
    return NextResponse.json({ ok: true, result, snapshot });
  } catch (error) {
    // normalizeUrl throws a TypeError carrying user-readable URL feedback; everything else
    // (D1, provider, or programmer errors) collapses to a stable code instead of leaking details.
    if (error instanceof TypeError) return jsonError(400, error.message);
    return jsonError(500, "create-listing-failed");
  }
}
