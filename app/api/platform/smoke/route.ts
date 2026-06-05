import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

export const runtime = "edge";

type BindingState = "bound" | "missing";

function bindingState(value: unknown): BindingState {
  return value ? "bound" : "missing";
}

export async function GET() {
  const context = await getCloudflareContext({ async: true });
  const env = context.env as Cloudflare.Env;

  return NextResponse.json({
    ok: true,
    runtime: "cloudflare-workers",
    appEnv: env.APP_ENV ?? "unknown",
    bindings: {
      db: bindingState(env.DB),
      rawArtifacts: bindingState(env.RAW_ARTIFACTS),
      appCache: bindingState(env.APP_CACHE),
      assets: bindingState(env.ASSETS),
    },
  });
}
