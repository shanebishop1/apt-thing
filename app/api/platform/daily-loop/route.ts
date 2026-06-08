import { NextRequest, NextResponse } from "next/server";
import {
  createDailyLoopCronPayload,
  runDailySourceAgentLoop,
  type DailyLoopEnv,
  type DailyLoopMode,
  type DailyLoopTrigger,
} from "@/lib/daily-source-loop";
import { createInviteIdentity, defaultSearchGroup, type Cadence } from "@/lib/listings";

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
  const searchParams = request.nextUrl.searchParams;
  const cadence = normalizeCadence(searchParams.get("cadence")) ?? "manual";
  const trigger =
    normalizeTrigger(searchParams.get("trigger")) ?? (cadence === "daily" ? "cron" : "manual");
  const requestedMode = normalizeMode(searchParams.get("mode"));
  const mode: DailyLoopMode = requestedMode ?? "fixture";
  const identity = createInviteIdentity(
    searchParams.get("inviteCode") ?? defaultSearchGroup.inviteCode,
    searchParams.get("displayName") ?? "Daily Loop API",
  );

  if (!identity) {
    return NextResponse.json({ ok: false, error: "invalid-invite-identity" }, { status: 400 });
  }

  const result = await runDailySourceAgentLoop({
    mode,
    cadence,
    trigger,
    identity,
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
  const body = await readJson(request);
  const cadence = normalizeCadence(body.cadence) ?? "manual";
  const trigger = normalizeTrigger(body.trigger) ?? "manual";
  const mode = normalizeMode(body.mode) ?? "fixture";
  const identity = createInviteIdentity(
    typeof body.inviteCode === "string" ? body.inviteCode : defaultSearchGroup.inviteCode,
    typeof body.displayName === "string" ? body.displayName : "Daily Loop API",
  );

  if (!identity) {
    return NextResponse.json({ ok: false, error: "invalid-invite-identity" }, { status: 400 });
  }

  const result = await runDailySourceAgentLoop({
    mode,
    cadence,
    trigger,
    identity,
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
