import { NextRequest, NextResponse } from "next/server";
import { requireGroupCode } from "@/lib/api-auth";
import { runG2BPlatformProof, type PlatformProofEnv } from "@/lib/platform-proof";

type PlatformProofRouteEnv = PlatformProofEnv & Partial<Record<"GEMINI_API_KEY", string>>;

async function getPlatformProofEnv(): Promise<PlatformProofRouteEnv | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });

    return context?.env as PlatformProofRouteEnv | undefined;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  const auth = requireGroupCode(request, undefined, "Platform Proof API");
  if (!auth.ok) return auth.response;

  const env = await getPlatformProofEnv();
  const geminiApiKey = env?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  const proof = await runG2BPlatformProof({ env, geminiApiKey });

  return NextResponse.json({
    ok: proof.ok,
    runtime: "cloudflare-workers",
    route: "/api/platform/proof",
    proof,
  });
}
