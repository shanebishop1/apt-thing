import type {
  AiProviderAttemptMetadata,
  Cadence,
  EvidencePointer,
  ListingCandidate,
  ReviewStatus,
  RunStatus,
  SourceType,
  TriageBucket,
  TriageStatus,
} from "./listings";
import { withDefined } from "./utils/records";

export type EvidenceStoragePointer = {
  owner: "d1" | "r2";
  key: string;
  contentType?: "application/json" | "text/html" | "image/jpeg" | "image/png" | "text/plain";
  groupScoped: true;
};

export type SourceEvidenceRecord = {
  id: string;
  contract: "source-evidence-v1";
  groupId: string;
  listingId?: string;
  runId?: string;
  sourceUrl: string;
  claim: string;
  quote: string;
  pointer: EvidenceStoragePointer;
  capturedAt: string;
};

export type ConfidenceScore = {
  realFiveBedroom: number;
  twoPlusBathrooms: number;
  priceFit: number;
  locationFit: number;
  overall: number;
};

export type ConfidenceTriageMetadata = {
  contract: "confidence-triage-v1";
  groupId: string;
  listingId: string;
  bucket: Exclude<TriageBucket, "untriaged">;
  status: TriageStatus;
  confidence: ConfidenceScore;
  reasons: string[];
  concerns: string[];
  deterministicHardConstraintResult: "passed" | "review-needed" | "failed";
  schemaValidationResult: "passed" | "failed";
  promptVersion?: string;
  updatedAt: string;
};

export type GroupActionRecord = {
  id: string;
  contract: "group-action-v1";
  groupId: string;
  listingId: string;
  actorDisplayName: string;
  actorIdentityToken?: string;
  actor?: {
    displayName: string;
    identityToken?: string;
  };
  actionType: "comment" | "reaction" | "status-change" | "source-link-open" | "feedback";
  commentBody?: string;
  reaction?: "thumbs-up" | "thumbs-down" | "tour" | "question";
  status?: ReviewStatus;
  sourceUrl?: string;
  provenance?: {
    source:
      | "user-entered"
      | "shared-status-control"
      | "original-listing-source-link"
      | "evidence-feedback"
      | "fixture";
    visibleToGroup?: boolean;
    evidencePointerIds?: string[];
    sourceEvidenceIds?: string[];
  };
  feedback?: {
    category: "evidence" | "fit" | "status" | "location" | "price" | "other";
    summary?: string;
    reason?: string;
    disagreement: boolean;
    target?: "hard-constraint" | "shared-status" | "source-evidence" | "ai-summary";
    sourceEvidenceIds?: string[];
    doesNotMutateRanking: true;
  };
  createdAt: string;
};

export type SeenRejectedMemoryRecord = {
  id: string;
  contract: "seen-rejected-memory-v1";
  groupId: string;
  sourceUrl: string;
  duplicateKey: string;
  groupScopedDuplicateKey: string;
  memoryState: "seen" | "rejected" | "downgraded";
  reason: string;
  lastSeenAt: string;
};

export type RunUnitLogRecord = {
  id: string;
  source: "streeteasy" | "zillow" | "gemini" | "manual" | "other";
  sourceUrl?: string;
  listingId?: string;
  status: "queued" | "running" | "success" | "failed" | "skipped-seen" | "skipped-triaged";
  attempt: number;
  maxRetries: number;
  errorCode?: string;
  startedAt?: string;
  completedAt?: string;
};

export type AgentRunOperatorEvidence = {
  runId: string;
  groupId: string;
  cadence: Cadence;
  trigger: "manual" | "cron" | "fixture";
  mode?: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  retryPolicy: {
    maxRetries: number;
    retryDelayMs: number;
  };
  candidateCounts: {
    found: number;
    skippedSeen: number;
    skippedSaved: number;
    skippedRejected: number;
    skippedTriaged: number;
    skippedTotal: number;
    triaged: number;
    saved: number;
    rejected: number;
    confirmedMatches: number;
    reviewNeeded: number;
    sourceFailures: number;
  };
  sourceCoverage: Array<
    SourceCoverageSummary & {
      sourceKey?: string;
      classification?: string;
      queryMetadata?: Record<string, unknown>;
      pageMetadata?: Record<string, unknown>;
      detailRetryMetadata?: Array<Record<string, unknown>>;
      identifiers: {
        sourceUrls: string[];
        listingIds: string[];
        sourceListingIds: string[];
      };
    }
  >;
  failures: Array<{
    sourceKey?: string;
    source: string;
    status: SourceCoverageSummary["status"];
    failureCode?: string;
    failureMessage?: string;
  }>;
  skips: {
    byReason: Record<string, number>;
    candidates: Array<{
      source: string;
      sourceUrl: string;
      listingId?: string;
      reason: string;
      materialChangeDetected: boolean;
      materialChangeReasons: string[];
    }>;
  };
  retryAttempts: RunUnitLogRecord[];
  detailRetries: Array<Record<string, unknown>>;
  providerAttempts: AiProviderAttemptMetadata[];
  artifactPointers: EvidenceStoragePointer[];
  candidateIdentifiers: Array<{
    listingId: string;
    sourceListingId?: string;
    source: SourceType;
    sourceUrl: string;
    duplicateKey: string;
    groupScopedDuplicateKey: string;
    bucket: Exclude<TriageBucket, "untriaged"> | "untriaged";
    triageStatus: TriageStatus;
    reviewStatus: ReviewStatus;
  }>;
  debugIdentifiers: {
    runId: string;
    groupId: string;
    sourceKeys: string[];
    sourceUrls: string[];
    listingIds: string[];
    sourceListingIds: string[];
    duplicateKeys: string[];
    groupScopedDuplicateKeys: string[];
  };
};

export type AgentRunLogRecord = {
  id: string;
  contract: "agent-run-log-v1";
  groupId: string;
  cadence: Cadence;
  trigger: "manual" | "cron" | "fixture";
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  counts: {
    candidatesFound: number;
    candidatesSkippedSeen: number;
    candidatesSkippedTriaged?: number;
    candidatesAnalyzed: number;
    candidatesSaved: number;
    candidatesRejected: number;
    sourceFailures: number;
  };
  boundedConcurrency: number;
  retryPolicy: {
    maxRetries: number;
    retryDelayMs: number;
  };
  units: RunUnitLogRecord[];
  operatorEvidence?: AgentRunOperatorEvidence;
};

export type BriefingRecord = {
  id: string;
  contract: "briefing-record-v1";
  groupId: string;
  runId: string;
  generatedAt: string;
  bestNewListingIds: string[];
  reviewNeededListingIds: string[];
  rejectedListingIds: string[];
  summary: string;
  whatChanged: string[];
  sourceCoverage: Array<{
    source: string;
    status: "success" | "partial" | "failed";
    checkedCount: number;
    failureCode?: string;
  }>;
  skippedSeenCount: number;
  recommendationRationale: string[];
  suggestedNextActions: string[];
};

export type CandidateEvidenceConfidenceSummary = {
  confidence: ConfidenceScore;
  reasons: string[];
  concerns: string[];
  evidenceQuotes: string[];
  sourceLinks: string[];
  rawArtifactPointers: EvidenceStoragePointer[];
};

export type BriefingCandidateSummary = {
  listingId: string;
  sourceUrl: string;
  source: SourceType;
  title: string;
  bucket: Exclude<TriageBucket, "untriaged">;
  triageStatus: TriageStatus;
  reviewStatus: ReviewStatus;
  providerRoute: ListingCandidate["providerRoute"];
  evidenceSummary: CandidateEvidenceConfidenceSummary;
  memoryState?: SeenRejectedMemoryRecord["memoryState"];
  suggestedAction: string;
};

export type SourceCoverageSummary = {
  source: string;
  status: "success" | "partial" | "failed";
  checkedCount: number;
  candidateCount: number;
  failureCode?: string;
  failureMessage?: string;
  rawArtifactPointers: EvidenceStoragePointer[];
};

export type BriefingRunHistoryCounts = {
  candidatesFound: number;
  candidatesSkippedSeen: number;
  candidatesSkippedTriaged: number;
  candidatesTriaged: number;
  confirmedMatches: number;
  reviewNeeded: number;
  rejected: number;
  sourceFailures: number;
};

export type BriefingRunHistoryRun = {
  runId: string;
  cadence: Cadence;
  trigger: AgentRunLogRecord["trigger"];
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  counts: BriefingRunHistoryCounts;
  sourceCoverage: SourceCoverageSummary[];
  candidateSummaries: BriefingCandidateSummary[];
  providerMetadata: AiProviderAttemptMetadata[];
  rawArtifactPointers: EvidenceStoragePointer[];
  operatorEvidence?: AgentRunOperatorEvidence;
};

export type FeedbackSummary = {
  listingId: string;
  sourceUrl: string;
  commentCount: number;
  reactionCount: number;
  statusChangeCount: number;
  disagreementCount: number;
  summaries: string[];
  doesNotMutateRanking: true;
};

export type LatestBriefingSummary = {
  id: string;
  runId: string;
  generatedAt: string;
  summary: string;
  bestNewListingIds: string[];
  reviewNeededListingIds: string[];
  rejectedListingIds: string[];
  whatChanged: string[];
  sourceCoverage: SourceCoverageSummary[];
  skippedSeenCount: number;
  evidenceConfidenceSummaries: CandidateEvidenceConfidenceSummary[];
  recommendationRationale: string[];
  suggestedActions: string[];
};

export type BriefingRunHistoryContract = {
  contract: "briefing-run-history-v1";
  schemaVersion: "briefing-run-history-v1";
  groupId: string;
  generatedAt: string;
  supportedCadences: Cadence[];
  latestRun: BriefingRunHistoryRun;
  runs: BriefingRunHistoryRun[];
  latestBriefing: LatestBriefingSummary;
  seenRejectedMemory: SeenRejectedMemoryRecord[];
  feedbackSummaries: FeedbackSummary[];
};

export function validateBriefingRunHistoryContract(history: BriefingRunHistoryContract): string[] {
  const errors: string[] = [];
  const latestRun = history.latestRun;
  const candidateById = new Map(
    latestRun?.candidateSummaries.map((candidate) => [candidate.listingId, candidate]) ?? [],
  );
  const coverageBySource = new Map(
    latestRun?.sourceCoverage.map((coverage) => [coverage.source, coverage]) ?? [],
  );

  requireNonEmpty(errors, history.groupId, "history.groupId");
  requireIsoTimestamp(errors, history.generatedAt, "history.generatedAt");
  if (history.contract !== "briefing-run-history-v1") {
    errors.push("history.contract must be briefing-run-history-v1");
  }
  if (history.schemaVersion !== "briefing-run-history-v1") {
    errors.push("history.schemaVersion must be briefing-run-history-v1");
  }
  if (
    !history.supportedCadences.includes("daily") ||
    !history.supportedCadences.includes("hourly")
  ) {
    errors.push("history.supportedCadences must include daily and future-compatible hourly");
  }
  if (!history.runs.some((run) => run.runId === latestRun.runId)) {
    errors.push("history.runs must include latestRun");
  }

  errors.push(...validateRunHistoryRun(latestRun, "history.latestRun", history.groupId));
  for (const [index, run] of history.runs.entries()) {
    errors.push(...validateRunHistoryRun(run, `history.runs.${index}`, history.groupId));
  }
  errors.push(
    ...validateLatestBriefing(history.latestBriefing, history, candidateById, coverageBySource),
  );
  for (const [index, record] of history.seenRejectedMemory.entries()) {
    errors.push(
      ...validateSeenRejectedMemory(record, `history.seenRejectedMemory.${index}`, history.groupId),
    );
  }
  for (const [index, summary] of history.feedbackSummaries.entries()) {
    errors.push(
      ...validateFeedbackSummary(summary, `history.feedbackSummaries.${index}`, candidateById),
    );
  }

  return errors;
}

export function evidencePointerToSourceEvidenceRecord({
  pointer,
  sourceUrl,
  claim,
  quote,
}: {
  pointer: EvidencePointer;
  sourceUrl: string;
  claim: string;
  quote: string;
}): SourceEvidenceRecord {
  return withDefined<SourceEvidenceRecord>({
    id: `source-evidence-${pointer.id}`,
    contract: "source-evidence-v1",
    groupId: pointer.groupId,
    listingId: pointer.listingId,
    runId: pointer.runId,
    sourceUrl,
    claim,
    quote,
    pointer: {
      owner: pointer.storage.owner === "r2" ? "r2" : "d1",
      key: pointer.r2Key ?? `${pointer.d1Table ?? "listing_evidence"}:${pointer.id}`,
      contentType: "application/json",
      groupScoped: true,
    },
    capturedAt: pointer.capturedAt,
  });
}

function validateSeenRejectedMemory(
  record: SeenRejectedMemoryRecord,
  path: string,
  expectedGroupId?: string,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, record.id, `${path}.id`);
  requireNonEmpty(errors, record.groupId, `${path}.groupId`);
  requireHttpUrl(errors, record.sourceUrl, `${path}.sourceUrl`);
  requireNonEmpty(errors, record.reason, `${path}.reason`);
  requireIsoTimestamp(errors, record.lastSeenAt, `${path}.lastSeenAt`);

  if (expectedGroupId && record.groupId !== expectedGroupId) {
    errors.push(`${path}.groupId must match bundle.groupId`);
  }
  if (!record.groupScopedDuplicateKey.startsWith(`${record.groupId}:`)) {
    errors.push(`${path}.groupScopedDuplicateKey must start with groupId`);
  }

  return errors;
}

function validateRunHistoryRun(
  run: BriefingRunHistoryRun,
  path: string,
  groupId: string,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, run.runId, `${path}.runId`);
  requireIsoTimestamp(errors, run.startedAt, `${path}.startedAt`);
  if (run.completedAt) {
    requireIsoTimestamp(errors, run.completedAt, `${path}.completedAt`);
  }
  if (run.counts.candidatesTriaged !== run.candidateSummaries.length) {
    errors.push(`${path}.counts.candidatesTriaged must match candidateSummaries length`);
  }
  if (
    run.counts.sourceFailures !==
    run.sourceCoverage.filter((source) => source.status === "failed").length
  ) {
    errors.push(`${path}.counts.sourceFailures must match failed source coverage`);
  }
  if (run.sourceCoverage.length === 0) {
    errors.push(`${path}.sourceCoverage must include checked sources`);
  }
  for (const [index, summary] of run.candidateSummaries.entries()) {
    errors.push(
      ...validateBriefingCandidateSummary(summary, `${path}.candidateSummaries.${index}`),
    );
  }
  for (const [index, coverage] of run.sourceCoverage.entries()) {
    errors.push(...validateSourceCoverage(coverage, `${path}.sourceCoverage.${index}`, groupId));
  }
  for (const [index, metadata] of run.providerMetadata.entries()) {
    errors.push(...validateProviderMetadata(metadata, `${path}.providerMetadata.${index}`));
  }
  for (const [index, pointer] of run.rawArtifactPointers.entries()) {
    errors.push(
      ...validateStoragePointer(pointer, `${path}.rawArtifactPointers.${index}`, groupId),
    );
  }

  return errors;
}

function validateBriefingCandidateSummary(
  summary: BriefingCandidateSummary,
  path: string,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, summary.listingId, `${path}.listingId`);
  requireHttpUrl(errors, summary.sourceUrl, `${path}.sourceUrl`);
  requireNonEmpty(errors, summary.title, `${path}.title`);
  requireNonEmpty(errors, summary.suggestedAction, `${path}.suggestedAction`);
  for (const [scoreName, score] of Object.entries(summary.evidenceSummary.confidence)) {
    if (score < 0 || score > 1) {
      errors.push(`${path}.evidenceSummary.confidence.${scoreName} must be between 0 and 1`);
    }
  }
  if (summary.evidenceSummary.evidenceQuotes.length === 0) {
    errors.push(`${path}.evidenceSummary.evidenceQuotes must include source-backed evidence`);
  }
  if (summary.evidenceSummary.sourceLinks.length === 0) {
    errors.push(`${path}.evidenceSummary.sourceLinks must include source URLs`);
  }

  return errors;
}

function validateSourceCoverage(
  coverage: SourceCoverageSummary,
  path: string,
  groupId: string,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, coverage.source, `${path}.source`);
  if (coverage.checkedCount < 0 || coverage.candidateCount < 0) {
    errors.push(`${path}.checkedCount and candidateCount must be non-negative`);
  }
  if (coverage.status === "failed" && !coverage.failureCode) {
    errors.push(`${path}.failureCode is required for failed source coverage`);
  }
  for (const [index, pointer] of coverage.rawArtifactPointers.entries()) {
    errors.push(
      ...validateStoragePointer(pointer, `${path}.rawArtifactPointers.${index}`, groupId),
    );
  }

  return errors;
}

function validateProviderMetadata(metadata: AiProviderAttemptMetadata, path: string): string[] {
  const errors: string[] = [];

  if (metadata.provider !== "google-direct") {
    errors.push(`${path}.provider must be google-direct`);
  }
  if (metadata.model !== "gemini-3.5-flash") {
    errors.push(`${path}.model must be gemini-3.5-flash`);
  }
  if (metadata.apiKeyEnv !== "GEMINI_API_KEY") {
    errors.push(`${path}.apiKeyEnv must be GEMINI_API_KEY`);
  }
  requireNonEmpty(errors, metadata.attemptId, `${path}.attemptId`);
  requireIsoTimestamp(errors, metadata.startedAt, `${path}.startedAt`);
  if (metadata.completedAt) {
    requireIsoTimestamp(errors, metadata.completedAt, `${path}.completedAt`);
  }

  return errors;
}

function validateLatestBriefing(
  briefing: LatestBriefingSummary,
  history: BriefingRunHistoryContract,
  candidateById: Map<string, BriefingCandidateSummary>,
  coverageBySource: Map<string, SourceCoverageSummary>,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, briefing.id, "history.latestBriefing.id");
  requireNonEmpty(errors, briefing.runId, "history.latestBriefing.runId");
  requireNonEmpty(errors, briefing.summary, "history.latestBriefing.summary");
  requireIsoTimestamp(errors, briefing.generatedAt, "history.latestBriefing.generatedAt");
  if (briefing.runId !== history.latestRun.runId) {
    errors.push("history.latestBriefing.runId must match latestRun.runId");
  }
  for (const [field, ids] of Object.entries({
    bestNewListingIds: briefing.bestNewListingIds,
    reviewNeededListingIds: briefing.reviewNeededListingIds,
    rejectedListingIds: briefing.rejectedListingIds,
  })) {
    for (const [index, id] of ids.entries()) {
      if (!candidateById.has(id)) {
        errors.push(`history.latestBriefing.${field}.${index} must reference candidateSummaries`);
      }
    }
  }
  for (const [index, coverage] of briefing.sourceCoverage.entries()) {
    const sourceCoverage = coverageBySource.get(coverage.source);
    if (!sourceCoverage || sourceCoverage.status !== coverage.status) {
      errors.push(
        `history.latestBriefing.sourceCoverage.${index} must match latestRun source coverage`,
      );
    }
  }
  if (briefing.suggestedActions.length === 0) {
    errors.push("history.latestBriefing.suggestedActions must include at least one action");
  }

  return errors;
}

function validateFeedbackSummary(
  summary: FeedbackSummary,
  path: string,
  candidateById: Map<string, BriefingCandidateSummary>,
): string[] {
  const errors: string[] = [];
  const candidate = candidateById.get(summary.listingId);

  if (!candidate) {
    errors.push(`${path}.listingId must reference a candidate in briefing history`);
  }
  requireHttpUrl(errors, summary.sourceUrl, `${path}.sourceUrl`);
  if (candidate && candidate.sourceUrl !== summary.sourceUrl) {
    errors.push(`${path}.sourceUrl must match candidate sourceUrl`);
  }
  if (summary.doesNotMutateRanking !== true) {
    errors.push(`${path}.doesNotMutateRanking must remain true for MVP`);
  }

  return errors;
}

function validateStoragePointer(
  pointer: EvidenceStoragePointer,
  path: string,
  groupId: string,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, pointer.key, `${path}.key`);
  if (pointer.groupScoped !== true) {
    errors.push(`${path}.groupScoped must be true`);
  }
  if (pointer.owner === "r2" && !pointer.key.includes(groupId)) {
    errors.push(`${path}.key must include groupId for R2 ownership`);
  }

  return errors;
}

function requireNonEmpty(errors: string[], value: string | undefined, path: string): void {
  if (!value || value.trim().length === 0) {
    errors.push(`${path} is required`);
  }
}

function requireHttpUrl(errors: string[], value: string | undefined, path: string): void {
  if (!value) {
    errors.push(`${path} is required`);
    return;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push(`${path} must be an http(s) URL`);
    }
  } catch {
    errors.push(`${path} must be a valid URL`);
  }
}

function requireIsoTimestamp(errors: string[], value: string | undefined, path: string): void {
  if (!value || Number.isNaN(Date.parse(value))) {
    errors.push(`${path} must be an ISO timestamp`);
  }
}
