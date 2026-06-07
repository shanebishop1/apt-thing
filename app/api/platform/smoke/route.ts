import { NextResponse } from "next/server";

type BindingState = "bound" | "missing";
type ContextStatus = "available" | "unavailable";
type PlatformSmokeEnv = Partial<
  Record<"APP_ENV" | "DB" | "RAW_ARTIFACTS" | "APP_CACHE" | "ASSETS", unknown>
>;

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
      rawArtifacts: bindingState(env?.RAW_ARTIFACTS),
      appCache: bindingState(env?.APP_CACHE),
      assets: bindingState(env?.ASSETS),
    },
  };
}

async function getPlatformSmokeEnv(): Promise<PlatformSmokeEnv | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });

    return context?.env as PlatformSmokeEnv | undefined;
  } catch {
    return undefined;
  }
}

export async function GET() {
  const env = await getPlatformSmokeEnv();

  return NextResponse.json(buildPlatformSmokePayload(env));
}
