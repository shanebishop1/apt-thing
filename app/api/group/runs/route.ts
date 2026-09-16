import { NextRequest, NextResponse } from "next/server";
import { authorizeGroupRequest } from "@/lib/api-auth";
import {
  d1BindingMissingResponse,
  isD1Database,
  jsonError,
  readCloudflareEnv,
} from "@/lib/route-support";
import { readPersistedRunHistory } from "@/lib/run-history-store";

type AppRouteEnv = Partial<Record<"DB", unknown>>;

export async function GET(request: NextRequest) {
  const auth = await authorizeGroupRequest(request, { displayName: "Run History API" });
  if (!auth.ok) return auth.response;

  const env = await readCloudflareEnv<AppRouteEnv>();
  if (!isD1Database(env?.DB)) return d1BindingMissingResponse();

  try {
    const history = await readPersistedRunHistory(env.DB, auth.identity.groupId);
    return NextResponse.json({ ok: true, history });
  } catch {
    return jsonError(500, "run-history-read-failed");
  }
}
