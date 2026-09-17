import { validateBriefingRunHistoryContract, type AgentRunLogRecord } from "./agent-contracts";
import {
  createDailyLoopBriefing,
  createDailyLoopHistory,
  createDailyLoopObservability,
  createDailyLoopOperatorEvidence,
  createRawArtifactPointers,
} from "./daily-loop/briefing";
import {
  buildExistingStates,
  createDailyLoopSourceEvidence,
  createSeenMemory,
  toMaterialChangeUnit,
  toProviderFailureUnits,
  toSkippedUnit,
  toSuccessUnit,
  toTriageMetadata,
} from "./daily-loop/candidates";
import { createGeminiAnalyzerFromEnv } from "./daily-loop/gemini-analyzer";
import { stableId } from "./daily-loop/ids";
import { persistDailyLoopArtifacts, persistDailyLoopRunTransition } from "./daily-loop/persistence";
import {
  emptySecondaryZillowCoverage,
  runSecondaryZillowFixture,
  runStreetEasySource,
} from "./daily-loop/sources";
import {
  DAILY_LOOP_CONTRACT_VERSION,
  DAILY_LOOP_DEFAULT_CONCURRENCY,
  DAILY_LOOP_RETRY_POLICY,
  type DailyLoopMode,
  type DailyLoopPersistencePlan,
  type DailyLoopResult,
  type DailyLoopSkippedCandidate,
  type DailyLoopSourceCoverage,
  type RunDailySourceAgentLoopOptions,
} from "./daily-loop/types";
import { streetEasyBatchFixture } from "./fixtures";
import {
  createGroupIdentity,
  defaultSearchGroup,
  type AiProviderAttemptMetadata,
  type Cadence,
  type ListingCandidate,
  type RunStatus,
} from "./listings";
import { normalizeConcurrencyLimit } from "./utils/concurrency";
import { uniqueStrings } from "./utils/text";

export { createDailyLoopProviderFailureAnalyzer } from "./daily-loop/gemini-analyzer";
export type {
  DailyLoopEnv,
  DailyLoopMode,
  DailyLoopResult,
  DailyLoopTrigger,
  RunDailySourceAgentLoopOptions,
} from "./daily-loop/types";

/**
 * Public entry point for the daily source agent loop. Orchestration lives here; the cohesive
 * pieces it drives (sources, candidate bookkeeping, briefing/history, persistence, and the
 * Gemini analyzers) live in ./daily-loop.
 */
export async function runDailySourceAgentLoop(
  options: RunDailySourceAgentLoopOptions = {},
): Promise<DailyLoopResult> {
  const mode = options.mode ?? "fixture";
  const cadence = options.cadence ?? "manual";
  const trigger = options.trigger ?? (cadence === "daily" ? "cron" : "manual");
  const identity = options.identity ?? createGroupIdentity(defaultSearchGroup.id, "Daily Loop")!;
  const now = options.now ?? new Date().toISOString();
  const concurrencyLimit = normalizeConcurrencyLimit(
    options.concurrencyLimit ?? DAILY_LOOP_DEFAULT_CONCURRENCY,
  );
  const runId = stableId(`${identity.groupId}:daily-loop:${cadence}:${trigger}:${now}`);
  // Spread instead of assigned so an unset binding stays absent rather than explicitly undefined.
  const envOption = options.env !== undefined ? { env: options.env } : {};
  const fetchImplOption = options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {};
  const d1TransitionErrors = uniqueStrings(
    [
      await persistDailyLoopRunTransition({
        ...envOption,
        mode,
        runId,
        groupId: identity.groupId,
        cadence,
        trigger,
        status: "queued",
        boundedConcurrency: concurrencyLimit,
        startedAt: now,
      }),
      await persistDailyLoopRunTransition({
        ...envOption,
        mode,
        runId,
        groupId: identity.groupId,
        cadence,
        trigger,
        status: "running",
        boundedConcurrency: concurrencyLimit,
        startedAt: now,
      }),
    ].flatMap((error) => error ?? []),
  );
  const batch = options.streeteasyBatch ?? streetEasyBatchFixture;
  const preexistingStates = buildExistingStates({
    groupId: identity.groupId,
    batch,
    existingListings: options.existingListings ?? [],
    seenMemory: options.seenMemory ?? [],
    priorStates: options.priorStates ?? [],
  });
  const units: AgentRunLogRecord["units"] = [];
  const coverage: DailyLoopSourceCoverage[] = [];
  const skipped: DailyLoopSkippedCandidate[] = [];
  const materialChanges: DailyLoopSkippedCandidate[] = [];
  const listings: ListingCandidate[] = [];
  const providerMetadata: AiProviderAttemptMetadata[] = [];
  const analyzer = options.analyzer ?? createGeminiAnalyzerFromEnv(options.env, options.fetchImpl);
  let maxObservedInFlight = 0;

  const streetEasyResult = await runStreetEasySource({
    runId,
    identity,
    batch,
    mode,
    ...envOption,
    now,
    concurrencyLimit,
    existingStates: preexistingStates,
    ...(options.failStreetEasy !== undefined ? { fail: options.failStreetEasy } : {}),
    ...(analyzer !== undefined ? { analyzer } : {}),
    ...fetchImplOption,
  });
  coverage.push(streetEasyResult.coverage);
  if (streetEasyResult.status === "failed") {
    units.push(streetEasyResult.unit);
  } else {
    listings.push(...streetEasyResult.listings);
    skipped.push(...streetEasyResult.skipped);
    materialChanges.push(...streetEasyResult.skipped.filter((item) => item.materialChangeDetected));
    providerMetadata.push(...streetEasyResult.providerMetadata);
    maxObservedInFlight = Math.max(maxObservedInFlight, streetEasyResult.maxObservedInFlight);
    units.push(
      ...streetEasyResult.skipped.map((item) =>
        item.materialChangeDetected
          ? toMaterialChangeUnit(runId, item, now)
          : toSkippedUnit(runId, item, now),
      ),
      ...streetEasyResult.listings.map((listing) => toSuccessUnit(runId, listing, now)),
    );
  }

  const secondaryResult =
    mode === "live-safe"
      ? emptySecondaryZillowCoverage(now)
      : runSecondaryZillowFixture({
          runId,
          identity,
          now,
          concurrencyLimit,
          existingListings: [...(options.existingListings ?? []), ...listings],
          seenMemory: options.seenMemory ?? [],
          ...(options.failSecondary !== undefined ? { fail: options.failSecondary } : {}),
        });
  coverage.push(secondaryResult.coverage);
  if (secondaryResult.status === "failed") {
    units.push(secondaryResult.unit);
  } else {
    listings.push(...secondaryResult.listings);
    skipped.push(...secondaryResult.skipped);
    providerMetadata.push(...secondaryResult.providerMetadata);
    units.push(
      ...secondaryResult.skipped.map((item) => toSkippedUnit(runId, item, now)),
      ...secondaryResult.listings.map((listing) => toSuccessUnit(runId, listing, now)),
    );
  }
  units.push(...toProviderFailureUnits(runId, listings, providerMetadata, now));

  const sourceFailures = coverage.filter((item) => item.status === "failed").length;
  const status: RunStatus =
    sourceFailures === coverage.length ? "failed" : sourceFailures > 0 ? "partial" : "success";
  const triagedListings = listings.filter((listing) => listing.triageBucket !== "untriaged");
  const rejected = triagedListings.filter((listing) => listing.triageBucket === "rejected").length;
  // Rejected candidates stay in the run outputs (briefing, history, candidate rows) but are never
  // written to the group's shortlist, so the saved count only covers what the shortlist receives.
  const savedListings = listings.filter((listing) => listing.triageBucket !== "rejected");
  const runCounts: AgentRunLogRecord["counts"] = {
    candidatesFound: coverage.reduce((sum, item) => sum + item.checkedCount, 0),
    candidatesSkippedSeen: skipped.filter(
      (item) => !item.materialChangeDetected && item.reason === "seen",
    ).length,
    candidatesSkippedTriaged: skipped.filter(
      (item) => !item.materialChangeDetected && item.reason === "triaged",
    ).length,
    candidatesAnalyzed: triagedListings.length,
    candidatesSaved: savedListings.length,
    candidatesRejected: rejected,
    sourceFailures,
  };
  const runBase: AgentRunLogRecord = {
    id: runId,
    contract: "agent-run-log-v1",
    groupId: identity.groupId,
    cadence,
    trigger,
    status,
    startedAt: now,
    completedAt: new Date(Date.parse(now) + 1000).toISOString(),
    counts: runCounts,
    boundedConcurrency: concurrencyLimit,
    retryPolicy: DAILY_LOOP_RETRY_POLICY,
    units,
  };
  const rawArtifactPointers = createRawArtifactPointers(
    identity.groupId,
    runId,
    coverage,
    listings,
  );
  const operatorEvidence = createDailyLoopOperatorEvidence({
    run: runBase,
    mode,
    coverage,
    skipped,
    listings,
    providerMetadata,
    rawArtifactPointers,
  });
  const run: AgentRunLogRecord = { ...runBase, operatorEvidence };
  const observability = createDailyLoopObservability({
    sourceFailures,
    coverage,
    concurrencyLimit,
    maxObservedInFlight,
    operatorEvidence,
  });
  const sourceEvidence = createDailyLoopSourceEvidence({
    groupId: identity.groupId,
    runId,
    listings,
    coverage,
    rawArtifactPointers,
    now,
  });
  const triageMetadata = listings.map((listing) => toTriageMetadata(listing, now));
  const briefing = createDailyLoopBriefing({
    groupId: identity.groupId,
    run,
    listings,
    coverage,
    skipped,
    now,
  });
  const seenRejectedMemory = createSeenMemory(
    identity.groupId,
    listings,
    skipped.filter((item) => !item.materialChangeDetected),
    now,
  );
  const history = createDailyLoopHistory({
    groupId: identity.groupId,
    generatedAt: now,
    run,
    listings,
    sourceCoverage: coverage,
    sourceEvidence,
    triageMetadata,
    briefing,
    seenRejectedMemory,
    providerMetadata,
    rawArtifactPointers,
  });
  const historyErrors = validateBriefingRunHistoryContract(history);
  if (historyErrors.length > 0) {
    throw new Error(`Daily loop history contract invalid: ${historyErrors.join("; ")}`);
  }

  const persistenceBase = {
    contract: DAILY_LOOP_CONTRACT_VERSION,
    d1: {
      authoritativeTables: [
        "app_saved_listings",
        "listing_candidates",
        "daily_loop_runs",
        "daily_loop_sources",
        "daily_loop_candidates",
        "daily_loop_candidate_status",
        "daily_loop_seen_memory",
        "app_seen_rejected_memory",
        "daily_loop_briefings",
        "source_evidence_records",
        "agent_run_logs",
      ],
      records: {
        run,
        candidates: listings,
        sourceEvidence,
        triageMetadata,
        briefing,
        seenMemory: seenRejectedMemory,
      },
    },
    rawArtifacts: {
      storage: "disabled-no-r2",
      strategy: "source-image-urls-and-d1-metadata",
      rawArtifactPointers,
    },
    kv: { allowedOnlyFor: "cache-config", authoritative: false },
  } satisfies Omit<DailyLoopPersistencePlan, "outcome">;
  const persistence: DailyLoopPersistencePlan = {
    ...persistenceBase,
    outcome: await persistDailyLoopArtifacts({
      ...envOption,
      mode,
      run,
      coverage,
      listings,
      skipped,
      sourceEvidence,
      triageMetadata,
      briefing,
      history,
      seenRejectedMemory,
      rawArtifactPointers,
      observability,
      d1TransitionErrors,
    }),
  };

  return {
    contract: DAILY_LOOP_CONTRACT_VERSION,
    ok: status !== "failed",
    mode,
    run,
    sourceCoverage: coverage,
    skipped,
    materialChanges,
    listings,
    sourceEvidence,
    triageMetadata,
    briefing,
    history,
    persistence,
    observability,
    operatorEvidence,
  };
}

export function createDailyLoopCronPayload(cadence: Cadence = "daily") {
  return {
    contract: DAILY_LOOP_CONTRACT_VERSION,
    workflowCompatible: true,
    cronCompatible: true,
    cadence,
    supportedCadences: ["manual", "daily", "hourly"] satisfies Cadence[],
    defaultMode: "fixture" satisfies DailyLoopMode,
    scheduledRoute: "/api/platform/daily-loop?cadence=daily&trigger=cron",
    workflowHandler: "handleDailyLoopWorkflowPayload",
    workflowCaveat:
      "Dedicated Cloudflare Workflows class handles Cron dispatch; OpenNext route remains available for manual/debug payloads.",
  } as const;
}

export async function handleDailyLoopWorkflowPayload(
  payload: ReturnType<typeof createDailyLoopCronPayload>,
  options: RunDailySourceAgentLoopOptions = {},
): Promise<DailyLoopResult> {
  return runDailySourceAgentLoop({
    ...options,
    cadence: payload.cadence,
    trigger: "cron",
    mode: options.mode ?? payload.defaultMode,
  });
}
