import type {
  AgentRunLogRecord,
  AgentRunOperatorEvidence,
  BriefingRecord,
  BriefingRunHistoryContract,
  ConfidenceTriageMetadata,
  EvidenceStoragePointer,
  SeenRejectedMemoryRecord,
  SourceCoverageSummary,
  SourceEvidenceRecord,
} from "../agent-contracts";
import type { GeminiTriageAnalyzer, StreetEasyBatchInput } from "../extraction";
import {
  MAX_IMAGES_PER_LISTING,
  type AiProviderAttemptMetadata,
  type Cadence,
  type GroupScopedListingState,
  type InviteIdentity,
  type ListingCandidate,
} from "../listings";

/** Shared vocabulary of the daily source loop: contract constants, options, and result shapes. */

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
  streeteasyBatch?: StreetEasyBatchInput;
  existingListings?: ListingCandidate[];
  seenMemory?: SeenRejectedMemoryRecord[];
  priorStates?: GroupScopedListingState[];
  failStreetEasy?: boolean;
  failSecondary?: boolean;
  concurrencyLimit?: number;
  analyzer?: GeminiTriageAnalyzer;
  fetchImpl?: typeof fetch;
};

export type SourceRunSuccess = {
  status: "success";
  coverage: DailyLoopSourceCoverage;
  listings: ListingCandidate[];
  skipped: DailyLoopSkippedCandidate[];
  maxObservedInFlight: number;
  providerMetadata: AiProviderAttemptMetadata[];
};

export type SourceRunFailure = {
  status: "failed";
  coverage: DailyLoopSourceCoverage;
  unit: AgentRunLogRecord["units"][number];
};

export type SourceRunResult = SourceRunSuccess | SourceRunFailure;

export type ExistingCandidateState = {
  reason: DailyLoopSkipReason;
  listing?: ListingCandidate;
  memory?: SeenRejectedMemoryRecord;
  state?: GroupScopedListingState;
};
