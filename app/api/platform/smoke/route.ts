import { NextRequest, NextResponse } from "next/server";
import { authorizeGroupRequest } from "@/lib/api-auth";
import { readCloudflareEnv } from "@/lib/route-support";

type BindingState = "bound" | "missing";
type ContextStatus = "available" | "unavailable";
type PlatformSmokeEnv = Partial<Record<"APP_ENV" | "DB" | "APP_CACHE" | "ASSETS", unknown>>;

function bindingState(value: unknown): BindingState {
  return value ? "bound" : "missing";
}

export function buildPlatformSmokePayload(
  env?: PlatformSmokeEnv,
  contextStatus: ContextStatus = env ? "available" : "unavailable",
) {
  return {
    ok: true,
    runtime: "cloudflare-workers",
    contextStatus,
    appEnv: typeof env?.APP_ENV === "string" ? env.APP_ENV : "unknown",
    bindings: {
      db: bindingState(env?.DB),
      appCache: bindingState(env?.APP_CACHE),
      assets: bindingState(env?.ASSETS),
    },
    rawArtifacts: {
      storage: "disabled",
      reason: "R2 not used in near-term MVP; source image URLs and evidence metadata stay in D1.",
    },
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorizeGroupRequest(request, { displayName: "Platform Smoke API" });
  if (!auth.ok) return auth.response;

  const env = await readCloudflareEnv<PlatformSmokeEnv>();

  return NextResponse.json(buildPlatformSmokePayload(env));
}
