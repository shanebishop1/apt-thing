import { NextRequest, NextResponse } from "next/server";
import { authorizeGroupRequest } from "@/lib/api-auth";
import { readPersistedRunHistory } from "@/lib/run-history-store";
import type { D1DatabaseLike } from "@/lib/shared-listing-store";

type AppRouteEnv = Partial<Record<"DB", unknown>>;

export async function GET(request: NextRequest) {
  const auth = await authorizeGroupRequest(request, { displayName: "Run History API" });
  if (!auth.ok) return auth.response;

  const env = await getAppRouteEnv();
  if (!isD1Database(env?.DB)) {
    return NextResponse.json({ ok: false, error: "d1-binding-missing" }, { status: 503 });
  }

  try {
    const history = await readPersistedRunHistory(env.DB, auth.identity.groupId);
    return NextResponse.json({ ok: true, history });
  } catch {
    return NextResponse.json({ ok: false, error: "run-history-read-failed" }, { status: 500 });
  }
}

async function getAppRouteEnv(): Promise<AppRouteEnv | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return context?.env as AppRouteEnv | undefined;
  } catch {
    return undefined;
  }
}

function isD1Database(value: unknown): value is D1DatabaseLike {
  return Boolean(value && typeof value === "object" && "prepare" in value);
}
