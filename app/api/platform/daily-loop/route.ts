import { NextRequest, NextResponse } from "next/server";
import { authorizeGroupRequest } from "@/lib/api-auth";
import {
  createDailyLoopCronPayload,
  runDailySourceAgentLoop,
  type DailyLoopEnv,
  type DailyLoopMode,
  type DailyLoopTrigger,
} from "@/lib/daily-source-loop";
import { type Cadence } from "@/lib/listings";

type DailyLoopRouteEnv = DailyLoopEnv & Partial<Record<"APP_ENV", string>>;

async function getDailyLoopEnv(): Promise<DailyLoopRouteEnv | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });

    return context?.env as DailyLoopRouteEnv | undefined;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  const env = await getDailyLoopEnv();
  const searchParams = new URL(request.url).searchParams;
  const cadence = normalizeCadence(searchParams.get("cadence")) ?? "manual";
  const trigger =
    normalizeTrigger(searchParams.get("trigger")) ?? (cadence === "daily" ? "cron" : "manual");
  const requestedMode = normalizeMode(searchParams.get("mode"));
  const mode: DailyLoopMode = requestedMode ?? "fixture";
  const auth = await authorizeGroupRequest(request, { displayName: "Daily Loop API" });
  if (!auth.ok) return auth.response;

  const result = await runDailySourceAgentLoop({
    mode,
    cadence,
    trigger,
    identity: auth.identity,
    env: {
      GEMINI_API_KEY: env?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY,
      REALTYAPI_KEY: env?.REALTYAPI_KEY ?? process.env.REALTYAPI_KEY,
      REALTYAPI_BASE_URL: env?.REALTYAPI_BASE_URL ?? process.env.REALTYAPI_BASE_URL,
      DB: env?.DB,
      APP_CACHE: env?.APP_CACHE,
    },
  });

  return NextResponse.json({
    ok: result.ok,
    contract: result.contract,
    route: "/api/platform/daily-loop",
    cron: createDailyLoopCronPayload(cadence),
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

export async function POST(request: NextRequest) {
  const env = await getDailyLoopEnv();
  const searchParams = new URL(request.url).searchParams;
  const body = await readJson(request);
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
    failStreetEasy: body.failStreetEasy === true,
    failSecondary: body.failSecondary === true,
    env: {
      GEMINI_API_KEY: env?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY,
      REALTYAPI_KEY: env?.REALTYAPI_KEY ?? process.env.REALTYAPI_KEY,
      REALTYAPI_BASE_URL: env?.REALTYAPI_BASE_URL ?? process.env.REALTYAPI_BASE_URL,
      DB: env?.DB,
      APP_CACHE: env?.APP_CACHE,
    },
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

function normalizeCadence(value: unknown): Cadence | undefined {
  return value === "manual" || value === "daily" || value === "hourly" ? value : undefined;
}

function normalizeMode(value: unknown): DailyLoopMode | undefined {
  return value === "fixture" || value === "live-safe" ? value : undefined;
}

function normalizeTrigger(value: unknown): DailyLoopTrigger | undefined {
  return value === "manual" || value === "cron" || value === "fixture" ? value : undefined;
}
