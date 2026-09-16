import {
  type AgentRunLogRecord,
  type AgentRunOperatorEvidence,
  type BriefingCandidateSummary,
  type BriefingRecord,
  type BriefingRunHistoryContract,
  type BriefingRunHistoryRun,
  type ConfidenceScore,
  type ConfidenceTriageMetadata,
  type EvidenceStoragePointer,
  type SeenRejectedMemoryRecord,
  type SourceCoverageSummary,
  type SourceEvidenceRecord,
  validateBriefingRunHistoryContract,
} from "./agent-contracts";
import {
  extractSingleLinkFixture,
  runStreetEasyBatchFixtureWithGeminiAnalysis,
  type GeminiFixtureAnalyzer,
  type GeminiFixtureAnalysisResult,
  type StreetEasyBatchFixture,
  type StreetEasyDetailsFixture,
  type StreetEasySearchResultFixture,
} from "./extraction";
import { streetEasyBatchFixture, zillowManualFixture } from "./fixtures";
import { AI_TRIAGE_SCHEMA_VERSION, type TriageEvidence, type TriageResult } from "./triage";
import {
  createAiProviderAttemptMetadata,
  createDuplicateKey,
  createGroupScopedDuplicateKey,
  createGroupScopedListingState,
  createGroupIdentity,
  defaultSearchGroup,
  MAX_IMAGES_PER_LISTING,
  type AiProviderAttemptMetadata,
  type Cadence,
  type GroupScopedListingState,
  type InviteIdentity,
  type ListingCandidate,
  type RunStatus,
} from "./listings";
import { normalizeConcurrencyLimit } from "./utils/concurrency";
import { stableHash } from "./utils/ids";
import { safeJson } from "./utils/json";
import { firstRecord, isRecord, numberField, stringArrayField, stringField } from "./utils/records";
import { uniqueStrings } from "./utils/text";

export const DAILY_LOOP_CONTRACT_VERSION = "daily-source-loop-v1" as const;
export const DAILY_LOOP_DEFAULT_CONCURRENCY = 2;
export const DAILY_LOOP_RETRY_POLICY = { maxRetries: 1, retryDelayMs: 250 } as const;

export type DailyLoopMode = "fixture" | "live-safe";
export type DailyLoopTrigger = "manual" | "cron" | "fixture";
export type DailyLoopSourceKey = "streeteasy" | "zillow-manual-fixture";
export type DailyLoopSkipReason = "seen" | "saved" | "rejected" | "triaged";

export type DailyLoopD1Binding = {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<unknown> };
  };
};

export type DailyLoopKVBinding = {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
};

export type DailyLoopEnv = Partial<
  Record<"GEMINI_API_KEY" | "REALTYAPI_KEY" | "REALTYAPI_BASE_URL" | "DAILY_LOOP_ENABLED", string>
> & {
  DB?: DailyLoopD1Binding;
  APP_CACHE?: DailyLoopKVBinding;
};

export type DailyLoopSourceCoverage = SourceCoverageSummary & {
  sourceKey: DailyLoopSourceKey;
  classification: "success" | "manual_needed" | "partial" | "failed";
  queryMetadata?: Record<string, unknown>;
  pageMetadata?: Record<string, unknown>;
  detailRetryMetadata?: DailyLoopDetailRetryMetadata[];
};

export type DailyLoopDetailRetryMetadata = {
  listingId: string;
  attempt: number;
  status: "success" | "failed" | "missing" | "not-fetched";
  httpStatus?: number;
  fetched: boolean;
  failureCode?: string;
};

export type DailyLoopSkippedCandidate = {
  source: "streeteasy" | "zillow";
  sourceUrl: string;
  listingId?: string;
  reason: DailyLoopSkipReason;
  materialChangeDetected: boolean;
  materialChangeReasons: string[];
};

export type DailyLoopPersistenceOutcome = {
  d1: {
    attempted: boolean;
    skippedReason?: "missing-binding";
    rowsWritten: number;
    error?: string;
  };
  r2: {
    attempted: boolean;
    skippedReason?: "disabled-no-r2";
    objectsWritten: number;
    error?: string;
  };
  kv: {
    attempted: boolean;
    skippedReason?: "missing-binding";
    writes: number;
    authoritative: false;
    error?: string;
  };
};

export type DailyLoopPersistencePlan = {
  contract: typeof DAILY_LOOP_CONTRACT_VERSION;
  d1: {
    authoritativeTables: string[];
    records: {
      run: AgentRunLogRecord;
      candidates: ListingCandidate[];
      sourceEvidence: SourceEvidenceRecord[];
      triageMetadata: ConfidenceTriageMetadata[];
      briefing: BriefingRecord;
      seenMemory: SeenRejectedMemoryRecord[];
    };
  };
  rawArtifacts: {
    storage: "disabled-no-r2";
    strategy: "source-image-urls-and-d1-metadata";
    rawArtifactPointers: EvidenceStoragePointer[];
  };
  kv: {
    allowedOnlyFor: "cache-config";
    authoritative: false;
  };
  outcome: DailyLoopPersistenceOutcome;
};

export type DailyLoopResult = {
  contract: typeof DAILY_LOOP_CONTRACT_VERSION;
  ok: boolean;
  mode: DailyLoopMode;
  run: AgentRunLogRecord;
  sourceCoverage: DailyLoopSourceCoverage[];
  skipped: DailyLoopSkippedCandidate[];
  materialChanges: DailyLoopSkippedCandidate[];
  listings: ListingCandidate[];
  sourceEvidence: SourceEvidenceRecord[];
  triageMetadata: ConfidenceTriageMetadata[];
  briefing: BriefingRecord;
  history: BriefingRunHistoryContract;
  persistence: DailyLoopPersistencePlan;
  observability: {
    sourceFailures: number;
    coverageLines: string[];
    operatorEvidence: AgentRunOperatorEvidence;
    fanOut: {
      concurrencyLimit: number;
      maxObservedInFlight: number;
      imageCap: typeof MAX_IMAGES_PER_LISTING;
    };
    failureIsolation: "source-failures-do-not-fail-run";
  };
  operatorEvidence: AgentRunOperatorEvidence;
};

export type RunDailySourceAgentLoopOptions = {
  mode?: DailyLoopMode;
  cadence?: Cadence;
  trigger?: DailyLoopTrigger;
  identity?: InviteIdentity;
  env?: DailyLoopEnv;
  now?: string;
  streeteasyFixture?: StreetEasyBatchFixture;
  existingListings?: ListingCandidate[];
  seenMemory?: SeenRejectedMemoryRecord[];
  priorStates?: GroupScopedListingState[];
  failStreetEasy?: boolean;
  failSecondary?: boolean;
  concurrencyLimit?: number;
  analyzer?: GeminiFixtureAnalyzer;
  fetchImpl?: typeof fetch;
};

type SourceRunSuccess = {
  status: "success";
  coverage: DailyLoopSourceCoverage;
  listings: ListingCandidate[];
  skipped: DailyLoopSkippedCandidate[];
  maxObservedInFlight: number;
  providerMetadata: AiProviderAttemptMetadata[];
};

type SourceRunFailure = {
  status: "failed";
  coverage: DailyLoopSourceCoverage;
  unit: AgentRunLogRecord["units"][number];
};

type SourceRunResult = SourceRunSuccess | SourceRunFailure;

type ExistingCandidateState = {
  reason: DailyLoopSkipReason;
  listing?: ListingCandidate;
  memory?: SeenRejectedMemoryRecord;
  state?: GroupScopedListingState;
};

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
  const d1TransitionErrors = uniqueStrings(
    [
      await persistDailyLoopRunTransition({
        env: options.env,
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
        env: options.env,
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
  const fixture = options.streeteasyFixture ?? streetEasyBatchFixture;
  const preexistingStates = buildExistingStates({
    groupId: identity.groupId,
    fixture,
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
    fixture,
    mode,
    env: options.env,
    now,
    concurrencyLimit,
    existingStates: preexistingStates,
    fail: options.failStreetEasy,
    analyzer,
    fetchImpl: options.fetchImpl,
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
          fail: options.failSecondary,
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
  const runCounts: AgentRunLogRecord["counts"] = {
    candidatesFound: coverage.reduce((sum, item) => sum + item.checkedCount, 0),
    candidatesSkippedSeen: skipped.filter(
      (item) => !item.materialChangeDetected && item.reason === "seen",
    ).length,
    candidatesSkippedTriaged: skipped.filter(
      (item) => !item.materialChangeDetected && item.reason === "triaged",
    ).length,
    candidatesAnalyzed: triagedListings.length,
    candidatesSaved: listings.length,
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
      env: options.env,
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

async function runStreetEasySource({
  runId,
  identity,
  fixture,
  mode,
  env,
  now,
  concurrencyLimit,
  existingStates,
  fail,
  analyzer,
  fetchImpl,
}: {
  runId: string;
  identity: InviteIdentity;
  fixture: StreetEasyBatchFixture;
  mode: DailyLoopMode;
  env?: DailyLoopEnv;
  now: string;
  concurrencyLimit: number;
  existingStates: Map<string, ExistingCandidateState>;
  fail?: boolean;
  analyzer?: GeminiFixtureAnalyzer;
  fetchImpl?: typeof fetch;
}): Promise<SourceRunResult> {
  if (fail) {
    return failedSource(runId, "streeteasy", "streeteasy", "streeteasy-fixture-source-failed", now);
  }

  const liveMetadata = await maybeCollectStreetEasyLiveSafeMetadata({
    mode,
    env,
    fixture,
    fetchImpl,
  });
  const sourceFixture =
    liveMetadata.normalizedFixture ??
    (mode === "live-safe" ? { ...fixture, results: [] } : fixture);
  const skipped: DailyLoopSkippedCandidate[] = [];
  const statesForExtraction: GroupScopedListingState[] = [];

  for (const result of sourceFixture.results) {
    const state = existingStates.get(
      createGroupScopedDuplicateKey(identity.groupId, result.sourceUrl),
    );
    if (!state) continue;
    const material = detectMaterialChange(result, state.listing);
    if (material.changed) {
      skipped.push({
        source: "streeteasy",
        sourceUrl: result.sourceUrl,
        listingId: result.listingId,
        reason: state.reason,
        materialChangeDetected: true,
        materialChangeReasons: material.reasons,
      });
      continue;
    }
    statesForExtraction.push(
      state.state ??
        createGroupScopedListingState(identity.groupId, result.sourceUrl, {
          seen: state.reason !== "saved",
          triaged: state.reason === "triaged" || state.reason === "rejected",
          triageBucket:
            state.listing?.triageBucket ?? (state.reason === "rejected" ? "rejected" : "untriaged"),
          reviewStatus: state.reason === "rejected" ? "rejected" : state.listing?.reviewStatus,
        }),
    );
  }

  const result = await runStreetEasyBatchFixtureWithGeminiAnalysis({
    identity,
    fixture: sourceFixture,
    priorStates: statesForExtraction,
    concurrencyLimit,
    analyzer,
  });
  skipped.push(
    ...result.skipped.map((item) => ({
      source: "streeteasy" as const,
      sourceUrl:
        sourceFixture.results.find((candidate) => candidate.listingId === item.listingId)
          ?.sourceUrl ?? "https://streeteasy.com/",
      listingId: item.listingId,
      reason: item.reason,
      materialChangeDetected: false,
      materialChangeReasons: [],
    })),
  );
  const coverage: DailyLoopSourceCoverage = {
    source: "streeteasy",
    sourceKey: "streeteasy",
    status: result.run.status === "success" ? "success" : "partial",
    classification: liveMetadata.liveAttempted ? liveMetadata.classification : "success",
    checkedCount: sourceFixture.results.length,
    candidateCount: result.listings.length,
    rawArtifactPointers: [],
    queryMetadata: {
      mode,
      endpoint: "search/rent",
      query: sourceFixture.query,
      pageRange: [...new Set(sourceFixture.results.map((item) => item.page))],
      liveSafe: liveMetadata,
    },
    pageMetadata: {
      pages: [...new Set(sourceFixture.results.map((item) => item.page))],
      staleOrOffMarketHandled: true,
      noMatchHandling: "empty pages do not fail other sources",
    },
    detailRetryMetadata: sourceFixture.results.map(
      (item) =>
        liveMetadata.detailMetadataByListing[item.listingId] ?? {
          listingId: item.listingId,
          attempt: 1,
          status: "success" as const,
          fetched: true,
        },
    ),
  };

  return {
    status: "success",
    coverage,
    listings: result.listings,
    skipped,
    maxObservedInFlight: result.geminiAnalysis.maxObservedInFlight,
    providerMetadata: result.geminiAnalysis.listingStatuses.map((item) => item.providerMetadata),
  };
}

function runSecondaryZillowFixture({
  runId,
  identity,
  now,
  concurrencyLimit,
  existingListings,
  seenMemory,
  fail,
}: {
  runId: string;
  identity: InviteIdentity;
  now: string;
  concurrencyLimit: number;
  existingListings: ListingCandidate[];
  seenMemory: SeenRejectedMemoryRecord[];
  fail?: boolean;
}): SourceRunResult {
  if (fail) {
    return failedSource(
      runId,
      "zillow-manual-fixture",
      "zillow",
      "zillow-manual-fixture-failed",
      now,
    );
  }
  const existing = findExistingState(
    identity.groupId,
    zillowManualFixture.sourceUrl,
    existingListings,
    seenMemory,
    [],
  );
  if (existing) {
    const skipped: DailyLoopSkippedCandidate = {
      source: "zillow",
      sourceUrl: zillowManualFixture.sourceUrl,
      listingId: zillowManualFixture.sourceListingId,
      reason: existing.reason,
      materialChangeDetected: false,
      materialChangeReasons: [],
    };
    return {
      status: "success",
      coverage: zillowCoverage("success", 1, 0, now),
      listings: [],
      skipped: [skipped],
      maxObservedInFlight: 0,
      providerMetadata: [],
    };
  }
  const extraction = extractSingleLinkFixture({
    rawUrl: zillowManualFixture.sourceUrl,
    identity,
    fixture: zillowManualFixture,
    concurrencyLimit,
    concurrencySlot: 1,
  });
  const listing = {
    ...extraction.listing,
    userQualified: false,
    providerRouting: {
      ...extraction.listing.providerRouting,
      intakeKind: "manual-entry" as const,
      notes:
        "Approved Zillow manual fixture/alert input; no crawling, hidden APIs, login automation, or CAPTCHA bypass.",
    },
  } satisfies ListingCandidate;
  return {
    status: "success",
    coverage: zillowCoverage("partial", 1, 1, now),
    listings: [listing],
    skipped: [],
    maxObservedInFlight: 0,
    providerMetadata: [extraction.extractionJob.providerAttempts[0]!],
  };
}

function emptySecondaryZillowCoverage(now: string): SourceRunSuccess {
  return {
    status: "success",
    coverage: zillowCoverage("partial", 0, 0, now),
    listings: [],
    skipped: [],
    maxObservedInFlight: 0,
    providerMetadata: [],
  };
}

function failedSource(
  runId: string,
  sourceKey: DailyLoopSourceKey,
  source: "streeteasy" | "zillow",
  failureCode: string,
  now: string,
): SourceRunFailure {
  return {
    status: "failed",
    coverage: {
      source,
      sourceKey,
      status: "failed",
      classification: "failed",
      checkedCount: 1,
      candidateCount: 0,
      failureCode,
      failureMessage: "Source failed in isolation; daily loop continues with remaining sources.",
      rawArtifactPointers: [],
    },
    unit: {
      id: stableId(`${runId}:${sourceKey}:failed`),
      source: source === "streeteasy" ? "streeteasy" : "zillow",
      status: "failed",
      attempt: 1,
      maxRetries: DAILY_LOOP_RETRY_POLICY.maxRetries,
      errorCode: failureCode,
      startedAt: now,
      completedAt: now,
    },
  };
}

function zillowCoverage(
  status: SourceCoverageSummary["status"],
  checkedCount: number,
  candidateCount: number,
  now: string,
): DailyLoopSourceCoverage {
  return {
    source: "zillow",
    sourceKey: "zillow-manual-fixture",
    status,
    classification: "manual_needed",
    checkedCount,
    candidateCount,
    rawArtifactPointers: [],
    queryMetadata: {
      inputKind: "manual-url-fixture",
      sourceClassification: "manual_needed",
      capturedAt: now,
      prohibitedAutomationAvoided: [
        "broad-crawling",
        "hidden-api",
        "login-automation",
        "captcha-bypass",
      ],
    },
  };
}

async function maybeCollectStreetEasyLiveSafeMetadata({
  mode,
  env,
  fixture,
  fetchImpl = fetch,
}: {
  mode: DailyLoopMode;
  env?: DailyLoopEnv;
  fixture: StreetEasyBatchFixture;
  fetchImpl?: typeof fetch;
}): Promise<{
  liveAttempted: boolean;
  classification: DailyLoopSourceCoverage["classification"];
  missingKey: boolean;
  queryAttempts: number;
  detailMetadataByListing: Record<string, DailyLoopDetailRetryMetadata>;
  failureCode?: string;
  normalizedFixture?: StreetEasyBatchFixture;
}> {
  if (mode !== "live-safe") {
    return {
      liveAttempted: false,
      classification: "success",
      missingKey: false,
      queryAttempts: 0,
      detailMetadataByListing: {},
    };
  }
  const apiKey = env?.REALTYAPI_KEY ?? process.env.REALTYAPI_KEY;
  if (!apiKey) {
    return {
      liveAttempted: false,
      classification: "partial",
      missingKey: true,
      queryAttempts: 0,
      detailMetadataByListing: {},
      failureCode: "missing-realtyapi-key",
    };
  }
  const baseUrl = (
    env?.REALTYAPI_BASE_URL ??
    process.env.REALTYAPI_BASE_URL ??
    "https://streeteasy.realtyapi.io"
  ).replace(/\/$/, "");
  const detailMetadataByListing: Record<string, DailyLoopDetailRetryMetadata> = {};
  try {
    const liveResults: StreetEasySearchResultFixture[] = [];
    let queryAttempts = 0;
    for (const area of fixture.query.areas) {
      for (let page = 1; page <= 3; page += 1) {
        queryAttempts += 1;
        const searchResponse = await fetchImpl(
          buildRealtyApiUrl(baseUrl, "/search/rent", { ...fixture.query, areas: [area], page }),
          { headers: { "x-realtyapi-key": apiKey } },
        );
        const searchPayload = await safeJson(searchResponse);
        if (!searchResponse.ok) {
          return {
            liveAttempted: true,
            classification: "partial",
            missingKey: false,
            queryAttempts,
            detailMetadataByListing,
            failureCode: `streeteasy-live-safe-search-http-${searchResponse.status}`,
          };
        }
        liveResults.push(...normalizeStreetEasySearchPayload(searchPayload, fixture));
      }
    }
    const plausibleLiveResults = uniqueStreetEasyResults(liveResults)
      .filter((result) => isPlausibleStreetEasySearchResult(result, fixture))
      .slice(0, 24);
    const detailPayloads: Record<string, unknown> = {};
    for (const listing of plausibleLiveResults) {
      try {
        const detailResponse = await fetchImpl(
          buildRealtyApiUrl(baseUrl, "/rental_detailsbyid", { buildingid: listing.listingId }),
          { headers: { "x-realtyapi-key": apiKey } },
        );
        const detailPayload = await safeJson(detailResponse);
        const detailRecord = firstRecord(detailPayload);
        const hasDetailRecord = detailRecord && Object.keys(detailRecord).length > 0;
        if (!detailResponse.ok) {
          detailMetadataByListing[listing.listingId] = {
            listingId: listing.listingId,
            attempt: 1,
            status: "failed",
            httpStatus: detailResponse.status,
            fetched: false,
            failureCode: `streeteasy-live-safe-detail-http-${detailResponse.status}`,
          };
          continue;
        }
        if (!hasDetailRecord) {
          detailMetadataByListing[listing.listingId] = {
            listingId: listing.listingId,
            attempt: 1,
            status: "missing",
            httpStatus: detailResponse.status,
            fetched: false,
            failureCode: "streeteasy-live-safe-detail-missing-record",
          };
          continue;
        }
        detailMetadataByListing[listing.listingId] = {
          listingId: listing.listingId,
          attempt: 1,
          status: "success",
          httpStatus: detailResponse.status,
          fetched: true,
        };
        detailPayloads[listing.listingId] = detailPayload;
      } catch {
        detailMetadataByListing[listing.listingId] = {
          listingId: listing.listingId,
          attempt: 1,
          status: "failed",
          fetched: false,
          failureCode: "streeteasy-live-safe-detail-fetch-failed",
        };
      }
    }
    const normalizedFixture = mergeStreetEasyDetails(
      plausibleLiveResults,
      detailPayloads,
      fixture,
    ) ?? {
      ...fixture,
      results: [],
    };
    const hasDetailFailures = Object.values(detailMetadataByListing).some(
      (metadata) => metadata.status !== "success",
    );
    return {
      liveAttempted: true,
      classification:
        normalizedFixture.results.length > 0 && !hasDetailFailures ? "success" : "partial",
      missingKey: false,
      queryAttempts,
      detailMetadataByListing,
      failureCode:
        normalizedFixture.results.length === 0
          ? "streeteasy-live-safe-no-eligible-results"
          : hasDetailFailures
            ? "streeteasy-live-safe-detail-partial"
            : undefined,
      normalizedFixture,
    };
  } catch {
    return {
      liveAttempted: true,
      classification: "partial",
      missingKey: false,
      queryAttempts: 1,
      detailMetadataByListing,
      failureCode: "streeteasy-live-safe-fetch-failed",
    };
  }
}

function buildRealtyApiUrl(
  baseUrl: string,
  endpoint: "/search/rent" | "/rental_detailsbyid",
  params: StreetEasyBatchFixture["query"] | { buildingid: string },
) {
  const url = new URL(`${baseUrl}${endpoint}`);
  if ("buildingid" in params) {
    url.searchParams.set("buildingid", params.buildingid);
    return url.toString();
  }

  url.searchParams.set("location", params.areas[0] ?? "NYC and NJ");
  url.searchParams.set("sort_by", params.sort === "newest" ? "Newest" : (params.sort ?? "Newest"));
  url.searchParams.set("page", String(params.page ?? 1));
  return url.toString();
}

function uniqueStreetEasyResults(results: StreetEasySearchResultFixture[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.listingId)) return false;
    seen.add(result.listingId);
    return true;
  });
}

function isPlausibleStreetEasySearchResult(
  result: StreetEasySearchResultFixture,
  fallback: StreetEasyBatchFixture,
) {
  const details = result.details;
  const address = details.address?.trim();
  return (
    Boolean(address && address !== "Unknown address") &&
    (details.bedrooms === undefined || details.bedrooms >= (fallback.query.minBeds ?? 0)) &&
    (details.rent === undefined ||
      details.rent <= (fallback.query.maxRent ?? Number.POSITIVE_INFINITY))
  );
}

function normalizeStreetEasySearchPayload(
  payload: unknown,
  fallback: StreetEasyBatchFixture,
): StreetEasySearchResultFixture[] {
  const records = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.results)
      ? payload.results
      : isRecord(payload) && Array.isArray(payload.listings)
        ? payload.listings
        : isRecord(payload) && isRecord(payload.search_results)
          ? realtyApiListingNodes(payload.search_results)
          : isRecord(payload) && Array.isArray(payload.data)
            ? payload.data
            : [];
  return records.flatMap((record, index) => {
    if (!isRecord(record)) return [];
    const listingId = stringField(record, ["listingId", "listing_id", "id", "buildingid"]);
    const url = stringField(record, ["sourceUrl", "url", "permalink", "listing_url", "urlPath"]);
    if (!listingId || !url) return [];
    const normalizedUrl = normalizeStreetEasyUrl(url);
    const details = normalizeStreetEasyDetails(record, listingId, normalizedUrl);
    return [
      {
        listingId,
        sourceUrl: normalizedUrl,
        urlPath: new URL(normalizedUrl).pathname,
        page: numberField(record, ["page"]) ?? fallback.results[index]?.page ?? 1,
        location:
          stringField(record, ["location", "neighborhood", "area"]) ??
          fallback.results[index]?.location ??
          "NYC",
        details,
      },
    ];
  });
}

function realtyApiListingNodes(searchResults: Record<string, unknown>) {
  const listings = Array.isArray(searchResults.listings) ? searchResults.listings : [];
  return listings.flatMap((item) => (isRecord(item) && isRecord(item.node) ? [item.node] : []));
}

function mergeStreetEasyDetails(
  searchResults: StreetEasySearchResultFixture[],
  detailPayloads: Record<string, unknown>,
  fallback: StreetEasyBatchFixture,
): StreetEasyBatchFixture | undefined {
  if (searchResults.length === 0) return undefined;
  const results = searchResults.map((result, index) => {
    const detailRecord = firstRecord(detailPayloads[result.listingId]);
    const mergedDetails = detailRecord
      ? {
          ...result.details,
          ...normalizeStreetEasyDetails(detailRecord, result.listingId, result.sourceUrl),
        }
      : result.details;
    if (!mergedDetails.photos?.length) {
      mergedDetails.photos = result.details.photos;
    }
    if (!mergedDetails.amenities?.length) {
      mergedDetails.amenities = result.details.amenities;
    }
    if (!mergedDetails.location) {
      mergedDetails.location = result.details.location;
    }
    return {
      ...result,
      page: result.page || fallback.results[index]?.page || 1,
      details: mergedDetails,
    };
  });
  return { ...fallback, results };
}

function normalizeStreetEasyDetails(
  record: Record<string, unknown>,
  listingId: string,
  sourceUrl: string,
): StreetEasyDetailsFixture {
  const address =
    stringField(record, ["address", "display_address", "streetAddress"]) ??
    streetEasySearchAddress(record) ??
    realtyApiAddress(record) ??
    "Unknown address";
  return {
    listingId,
    sourceListingId: listingId,
    sourceUrl,
    urlPath: new URL(sourceUrl).pathname,
    title: normalizeStreetEasyTitle(stringField(record, ["title", "name"]), address),
    address,
    neighborhood: stringField(record, ["neighborhood", "area", "areaName"]),
    borough: stringField(record, ["borough", "city"]) ?? realtyApiCity(record) ?? "Manhattan",
    location: realtyApiCoordinates(record),
    rent: numberField(record, ["rent", "price", "monthlyRent"]) ?? realtyApiPrice(record),
    bedrooms:
      numberField(record, ["bedrooms", "beds", "bedroomCount"]) ??
      realtyApiNestedNumber(record, "bedroomCount"),
    bathrooms: numberField(record, ["bathrooms", "baths"]) ?? realtyApiBathroomCount(record),
    availableAt: stringField(record, ["availableAt", "available_at", "availableDate"]),
    description: stringField(record, ["description", "details"]),
    amenities:
      stringArrayField(record, ["amenities"]) ??
      (isRecord(record.propertyDetails)
        ? uniqueStrings([
            ...(realtyApiStringList(record.propertyDetails, "amenities") ?? []),
            ...(realtyApiStringList(record.propertyDetails, "features") ?? []),
          ])
        : undefined),
    photos:
      stringArrayField(record, ["photos", "images", "photoUrls", "imageUrls"]) ??
      realtyApiPhotos(record),
    status: stringField(record, ["status", "propertyStatus"]),
  };
}

function normalizeStreetEasyTitle(title: string | undefined, address: string) {
  const normalizedTitle = title?.trim();
  if (normalizedTitle && normalizedTitle.toLowerCase() !== "streeteasy listing") {
    return normalizedTitle;
  }

  return address && address !== "Unknown address" ? address : "StreetEasy listing";
}

function realtyApiCoordinates(record: Record<string, unknown>) {
  const geoPoint = isRecord(record.geoPoint)
    ? record.geoPoint
    : isRecord(record.propertyDetails) && isRecord(record.propertyDetails.geoPoint)
      ? record.propertyDetails.geoPoint
      : undefined;
  if (!geoPoint) return undefined;

  const latitude = numberField(geoPoint, ["latitude", "lat"]);
  const longitude = numberField(geoPoint, ["longitude", "lng", "lon"]);
  if (latitude === undefined || longitude === undefined) return undefined;

  return { latitude, longitude };
}

function realtyApiAddress(record: Record<string, unknown>) {
  const address = isRecord(record.propertyDetails) ? record.propertyDetails.address : undefined;
  if (!isRecord(address)) return undefined;
  return [
    address.street ?? [address.houseNumber, address.streetName].filter(Boolean).join(" "),
    address.unit,
  ]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ");
}

function streetEasySearchAddress(record: Record<string, unknown>) {
  const street = stringField(record, ["street"]);
  const unit = stringField(record, ["unit"]);
  return street ? [street, unit].filter(Boolean).join(" ") : undefined;
}

function realtyApiCity(record: Record<string, unknown>) {
  const address = isRecord(record.propertyDetails) ? record.propertyDetails.address : undefined;
  return isRecord(address) && typeof address.city === "string" ? address.city : undefined;
}

function realtyApiPrice(record: Record<string, unknown>) {
  return isRecord(record.pricing) ? numberField(record.pricing, ["price"]) : undefined;
}

function realtyApiNestedNumber(record: Record<string, unknown>, field: string) {
  return isRecord(record.propertyDetails)
    ? numberField(record.propertyDetails, [field])
    : undefined;
}

function realtyApiBathroomCount(record: Record<string, unknown>) {
  const topLevelFull = numberField(record, ["fullBathroomCount"]);
  const topLevelHalf = numberField(record, ["halfBathroomCount"]);
  if (topLevelFull !== undefined || topLevelHalf !== undefined) {
    return (topLevelFull ?? 0) + (topLevelHalf ?? 0) * 0.5;
  }
  if (!isRecord(record.propertyDetails)) return undefined;
  const full = numberField(record.propertyDetails, ["fullBathroomCount"]);
  const half = numberField(record.propertyDetails, ["halfBathroomCount"]);
  return full === undefined && half === undefined ? undefined : (full ?? 0) + (half ?? 0) * 0.5;
}

function realtyApiPhotos(record: Record<string, unknown>) {
  const containers = [record.media, record.propertyDetails, record.listingDetails, record].filter(
    isRecord,
  );
  const photoArrays = containers.flatMap((container) =>
    ["photos", "images", "imageUrls", "photoUrls", "gallery"].flatMap((field) => {
      const value = container[field];
      return Array.isArray(value) ? [value] : [];
    }),
  );
  const urls = photoArrays.flatMap((photos) =>
    photos.flatMap((photo) => {
      if (typeof photo === "string") return [photo];
      if (!isRecord(photo)) return [];
      return stringField(photo, ["url", "href", "src", "source", "large", "medium", "small"]) ?? [];
    }),
  );

  return urls.length > 0 ? uniqueStrings(urls) : undefined;
}

function realtyApiStringList(record: Record<string, unknown>, container: string) {
  const value = record[container];
  if (!isRecord(value) || !Array.isArray(value.list)) return undefined;
  return value.list.filter((item): item is string => typeof item === "string" && Boolean(item));
}

function normalizeStreetEasyUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://streeteasy.com");
    return parsed.toString();
  } catch {
    return "https://streeteasy.com/";
  }
}

function buildExistingStates({
  groupId,
  fixture,
  existingListings,
  seenMemory,
  priorStates,
}: {
  groupId: string;
  fixture: StreetEasyBatchFixture;
  existingListings: ListingCandidate[];
  seenMemory: SeenRejectedMemoryRecord[];
  priorStates: GroupScopedListingState[];
}): Map<string, ExistingCandidateState> {
  const states = new Map<string, ExistingCandidateState>();
  for (const result of fixture.results) {
    const state = findExistingState(
      groupId,
      result.sourceUrl,
      existingListings,
      seenMemory,
      priorStates,
    );
    if (state) states.set(createGroupScopedDuplicateKey(groupId, result.sourceUrl), state);
  }
  return states;
}

function findExistingState(
  groupId: string,
  sourceUrl: string,
  existingListings: ListingCandidate[],
  seenMemory: SeenRejectedMemoryRecord[],
  priorStates: GroupScopedListingState[],
): ExistingCandidateState | undefined {
  const groupScopedDuplicateKey = createGroupScopedDuplicateKey(groupId, sourceUrl);
  const listing = existingListings.find(
    (item) => item.groupScopedDuplicateKey === groupScopedDuplicateKey,
  );
  if (listing) {
    if (listing.reviewStatus === "rejected" || listing.triageBucket === "rejected")
      return { reason: "rejected", listing };
    if (listing.triageBucket !== "untriaged") return { reason: "triaged", listing };
    return { reason: "saved", listing };
  }
  const memory = seenMemory.find(
    (item) => item.groupScopedDuplicateKey === groupScopedDuplicateKey,
  );
  if (memory) return { reason: memory.memoryState === "rejected" ? "rejected" : "seen", memory };
  const state = priorStates.find(
    (item) => item.groupScopedDuplicateKey === groupScopedDuplicateKey,
  );
  if (state) return { reason: state.triaged ? "triaged" : "seen", state };
  return undefined;
}

function detectMaterialChange(
  result: StreetEasySearchResultFixture,
  existing?: ListingCandidate,
): { changed: boolean; reasons: string[] } {
  if (!existing) return { changed: false, reasons: [] };
  const reasons: string[] = [];
  if (
    existing.rent !== undefined &&
    result.details.rent !== undefined &&
    existing.rent !== result.details.rent
  )
    reasons.push("rent-changed");
  if (
    existing.availableAt &&
    result.details.availableAt &&
    existing.availableAt !== result.details.availableAt
  )
    reasons.push("availability-date-changed");
  if (
    existing.bedrooms !== undefined &&
    result.details.bedrooms !== undefined &&
    existing.bedrooms !== result.details.bedrooms
  )
    reasons.push("bedroom-count-changed");
  return { changed: reasons.length > 0, reasons };
}

function toSkippedUnit(
  runId: string,
  item: DailyLoopSkippedCandidate,
  now: string,
): AgentRunLogRecord["units"][number] {
  return {
    id: stableId(`${runId}:${item.sourceUrl}:skipped:${item.reason}`),
    source: item.source,
    sourceUrl: item.sourceUrl,
    listingId: item.listingId,
    status:
      item.reason === "triaged" || item.reason === "rejected" ? "skipped-triaged" : "skipped-seen",
    attempt: 0,
    maxRetries: DAILY_LOOP_RETRY_POLICY.maxRetries,
    errorCode: item.materialChangeDetected
      ? `material-change-${item.materialChangeReasons.join("+")}`
      : undefined,
    startedAt: now,
    completedAt: now,
  };
}

function toMaterialChangeUnit(
  runId: string,
  item: DailyLoopSkippedCandidate,
  now: string,
): AgentRunLogRecord["units"][number] {
  return {
    id: stableId(`${runId}:${item.sourceUrl}:material-change-processed`),
    source: item.source,
    sourceUrl: item.sourceUrl,
    listingId: item.listingId,
    status: "success",
    attempt: 1,
    maxRetries: DAILY_LOOP_RETRY_POLICY.maxRetries,
    errorCode: `material-change-${item.materialChangeReasons.join("+")}`,
    startedAt: now,
    completedAt: now,
  };
}

function toSuccessUnit(
  runId: string,
  listing: ListingCandidate,
  now: string,
): AgentRunLogRecord["units"][number] {
  return {
    id: stableId(`${runId}:${listing.url}:success`),
    source:
      listing.source === "streeteasy" || listing.source === "zillow" ? listing.source : "other",
    sourceUrl: listing.url,
    listingId: listing.sourceListingId ?? listing.id,
    status: "success",
    attempt: 1,
    maxRetries: DAILY_LOOP_RETRY_POLICY.maxRetries,
    startedAt: now,
    completedAt: now,
  };
}

function toProviderFailureUnits(
  runId: string,
  listings: ListingCandidate[],
  providerMetadata: AiProviderAttemptMetadata[],
  now: string,
): AgentRunLogRecord["units"] {
  return providerMetadata.flatMap((metadata, index) => {
    if (metadata.status !== "failed") return [];
    const listing = listings[index];
    return [
      {
        id: stableId(`${runId}:gemini:${metadata.attemptId}:${index}:failed`),
        source: "gemini" as const,
        sourceUrl: listing?.url,
        listingId: listing?.sourceListingId ?? listing?.id,
        status: "failed" as const,
        attempt: 1,
        maxRetries: DAILY_LOOP_RETRY_POLICY.maxRetries,
        errorCode: metadata.failureCode ?? "gemini-provider-failed",
        startedAt: metadata.startedAt,
        completedAt: metadata.completedAt ?? now,
      },
    ];
  });
}

function createDailyLoopSourceEvidence({
  groupId,
  runId,
  listings,
  coverage,
  rawArtifactPointers,
  now,
}: {
  groupId: string;
  runId: string;
  listings: ListingCandidate[];
  coverage: DailyLoopSourceCoverage[];
  rawArtifactPointers: EvidenceStoragePointer[];
  now: string;
}): SourceEvidenceRecord[] {
  const listingEvidence = listings.flatMap((listing) =>
    listing.evidence.map(
      (item, index): SourceEvidenceRecord => ({
        id: stableId(`${runId}:${listing.id}:evidence:${index}`),
        contract: "source-evidence-v1",
        groupId,
        listingId: listing.id,
        runId,
        sourceUrl: item.sourceUrl || listing.url,
        claim: item.claim,
        quote: item.quote,
        pointer: rawArtifactPointers.find((pointer) => pointer.key.includes(listing.id)) ?? {
          owner: "d1",
          key: `daily_loop_candidates:${listing.id}:evidence:${index}`,
          contentType: "application/json",
          groupScoped: true,
        },
        capturedAt: now,
      }),
    ),
  );
  const failureEvidence = coverage
    .filter((item) => item.status === "failed")
    .map(
      (item): SourceEvidenceRecord => ({
        id: stableId(`${runId}:${item.source}:failure`),
        contract: "source-evidence-v1",
        groupId,
        runId,
        sourceUrl: `https://fixture.local/${item.source}`,
        claim: `${item.source} source failure isolated`,
        quote: item.failureMessage ?? "Source failed without failing the daily loop.",
        pointer: rawArtifactPointers.find((pointer) => pointer.key.includes("source-failures")) ?? {
          owner: "d1",
          key: `${groupId}/${runId}/source-failures/${item.source}.json`,
          contentType: "application/json",
          groupScoped: true,
        },
        capturedAt: now,
      }),
    );
  return [...listingEvidence, ...failureEvidence];
}

function toTriageMetadata(listing: ListingCandidate, now: string): ConfidenceTriageMetadata {
  const confidence = confidenceForListing(listing);
  const hardResult =
    listing.triageBucket === "rejected"
      ? "failed"
      : listing.triageBucket === "review-needed"
        ? "review-needed"
        : "passed";
  return {
    contract: "confidence-triage-v1",
    groupId: listing.groupId,
    listingId: listing.id,
    bucket: listing.triageBucket === "untriaged" ? "review-needed" : listing.triageBucket,
    status: listing.triageStatus,
    confidence,
    reasons: listing.evidence.map((item) => item.claim),
    concerns: listing.concerns,
    deterministicHardConstraintResult: hardResult,
    schemaValidationResult: "passed",
    promptVersion: AI_TRIAGE_SCHEMA_VERSION,
    updatedAt: now,
  };
}

function createDailyLoopBriefing({
  groupId,
  run,
  listings,
  coverage,
  skipped,
  now,
}: {
  groupId: string;
  run: AgentRunLogRecord;
  listings: ListingCandidate[];
  coverage: DailyLoopSourceCoverage[];
  skipped: DailyLoopSkippedCandidate[];
  now: string;
}): BriefingRecord {
  const confirmed = listings.filter((listing) => listing.triageBucket === "confirmed-match");
  const reviewNeeded = listings.filter((listing) => listing.triageBucket === "review-needed");
  const rejected = listings.filter((listing) => listing.triageBucket === "rejected");
  return {
    id: stableId(`${run.id}:briefing`),
    contract: "briefing-record-v1",
    groupId,
    runId: run.id,
    generatedAt: now,
    bestNewListingIds: confirmed.map((listing) => listing.id),
    reviewNeededListingIds: reviewNeeded.map((listing) => listing.id),
    rejectedListingIds: rejected.map((listing) => listing.id),
    summary: `${confirmed.length} confirmed, ${reviewNeeded.length} review-needed, ${rejected.length} rejected; ${coverage.filter((item) => item.status === "failed").length} source failure(s) isolated.`,
    whatChanged: [
      `${listings.length} candidate(s) persisted for review/history`,
      `${skipped.filter((item) => !item.materialChangeDetected).length} seen/saved/rejected/triaged candidate(s) skipped`,
    ],
    sourceCoverage: coverage.map((item) => ({
      source: item.source,
      status: item.status,
      checkedCount: item.checkedCount,
      failureCode: item.failureCode,
    })),
    skippedSeenCount: skipped.filter(
      (item) => !item.materialChangeDetected && (item.reason === "seen" || item.reason === "saved"),
    ).length,
    recommendationRationale: listings.map(
      (listing) =>
        `${listing.title}: ${listing.concerns[0] ?? listing.evidence[0]?.claim ?? "source evidence captured"}`,
    ),
    suggestedNextActions: [
      "Review confirmed and review-needed candidates in the shared app.",
      "Inspect source coverage/failure rows before trusting missing-source coverage.",
    ],
  };
}

function createDailyLoopHistory({
  groupId,
  generatedAt,
  run,
  listings,
  sourceCoverage,
  sourceEvidence,
  triageMetadata,
  briefing,
  seenRejectedMemory,
  providerMetadata,
  rawArtifactPointers,
}: {
  groupId: string;
  generatedAt: string;
  run: AgentRunLogRecord;
  listings: ListingCandidate[];
  sourceCoverage: DailyLoopSourceCoverage[];
  sourceEvidence: SourceEvidenceRecord[];
  triageMetadata: ConfidenceTriageMetadata[];
  briefing: BriefingRecord;
  seenRejectedMemory: SeenRejectedMemoryRecord[];
  providerMetadata: AiProviderAttemptMetadata[];
  rawArtifactPointers: EvidenceStoragePointer[];
}): BriefingRunHistoryContract {
  const candidateSummaries = listings.map((listing) =>
    toCandidateSummary(listing, sourceEvidence, triageMetadata),
  );
  const coverage = sourceCoverage.map(
    (item): SourceCoverageSummary => ({
      source: item.source,
      status: item.status,
      checkedCount: item.checkedCount,
      candidateCount: item.candidateCount,
      failureCode: item.failureCode,
      failureMessage: item.failureMessage,
      rawArtifactPointers: rawArtifactPointers.filter(
        (pointer) =>
          pointer.key.includes(`/${item.source}/`) || pointer.key.includes("source-failures"),
      ),
    }),
  );
  const latestRun: BriefingRunHistoryRun = {
    runId: run.id,
    cadence: run.cadence,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    counts: {
      candidatesFound: run.counts.candidatesFound,
      candidatesSkippedSeen: run.counts.candidatesSkippedSeen,
      candidatesSkippedTriaged: run.counts.candidatesSkippedTriaged ?? 0,
      candidatesTriaged: candidateSummaries.length,
      confirmedMatches: candidateSummaries.filter(
        (candidate) => candidate.bucket === "confirmed-match",
      ).length,
      reviewNeeded: candidateSummaries.filter((candidate) => candidate.bucket === "review-needed")
        .length,
      rejected: candidateSummaries.filter((candidate) => candidate.bucket === "rejected").length,
      sourceFailures: run.counts.sourceFailures,
    },
    sourceCoverage: coverage,
    candidateSummaries,
    providerMetadata,
    rawArtifactPointers,
    operatorEvidence: run.operatorEvidence,
  };
  return {
    contract: "briefing-run-history-v1",
    schemaVersion: "briefing-run-history-v1",
    groupId,
    generatedAt,
    supportedCadences: ["manual", "daily", "hourly"],
    latestRun,
    runs: [latestRun],
    latestBriefing: {
      id: briefing.id,
      runId: run.id,
      generatedAt,
      summary: briefing.summary,
      bestNewListingIds: briefing.bestNewListingIds,
      reviewNeededListingIds: briefing.reviewNeededListingIds,
      rejectedListingIds: briefing.rejectedListingIds,
      whatChanged: briefing.whatChanged,
      sourceCoverage: coverage,
      skippedSeenCount: briefing.skippedSeenCount,
      evidenceConfidenceSummaries: candidateSummaries.map((candidate) => candidate.evidenceSummary),
      recommendationRationale: briefing.recommendationRationale,
      suggestedActions: briefing.suggestedNextActions,
    },
    seenRejectedMemory,
    feedbackSummaries: [],
  };
}

function toCandidateSummary(
  listing: ListingCandidate,
  evidence: SourceEvidenceRecord[],
  triage: ConfidenceTriageMetadata[],
): BriefingCandidateSummary {
  const triageRecord = triage.find((item) => item.listingId === listing.id)!;
  const evidenceForListing = evidence.filter(
    (item) => item.listingId === listing.id || item.sourceUrl === listing.url,
  );
  return {
    listingId: listing.id,
    sourceUrl: listing.url,
    source: listing.source,
    title: listing.title,
    bucket: listing.triageBucket === "untriaged" ? "review-needed" : listing.triageBucket,
    triageStatus: listing.triageStatus,
    reviewStatus: listing.reviewStatus,
    providerRoute: listing.providerRoute,
    evidenceSummary: {
      confidence: triageRecord.confidence,
      reasons: triageRecord.reasons,
      concerns: triageRecord.concerns,
      evidenceQuotes: [
        ...listing.evidence.map((item) => item.quote),
        ...evidenceForListing.map((item) => item.quote),
      ],
      sourceLinks: [...new Set([listing.url, ...evidenceForListing.map((item) => item.sourceUrl)])],
      rawArtifactPointers: evidenceForListing.map((item) => item.pointer),
    },
    suggestedAction:
      listing.triageBucket === "confirmed-match"
        ? "Prioritize for roommate review."
        : listing.triageBucket === "rejected"
          ? "Keep in rejection/seen memory."
          : "Review uncertainty before promoting.",
  };
}

function createRawArtifactPointers(
  groupId: string,
  runId: string,
  coverage: DailyLoopSourceCoverage[],
  listings: ListingCandidate[],
): EvidenceStoragePointer[] {
  return [
    ...coverage.map(
      (item): EvidenceStoragePointer => ({
        owner: "d1",
        key: `${groupId}/${runId}/${item.status === "failed" ? "source-failures" : item.source}/coverage.json`,
        contentType: "application/json",
        groupScoped: true,
      }),
    ),
    ...listings.map(
      (listing): EvidenceStoragePointer => ({
        owner: "d1",
        key: `${groupId}/${runId}/${listing.source}/${listing.id}/raw-artifact.json`,
        contentType: "application/json",
        groupScoped: true,
      }),
    ),
  ];
}

function createDailyLoopObservability(input: {
  sourceFailures: number;
  coverage: DailyLoopSourceCoverage[];
  concurrencyLimit: number;
  maxObservedInFlight: number;
  operatorEvidence: AgentRunOperatorEvidence;
}): DailyLoopResult["observability"] {
  return {
    sourceFailures: input.sourceFailures,
    coverageLines: input.coverage.map(
      (item) =>
        `${item.source}: ${item.status} checked=${item.checkedCount} candidates=${item.candidateCount}${item.failureCode ? ` failure=${item.failureCode}` : ""}`,
    ),
    operatorEvidence: input.operatorEvidence,
    fanOut: {
      concurrencyLimit: input.concurrencyLimit,
      maxObservedInFlight: input.maxObservedInFlight,
      imageCap: MAX_IMAGES_PER_LISTING,
    },
    failureIsolation: "source-failures-do-not-fail-run",
  };
}

function createDailyLoopOperatorEvidence(input: {
  run: AgentRunLogRecord;
  mode: DailyLoopMode;
  coverage: DailyLoopSourceCoverage[];
  skipped: DailyLoopSkippedCandidate[];
  listings: ListingCandidate[];
  providerMetadata: AiProviderAttemptMetadata[];
  rawArtifactPointers: EvidenceStoragePointer[];
}): AgentRunOperatorEvidence {
  const processedSkips = input.skipped.filter((item) => !item.materialChangeDetected);
  const byReason = countSkippedByReason(processedSkips);
  const confirmedMatches = input.listings.filter(
    (listing) => listing.triageBucket === "confirmed-match",
  ).length;
  const reviewNeeded = input.listings.filter(
    (listing) => listing.triageBucket === "review-needed",
  ).length;
  const candidateIdentifiers = input.listings.map((listing) => ({
    listingId: listing.id,
    sourceListingId: listing.sourceListingId,
    source: listing.source,
    sourceUrl: listing.url,
    duplicateKey: listing.duplicateKey,
    groupScopedDuplicateKey: listing.groupScopedDuplicateKey,
    bucket: listing.triageBucket,
    triageStatus: listing.triageStatus,
    reviewStatus: listing.reviewStatus,
  }));

  return {
    runId: input.run.id,
    groupId: input.run.groupId,
    cadence: input.run.cadence,
    trigger: input.run.trigger,
    mode: input.mode,
    status: input.run.status,
    startedAt: input.run.startedAt,
    completedAt: input.run.completedAt,
    retryPolicy: input.run.retryPolicy,
    candidateCounts: {
      found: input.run.counts.candidatesFound,
      skippedSeen: byReason.seen ?? 0,
      skippedSaved: byReason.saved ?? 0,
      skippedRejected: byReason.rejected ?? 0,
      skippedTriaged: byReason.triaged ?? 0,
      skippedTotal: processedSkips.length,
      triaged: input.run.counts.candidatesAnalyzed,
      saved: input.run.counts.candidatesSaved,
      rejected: input.run.counts.candidatesRejected,
      confirmedMatches,
      reviewNeeded,
      sourceFailures: input.run.counts.sourceFailures,
    },
    sourceCoverage: input.coverage.map((coverage) => {
      const identifiers = identifiersForSource(coverage, input.listings, input.skipped);
      return {
        source: coverage.source,
        sourceKey: coverage.sourceKey,
        classification: coverage.classification,
        status: coverage.status,
        checkedCount: coverage.checkedCount,
        candidateCount: coverage.candidateCount,
        failureCode: coverage.failureCode,
        failureMessage: coverage.failureMessage,
        rawArtifactPointers: input.rawArtifactPointers.filter(
          (pointer) =>
            pointer.key.includes(`/${coverage.source}/`) || pointer.key.includes("source-failures"),
        ),
        queryMetadata: coverage.queryMetadata,
        pageMetadata: coverage.pageMetadata,
        detailRetryMetadata: coverage.detailRetryMetadata,
        identifiers,
      };
    }),
    failures: input.coverage
      .filter((coverage) => coverage.status === "failed" || coverage.failureCode)
      .map((coverage) => ({
        sourceKey: coverage.sourceKey,
        source: coverage.source,
        status: coverage.status,
        failureCode: coverage.failureCode,
        failureMessage: coverage.failureMessage,
      })),
    skips: {
      byReason,
      candidates: input.skipped.map((item) => ({
        source: item.source,
        sourceUrl: item.sourceUrl,
        listingId: item.listingId,
        reason: item.reason,
        materialChangeDetected: item.materialChangeDetected,
        materialChangeReasons: item.materialChangeReasons,
      })),
    },
    retryAttempts: input.run.units.map((unit) => ({ ...unit })),
    detailRetries: input.coverage.flatMap((coverage) => coverage.detailRetryMetadata ?? []),
    providerAttempts: input.providerMetadata,
    artifactPointers: input.rawArtifactPointers,
    candidateIdentifiers,
    debugIdentifiers: {
      runId: input.run.id,
      groupId: input.run.groupId,
      sourceKeys: uniqueStrings(input.coverage.map((coverage) => coverage.sourceKey)),
      sourceUrls: uniqueStrings([
        ...input.listings.map((listing) => listing.url),
        ...input.skipped.map((item) => item.sourceUrl),
      ]),
      listingIds: uniqueStrings(input.listings.map((listing) => listing.id)),
      sourceListingIds: uniqueStrings([
        ...input.listings.flatMap((listing) => listing.sourceListingId ?? []),
        ...input.skipped.flatMap((item) => item.listingId ?? []),
      ]),
      duplicateKeys: uniqueStrings(input.listings.map((listing) => listing.duplicateKey)),
      groupScopedDuplicateKeys: uniqueStrings(
        input.listings.map((listing) => listing.groupScopedDuplicateKey),
      ),
    },
  };
}

function countSkippedByReason(skipped: DailyLoopSkippedCandidate[]): Record<string, number> {
  return skipped.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    return counts;
  }, {});
}

function identifiersForSource(
  coverage: DailyLoopSourceCoverage,
  listings: ListingCandidate[],
  skipped: DailyLoopSkippedCandidate[],
): AgentRunOperatorEvidence["sourceCoverage"][number]["identifiers"] {
  const sourceListings = listings.filter((listing) => listing.source === coverage.source);
  const sourceSkips = skipped.filter((item) => item.source === coverage.source);
  return {
    sourceUrls: uniqueStrings([
      ...sourceListings.map((listing) => listing.url),
      ...sourceSkips.map((item) => item.sourceUrl),
    ]),
    listingIds: uniqueStrings(sourceListings.map((listing) => listing.id)),
    sourceListingIds: uniqueStrings([
      ...sourceListings.flatMap((listing) => listing.sourceListingId ?? []),
      ...sourceSkips.flatMap((item) => item.listingId ?? []),
    ]),
  };
}

function createSeenMemory(
  groupId: string,
  listings: ListingCandidate[],
  skipped: DailyLoopSkippedCandidate[],
  now: string,
): SeenRejectedMemoryRecord[] {
  return [
    ...listings.map(
      (listing): SeenRejectedMemoryRecord => ({
        id: stableId(`${groupId}:${listing.url}:seen`),
        contract: "seen-rejected-memory-v1",
        groupId,
        sourceUrl: listing.url,
        duplicateKey: createDuplicateKey(listing.url),
        groupScopedDuplicateKey: createGroupScopedDuplicateKey(groupId, listing.url),
        memoryState:
          listing.triageBucket === "rejected"
            ? "rejected"
            : listing.triageBucket === "review-needed"
              ? "downgraded"
              : "seen",
        reason:
          listing.triageBucket === "rejected"
            ? "Daily loop rejected this candidate."
            : "Daily loop processed this candidate.",
        lastSeenAt: now,
      }),
    ),
    ...skipped.map(
      (item): SeenRejectedMemoryRecord => ({
        id: stableId(`${groupId}:${item.sourceUrl}:skipped:${item.reason}`),
        contract: "seen-rejected-memory-v1",
        groupId,
        sourceUrl: item.sourceUrl,
        duplicateKey: createDuplicateKey(item.sourceUrl),
        groupScopedDuplicateKey: createGroupScopedDuplicateKey(groupId, item.sourceUrl),
        memoryState: item.reason === "rejected" ? "rejected" : "seen",
        reason: `Skipped because candidate was already ${item.reason}.`,
        lastSeenAt: now,
      }),
    ),
  ];
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

export function createDailyLoopProviderFailureAnalyzer(
  failureCode = "gemini-fixture-failure",
): GeminiFixtureAnalyzer {
  return (input) => {
    const metadata = {
      ...createAiProviderAttemptMetadata("fit-triage", input.listing.imageEvidence.length),
      status: "failed" as const,
      completedAt: new Date().toISOString(),
      latencyMs: 0,
      imageCount: Math.min(input.listing.imageEvidence.length, MAX_IMAGES_PER_LISTING),
      concurrencyLimit: input.concurrencyLimit,
      concurrencySlot: input.concurrencySlot,
      promptVersion: AI_TRIAGE_SCHEMA_VERSION,
      schemaValidation: "failed" as const,
      failureCode,
    };
    const deterministicTriage = input.output.triage as TriageResult | TriageEvidence | unknown;
    void deterministicTriage;
    return {
      status: "failed" as const,
      triage: {
        ...input.output.triage,
        bucket: input.output.triage.bucket === "rejected" ? "rejected" : "review-needed",
        status: "failed" as const,
        concerns: [
          ...input.output.triage.concerns,
          "Gemini provider failed; manual fallback required.",
        ],
      },
      providerMetadata: metadata,
    };
  };
}

function createGeminiAnalyzerFromEnv(
  env?: DailyLoopEnv,
  fetchImpl: typeof fetch = fetch,
): GeminiFixtureAnalyzer | undefined {
  const apiKey = env?.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  return async (input) => analyzeWithDirectGemini(input, apiKey, fetchImpl);
}

function createGeminiImageEvidenceTextPart(listing: ListingCandidate) {
  return {
    text: JSON.stringify({
      instruction:
        "Capped image evidence for visual inspection. Treat URLs as evidence references if direct image fetching is unavailable.",
      imageCap: MAX_IMAGES_PER_LISTING,
      cappedImageEvidence: listing.imageEvidence.slice(0, MAX_IMAGES_PER_LISTING).map((image) => ({
        url: image.url,
        role: image.role,
      })),
    }),
  };
}

async function analyzeWithDirectGemini(
  input: Parameters<GeminiFixtureAnalyzer>[0],
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<GeminiFixtureAnalysisResult> {
  const started = Date.now();
  const baseMetadata = createAiProviderAttemptMetadata(
    "fit-triage",
    Math.min(input.listing.imageEvidence.length, MAX_IMAGES_PER_LISTING),
  );
  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationConfig: { responseMimeType: "application/json" },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: JSON.stringify({
                    instruction:
                      "Return only JSON matching the existing apartment fit triage schema.",
                    schemaVersion: AI_TRIAGE_SCHEMA_VERSION,
                    candidate: {
                      title: input.listing.title,
                      sourceUrl: input.listing.url,
                      rent: input.listing.rent,
                      bedrooms: input.listing.bedrooms,
                      bathrooms: input.listing.bathrooms,
                      evidence: input.listing.evidence,
                      concerns: input.listing.concerns,
                    },
                    deterministicTriage: input.output.triage,
                  }),
                },
                createGeminiImageEvidenceTextPart(input.listing),
              ],
            },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error(`gemini-http-${response.status}`);
    const payload = await safeJson(response);
    const text = extractGeminiText(payload);
    const parsed = text ? JSON.parse(text) : input.output.triage;
    return {
      status: input.output.status,
      triage: parsed,
      providerMetadata: {
        ...baseMetadata,
        status: "success",
        completedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        imageCount: Math.min(input.listing.imageEvidence.length, MAX_IMAGES_PER_LISTING),
        concurrencyLimit: input.concurrencyLimit,
        concurrencySlot: input.concurrencySlot,
        promptVersion: AI_TRIAGE_SCHEMA_VERSION,
        schemaValidation: "passed",
      },
    };
  } catch (error) {
    return {
      status: "failed",
      triage: input.output.triage,
      providerMetadata: {
        ...baseMetadata,
        status: "failed",
        completedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        imageCount: Math.min(input.listing.imageEvidence.length, MAX_IMAGES_PER_LISTING),
        concurrencyLimit: input.concurrencyLimit,
        concurrencySlot: input.concurrencySlot,
        promptVersion: AI_TRIAGE_SCHEMA_VERSION,
        schemaValidation: "failed",
        failureCode: error instanceof Error ? error.message : "gemini-direct-call-failed",
      },
    };
  }
}

function extractGeminiText(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return undefined;
  const first = payload.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) {
    return undefined;
  }
  const part = first.content.parts.find((item) => isRecord(item) && typeof item.text === "string");
  return isRecord(part) && typeof part.text === "string" ? part.text : undefined;
}

async function persistDailyLoopArtifacts(input: {
  env?: DailyLoopEnv;
  mode: DailyLoopMode;
  run: AgentRunLogRecord;
  coverage: DailyLoopSourceCoverage[];
  listings: ListingCandidate[];
  skipped: DailyLoopSkippedCandidate[];
  sourceEvidence: SourceEvidenceRecord[];
  triageMetadata: ConfidenceTriageMetadata[];
  briefing: BriefingRecord;
  history: BriefingRunHistoryContract;
  seenRejectedMemory: SeenRejectedMemoryRecord[];
  rawArtifactPointers: EvidenceStoragePointer[];
  observability: DailyLoopResult["observability"];
  d1TransitionErrors: string[];
}): Promise<DailyLoopPersistenceOutcome> {
  const d1 = await persistD1(input);
  const r2 = persistRawArtifactsDisabled();
  const kv = await persistKV(input);
  return { d1, r2, kv };
}

async function persistDailyLoopRunTransition(input: {
  env?: DailyLoopEnv;
  mode: DailyLoopMode;
  runId: string;
  groupId: string;
  cadence: Cadence;
  trigger: DailyLoopTrigger;
  status: Extract<RunStatus, "queued" | "running">;
  boundedConcurrency: number;
  startedAt: string;
}): Promise<string | undefined> {
  const db = input.env?.DB;
  if (!db) return undefined;

  try {
    await runD1(
      db,
      "INSERT OR REPLACE INTO daily_loop_runs (id, group_id, cadence, trigger, status, mode, bounded_concurrency, retry_policy_json, counts_json, observability_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      input.runId,
      input.groupId,
      input.cadence,
      input.trigger,
      input.status,
      input.mode,
      input.boundedConcurrency,
      JSON.stringify(DAILY_LOOP_RETRY_POLICY),
      JSON.stringify(createEmptyDailyLoopCounts()),
      JSON.stringify({ statusTransition: input.status }),
      input.startedAt,
      null,
    );
    return undefined;
  } catch (error) {
    return `${input.status}: ${error instanceof Error ? error.message : "d1-transition-failed"}`;
  }
}

function createEmptyDailyLoopCounts(): AgentRunLogRecord["counts"] {
  return {
    candidatesFound: 0,
    candidatesSkippedSeen: 0,
    candidatesSkippedTriaged: 0,
    candidatesAnalyzed: 0,
    candidatesSaved: 0,
    candidatesRejected: 0,
    sourceFailures: 0,
  };
}

async function persistD1(
  input: Parameters<typeof persistDailyLoopArtifacts>[0],
): Promise<DailyLoopPersistenceOutcome["d1"]> {
  const db = input.env?.DB;
  if (!db) return { attempted: false, skippedReason: "missing-binding", rowsWritten: 0 };
  try {
    let rowsWritten = 0;
    await runD1(
      db,
      "INSERT OR REPLACE INTO daily_loop_runs (id, group_id, cadence, trigger, status, mode, bounded_concurrency, retry_policy_json, counts_json, observability_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      input.run.id,
      input.run.groupId,
      input.run.cadence,
      input.run.trigger,
      input.run.status,
      input.mode,
      input.run.boundedConcurrency,
      JSON.stringify(input.run.retryPolicy),
      JSON.stringify(input.run.counts),
      JSON.stringify(input.observability),
      input.run.startedAt,
      input.run.completedAt,
    );
    rowsWritten += 1;
    await runD1(
      db,
      "INSERT OR REPLACE INTO agent_run_logs (id, group_id, cadence, trigger, status, bounded_concurrency, retry_policy_json, counts_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      input.run.id,
      input.run.groupId,
      input.run.cadence,
      input.run.trigger,
      input.run.status,
      input.run.boundedConcurrency,
      JSON.stringify(input.run.retryPolicy),
      JSON.stringify(input.run.counts),
      input.run.startedAt,
      input.run.completedAt,
    );
    rowsWritten += 1;
    for (const unit of input.run.units) {
      await runD1(
        db,
        "INSERT OR REPLACE INTO agent_run_units (id, run_id, source, source_url, listing_id, status, attempt, max_retries, error_code, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        unit.id,
        input.run.id,
        unit.source,
        unit.sourceUrl,
        unit.listingId,
        unit.status,
        unit.attempt,
        unit.maxRetries,
        unit.errorCode,
        unit.startedAt,
        unit.completedAt,
      );
      rowsWritten += 1;
    }
    for (const source of input.coverage) {
      await runD1(
        db,
        "INSERT OR REPLACE INTO daily_loop_sources (id, run_id, group_id, source_key, source, classification, status, checked_count, candidate_count, failure_code, failure_message, query_metadata_json, page_metadata_json, detail_retry_metadata_json, raw_artifact_r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stableId(`${input.run.id}:source:${source.sourceKey}`),
        input.run.id,
        input.run.groupId,
        source.sourceKey,
        source.source,
        source.classification,
        source.status,
        source.checkedCount,
        source.candidateCount,
        source.failureCode,
        source.failureMessage,
        JSON.stringify(source.queryMetadata ?? {}),
        JSON.stringify(source.pageMetadata ?? {}),
        JSON.stringify(source.detailRetryMetadata ?? []),
        input.rawArtifactPointers.find((pointer) => pointer.key.includes(`/${source.source}/`))
          ?.key,
        input.run.completedAt ?? input.run.startedAt,
      );
      rowsWritten += 1;
    }
    for (const listing of input.listings) {
      await runD1(
        db,
        [
          "INSERT INTO app_saved_listings",
          "(id, group_id, url, duplicate_key, group_scoped_duplicate_key, listing_json, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          "ON CONFLICT(id) DO UPDATE SET",
          "url = excluded.url, duplicate_key = excluded.duplicate_key,",
          "group_scoped_duplicate_key = excluded.group_scoped_duplicate_key,",
          "listing_json = excluded.listing_json, updated_at = excluded.updated_at,",
          "revision = app_saved_listings.revision + 1",
        ].join(" "),
        listing.id,
        input.run.groupId,
        listing.url,
        listing.duplicateKey,
        listing.groupScopedDuplicateKey,
        JSON.stringify(listing),
        listing.createdAt,
        listing.updatedAt,
      );
      rowsWritten += 1;
      await runD1(
        db,
        "INSERT INTO listing_candidates (id, group_id, source, url, duplicate_key, submitted_by, title, extraction_status, review_status, address, neighborhood, borough, rent, bedrooms, bathrooms, available_at, description, fit_flags_json, evidence_json, concerns_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source = excluded.source, url = excluded.url, duplicate_key = excluded.duplicate_key, submitted_by = excluded.submitted_by, title = excluded.title, extraction_status = excluded.extraction_status, review_status = excluded.review_status, address = excluded.address, neighborhood = excluded.neighborhood, borough = excluded.borough, rent = excluded.rent, bedrooms = excluded.bedrooms, bathrooms = excluded.bathrooms, available_at = excluded.available_at, description = excluded.description, fit_flags_json = excluded.fit_flags_json, evidence_json = excluded.evidence_json, concerns_json = excluded.concerns_json, updated_at = excluded.updated_at",
        listing.id,
        input.run.groupId,
        listing.source,
        listing.url,
        listing.duplicateKey,
        listing.submittedBy,
        listing.title,
        listing.extractionStatus,
        listing.reviewStatus,
        listing.address,
        listing.neighborhood,
        listing.borough,
        listing.rent,
        listing.bedrooms,
        listing.bathrooms,
        listing.availableAt,
        listing.description,
        JSON.stringify(listing.fitFlags),
        JSON.stringify(listing.evidence),
        JSON.stringify(listing.concerns),
        listing.createdAt,
        listing.updatedAt,
      );
      rowsWritten += 1;
      await runD1(
        db,
        "INSERT OR REPLACE INTO daily_loop_candidates (id, run_id, group_id, listing_id, source, source_url, source_listing_id, duplicate_key, group_scoped_duplicate_key, triage_bucket, triage_status, review_status, material_change_detected, material_change_reasons_json, normalized_candidate_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stableId(`${input.run.id}:candidate:${listing.id}`),
        input.run.id,
        input.run.groupId,
        listing.id,
        listing.source,
        listing.url,
        listing.sourceListingId,
        listing.duplicateKey,
        listing.groupScopedDuplicateKey,
        listing.triageBucket,
        listing.triageStatus,
        listing.reviewStatus,
        input.skipped.some((item) => item.sourceUrl === listing.url && item.materialChangeDetected)
          ? 1
          : 0,
        JSON.stringify(
          input.skipped.find(
            (item) => item.sourceUrl === listing.url && item.materialChangeDetected,
          )?.materialChangeReasons ?? [],
        ),
        JSON.stringify(listing),
        listing.createdAt,
        listing.updatedAt,
      );
      rowsWritten += 1;
      const material = input.skipped.find(
        (item) => item.sourceUrl === listing.url && item.materialChangeDetected,
      );
      await runD1(
        db,
        "INSERT OR REPLACE INTO daily_loop_candidate_status (id, run_id, group_id, source_url, listing_id, status, reason, material_change_detected, material_change_reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stableId(`${input.run.id}:status:${listing.url}:processed`),
        input.run.id,
        input.run.groupId,
        listing.url,
        listing.id,
        material
          ? "material-change-processed"
          : listing.extractionStatus === "failed"
            ? "provider-fallback-review-needed"
            : "processed",
        material
          ? "Processed because material listing details changed."
          : "Daily loop processed candidate.",
        material ? 1 : 0,
        JSON.stringify(material?.materialChangeReasons ?? []),
        input.run.completedAt ?? input.run.startedAt,
      );
      rowsWritten += 1;
    }
    for (const skipped of input.skipped.filter((item) => !item.materialChangeDetected)) {
      await runD1(
        db,
        "INSERT OR REPLACE INTO daily_loop_candidate_status (id, run_id, group_id, source_url, listing_id, status, reason, material_change_detected, material_change_reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stableId(`${input.run.id}:status:${skipped.sourceUrl}:${skipped.reason}`),
        input.run.id,
        input.run.groupId,
        skipped.sourceUrl,
        skipped.listingId,
        `skipped-${skipped.reason}`,
        `Skipped because candidate was already ${skipped.reason}.`,
        0,
        JSON.stringify([]),
        input.run.completedAt ?? input.run.startedAt,
      );
      rowsWritten += 1;
    }
    for (const memory of input.seenRejectedMemory) {
      await runD1(
        db,
        "INSERT OR REPLACE INTO daily_loop_seen_memory (id, group_id, source_url, duplicate_key, group_scoped_duplicate_key, memory_state, reason, last_run_id, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        memory.id,
        memory.groupId,
        memory.sourceUrl,
        memory.duplicateKey,
        memory.groupScopedDuplicateKey,
        memory.memoryState,
        memory.reason,
        input.run.id,
        memory.lastSeenAt,
      );
      rowsWritten += 1;
    }
    for (const evidence of input.sourceEvidence) {
      await runD1(
        db,
        "INSERT OR REPLACE INTO source_evidence_records (id, group_id, listing_id, run_id, source_url, claim, quote, storage_owner, storage_key, content_type, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        evidence.id,
        evidence.groupId,
        evidence.listingId ?? null,
        evidence.runId,
        evidence.sourceUrl,
        evidence.claim,
        evidence.quote,
        evidence.pointer.owner,
        evidence.pointer.key,
        evidence.pointer.contentType,
        evidence.capturedAt,
      );
      rowsWritten += 1;
    }
    for (const triage of input.triageMetadata) {
      await runD1(
        db,
        "INSERT OR REPLACE INTO daily_loop_candidate_status (id, run_id, group_id, source_url, listing_id, status, reason, material_change_detected, material_change_reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stableId(`${input.run.id}:triage:${triage.listingId}`),
        input.run.id,
        triage.groupId,
        input.listings.find((listing) => listing.id === triage.listingId)?.url ?? triage.listingId,
        triage.listingId,
        triage.status === "failed" ? "provider-fallback-review-needed" : "processed",
        `Triage ${triage.bucket} with ${triage.schemaValidationResult} schema validation.`,
        0,
        JSON.stringify([]),
        triage.updatedAt,
      );
      rowsWritten += 1;
    }
    await runD1(
      db,
      "INSERT OR REPLACE INTO daily_loop_briefings (id, run_id, group_id, briefing_record_json, history_contract_json, generated_at) VALUES (?, ?, ?, ?, ?, ?)",
      input.briefing.id,
      input.run.id,
      input.briefing.groupId,
      JSON.stringify(input.briefing),
      JSON.stringify(input.history),
      input.briefing.generatedAt,
    );
    rowsWritten += 1;
    await runD1(
      db,
      "INSERT OR REPLACE INTO briefing_records (id, group_id, run_id, summary, payload_json, generated_at) VALUES (?, ?, ?, ?, ?, ?)",
      input.briefing.id,
      input.briefing.groupId,
      input.run.id,
      input.briefing.summary,
      JSON.stringify(input.briefing),
      input.briefing.generatedAt,
    );
    rowsWritten += 1;
    return input.d1TransitionErrors.length > 0
      ? { attempted: true, rowsWritten, error: input.d1TransitionErrors.join("; ") }
      : { attempted: true, rowsWritten };
  } catch (error) {
    const errors = uniqueStrings([
      ...input.d1TransitionErrors,
      error instanceof Error ? error.message : "d1-write-failed",
    ]);
    return {
      attempted: true,
      rowsWritten: 0,
      error: errors.join("; "),
    };
  }
}

async function runD1(db: DailyLoopD1Binding, sql: string, ...values: unknown[]) {
  await db
    .prepare(sql)
    .bind(...values.map((value) => (value === undefined ? null : value)))
    .run();
}

function persistRawArtifactsDisabled(): DailyLoopPersistenceOutcome["r2"] {
  return { attempted: false, skippedReason: "disabled-no-r2", objectsWritten: 0 };
}

async function persistKV(
  input: Parameters<typeof persistDailyLoopArtifacts>[0],
): Promise<DailyLoopPersistenceOutcome["kv"]> {
  const cache = input.env?.APP_CACHE;
  if (!cache)
    return {
      attempted: false,
      skippedReason: "missing-binding",
      writes: 0,
      authoritative: false,
    };

  try {
    await cache.put(
      `daily-loop:${input.run.groupId}:latest`,
      JSON.stringify({
        runId: input.run.id,
        status: input.run.status,
        sourceFailures: input.run.counts.sourceFailures,
        generatedAt: input.run.completedAt ?? input.run.startedAt,
      }),
      { expirationTtl: 60 * 60 * 24 * 7 },
    );
    return { attempted: true, writes: 1, authoritative: false };
  } catch (error) {
    return {
      attempted: true,
      writes: 0,
      authoritative: false,
      error: error instanceof Error ? error.message : "kv-cache-write-failed",
    };
  }
}

function confidenceForListing(listing: ListingCandidate): ConfidenceScore {
  return {
    realFiveBedroom: listing.bedrooms !== undefined && listing.bedrooms >= 5 ? 0.9 : 0.35,
    twoPlusBathrooms: listing.bathrooms !== undefined && listing.bathrooms >= 2 ? 0.9 : 0.35,
    priceFit: listing.rent !== undefined && listing.rent <= 15000 ? 0.95 : 0.2,
    locationFit: listing.fitFlags.includes("location_fit") ? 0.9 : 0.45,
    overall:
      listing.triageBucket === "confirmed-match"
        ? 0.86
        : listing.triageBucket === "review-needed"
          ? 0.62
          : 0.25,
  };
}

function stableId(value: string): string {
  return `daily-loop-${stableHash(value)}`;
}
