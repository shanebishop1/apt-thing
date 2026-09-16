import { NextRequest, NextResponse } from "next/server";
import { authorizeGroupRequest } from "@/lib/api-auth";
import {
  runDailySourceAgentLoop,
  type DailyLoopEnv,
  type DailyLoopMode,
  type DailyLoopTrigger,
} from "@/lib/daily-source-loop";
import { type Cadence } from "@/lib/listings";
import { readCloudflareEnv, readJsonObject, readServerSecret } from "@/lib/route-support";

type DailyLoopRouteEnv = DailyLoopEnv & Partial<Record<"APP_ENV", string>>;

export async function POST(request: NextRequest) {
  const env = await readCloudflareEnv<DailyLoopRouteEnv>();
  const searchParams = new URL(request.url).searchParams;
  const body = await readJsonObject(request);
  const cadence =
    normalizeCadence(searchParams.get("cadence")) ?? normalizeCadence(body.cadence) ?? "manual";
  const trigger =
    normalizeTrigger(searchParams.get("trigger")) ?? normalizeTrigger(body.trigger) ?? "manual";
  const mode = normalizeMode(searchParams.get("mode")) ?? normalizeMode(body.mode) ?? "fixture";
  const auth = await authorizeGroupRequest(request, { body, displayName: "Daily Loop API" });
  if (!auth.ok) return auth.response;

  const result = await runDailySourceAgentLoop({
    mode,
    cadence,
    trigger,
    identity: auth.identity,
    env: dailyLoopEnv(env),
  });

  return NextResponse.json({
    ok: result.ok,
    contract: result.contract,
    route: "/api/platform/daily-loop",
    run: result.run,
    sourceCoverage: result.sourceCoverage,
    briefing: result.briefing,
    observability: result.observability,
    operatorEvidence: result.operatorEvidence,
    persistence: result.persistence.outcome,
    historyContract: result.history.contract,
    history: result.history,
  });
}

function dailyLoopEnv(env: DailyLoopRouteEnv | undefined): DailyLoopEnv {
  return {
    GEMINI_API_KEY: readServerSecret(env, "GEMINI_API_KEY"),
    REALTYAPI_KEY: readServerSecret(env, "REALTYAPI_KEY"),
    REALTYAPI_BASE_URL: readServerSecret(env, "REALTYAPI_BASE_URL"),
    DB: env?.DB,
    APP_CACHE: env?.APP_CACHE,
  };
}

function normalizeCadence(value: unknown): Cadence | undefined {
  return value === "manual" || value === "daily" || value === "hourly" ? value : undefined;
}

function normalizeMode(value: unknown): DailyLoopMode | undefined {
  return value === "fixture" || value === "live-safe" ? value : undefined;
}

function normalizeTrigger(value: unknown): DailyLoopTrigger | undefined {
  return value === "manual" || value === "cron" || value === "fixture" ? value : undefined;
}
