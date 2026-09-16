import type {
  AiProviderAttemptMetadata,
  Cadence,
  EvidencePointer,
  InviteIdentity,
  ListingCandidate,
  ReviewStatus,
  RunStatus,
  SourceType,
  TriageBucket,
  TriageStatus,
} from "./listings";

export type StableContractName =
  | "listing-candidate-v1"
  | "source-evidence-v1"
  | "confidence-triage-v1"
  | "group-access-v1"
  | "group-action-v1"
  | "seen-rejected-memory-v1"
  | "agent-run-log-v1"
  | "briefing-record-v1"
  | "g3c-briefing-run-history-v1"
  | "gemini-briefing-draft-v1"
  | "gemini-provider-metadata-v1"
  | "cloudflare-binding-proof-v1"
  | "scheduled-workflow-fanout-v1";

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

export type GroupAccessRecord = {
  id: string;
  contract: "group-access-v1";
  groupId: string;
  /** Invite codes are verified server-side against GROUP_INVITE_CODES and never recorded. */
  credentialSource: "server-configured-invite";
  resolvedFrom: "invite-code" | "invite-link";
  actorDisplayName: string;
  actorIdentityToken: string;
  identityPersistence: "localStorage";
  createdAt: string;
};

export function groupAccessRecordFromIdentity({
  identity,
  resolvedFrom,
  createdAt,
}: {
  identity: InviteIdentity;
  resolvedFrom: GroupAccessRecord["resolvedFrom"];
  inviteUrl?: string;
  createdAt: string;
}): GroupAccessRecord {
  return {
    id: `group-access-${identity.groupId}-${identity.identityToken}`,
    contract: "group-access-v1",
    groupId: identity.groupId,
    credentialSource: "server-configured-invite",
    resolvedFrom,
    actorDisplayName: identity.displayName,
    actorIdentityToken: identity.identityToken,
    identityPersistence: "localStorage",
    createdAt,
  };
}

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
  contract: "g3c-briefing-run-history-v1";
  schemaVersion: "g3c-briefing-run-history-v1";
  groupId: string;
  generatedAt: string;
  supportedCadences: Cadence[];
  latestRun: BriefingRunHistoryRun;
  runs: BriefingRunHistoryRun[];
  latestBriefing: LatestBriefingSummary;
  seenRejectedMemory: SeenRejectedMemoryRecord[];
  feedbackSummaries: FeedbackSummary[];
};

export const GEMINI_BRIEFING_SCHEMA_VERSION = "g3c-gemini-briefing-draft-v1" as const;

export type GeminiBriefingDraftContract = {
  contract: "gemini-briefing-draft-v1";
  schemaVersion: typeof GEMINI_BRIEFING_SCHEMA_VERSION;
  groupId: string;
  runId: string;
  generatedAt: string;
  summary: string;
  listingReferences: Array<{
    listingId: string;
    sourceUrl: string;
    rationale: string;
    evidenceClaims: string[];
  }>;
  sourceCoverageClaims: Array<{
    source: string;
    status: SourceCoverageSummary["status"];
    checkedCount: number;
    failureCode?: string;
  }>;
  suggestedActions: string[];
  providerMetadata: AiProviderAttemptMetadata;
  rawArtifactPointers: EvidenceStoragePointer[];
};

export type SharedAgentContractFixtureBundle = {
  contract: "g2b-shared-agent-contract-fixtures-v1";
  generatedAt: string;
  groupId: string;
  groupAccess: GroupAccessRecord[];
  listingCandidates: {
    pastedIntake: ListingCandidate;
    streetEasyBatchCandidate: ListingCandidate;
    confirmedMatch: ListingCandidate;
    reviewNeeded: ListingCandidate;
    rejectedDowngraded: ListingCandidate;
  };
  sourceEvidence: SourceEvidenceRecord[];
  triageMetadata: ConfidenceTriageMetadata[];
  groupActions: GroupActionRecord[];
  seenRejectedMemory: SeenRejectedMemoryRecord[];
  runLogs: AgentRunLogRecord[];
  briefingRecords: BriefingRecord[];
};

export const G2B_STABLE_CONTRACTS: Record<StableContractName, string> = {
  "listing-candidate-v1":
    "src/lib/listings.ts ListingCandidate with groupId, source URL, evidence pointers, triage, review status, and timestamps.",
  "source-evidence-v1":
    "src/lib/agent-contracts.ts SourceEvidenceRecord with D1/R2 pointer ownership and source quotes.",
  "confidence-triage-v1":
    "src/lib/agent-contracts.ts ConfidenceTriageMetadata for G2C bucket/rubric convergence.",
  "group-access-v1":
    "src/lib/agent-contracts.ts GroupAccessRecord for invite-link resolution and localStorage identity persistence.",
  "group-action-v1":
    "src/lib/agent-contracts.ts GroupActionRecord for G3B comments, reactions, source-link opens, feedback, and shared statuses.",
  "seen-rejected-memory-v1":
    "src/lib/agent-contracts.ts SeenRejectedMemoryRecord keyed by groupId plus duplicate URL key.",
  "agent-run-log-v1":
    "src/lib/agent-contracts.ts AgentRunLogRecord with source failure isolation and bounded concurrency metadata.",
  "briefing-record-v1":
    "src/lib/agent-contracts.ts BriefingRecord for legacy G2B run summary and next-action output.",
  "g3c-briefing-run-history-v1":
    "src/lib/agent-contracts.ts BriefingRunHistoryContract for G3C in-app briefing, run history, memory, feedback, and raw artifact summaries.",
  "gemini-briefing-draft-v1":
    "src/lib/agent-contracts.ts GeminiBriefingDraftContract deterministic validation guard for direct Gemini briefing output.",
  "gemini-provider-metadata-v1":
    "src/lib/gemini.ts GeminiProviderMetadata with google-direct/gemini-3.5-flash and schema validation.",
  "cloudflare-binding-proof-v1":
    "src/lib/platform-proof.ts runCloudflareBindingProof D1/R2/KV smoke contract.",
  "scheduled-workflow-fanout-v1":
    "src/lib/workflow-queue.ts simulateScheduledWorkflowFanout queue-compatible contract.",
};

export function validateSharedAgentContractBundle(
  bundle: SharedAgentContractFixtureBundle,
): string[] {
  const listings = Object.values(bundle.listingCandidates ?? {});
  const listingIds = new Set(listings.map((listing) => listing.id));
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));

  return [
    ...validateBundleHeader(bundle),
    ...(bundle.groupAccess ?? []).flatMap((record, index) =>
      validateGroupAccess(record, `groupAccess.${index}`, bundle.groupId),
    ),
    ...Object.entries(bundle.listingCandidates ?? {}).flatMap(([fixtureName, listing]) =>
      validateListingCandidateContract(listing, `listingCandidates.${fixtureName}`, bundle.groupId),
    ),
    ...(bundle.sourceEvidence ?? []).flatMap((record, index) =>
      validateSourceEvidenceRecord(record, `sourceEvidence.${index}`, bundle.groupId, listingIds),
    ),
    ...(bundle.triageMetadata ?? []).flatMap((record, index) =>
      validateTriageMetadata(record, `triageMetadata.${index}`, bundle.groupId, listingIds),
    ),
    ...(bundle.groupActions ?? []).flatMap((record, index) =>
      validateGroupAction(record, `groupActions.${index}`, bundle.groupId, listingById),
    ),
    ...(bundle.seenRejectedMemory ?? []).flatMap((record, index) =>
      validateSeenRejectedMemory(record, `seenRejectedMemory.${index}`, bundle.groupId),
    ),
    ...(bundle.runLogs ?? []).flatMap((record, index) =>
      validateRunLog(record, `runLogs.${index}`, bundle.groupId),
    ),
    ...(bundle.briefingRecords ?? []).flatMap((record, index) =>
      validateBriefing(record, `briefingRecords.${index}`, bundle.groupId, listingIds),
    ),
  ];
}

export function validateListingCandidateContract(
  listing: ListingCandidate,
  path = "listingCandidate",
  expectedGroupId?: string,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, listing.id, `${path}.id`);
  requireNonEmpty(errors, listing.groupId, `${path}.groupId`);
  requireHttpUrl(errors, listing.url, `${path}.url`);
  requireNonEmpty(errors, listing.title, `${path}.title`);
  requireIsoTimestamp(errors, listing.createdAt, `${path}.createdAt`);
  requireIsoTimestamp(errors, listing.updatedAt, `${path}.updatedAt`);

  if (expectedGroupId && listing.groupId !== expectedGroupId) {
    errors.push(`${path}.groupId must match bundle.groupId`);
  }
  if (!listing.groupScopedDuplicateKey.startsWith(`${listing.groupId}:`)) {
    errors.push(`${path}.groupScopedDuplicateKey must start with groupId`);
  }
  if (listing.evidencePointers.some((pointer) => pointer.groupId !== listing.groupId)) {
    errors.push(`${path}.evidencePointers must preserve listing groupId`);
  }

  return errors;
}

export function validateSourceEvidenceRecord(
  record: SourceEvidenceRecord,
  path = "sourceEvidence",
  expectedGroupId?: string,
  listingIds?: Set<string>,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, record.id, `${path}.id`);
  requireNonEmpty(errors, record.groupId, `${path}.groupId`);
  requireHttpUrl(errors, record.sourceUrl, `${path}.sourceUrl`);
  requireNonEmpty(errors, record.claim, `${path}.claim`);
  requireNonEmpty(errors, record.quote, `${path}.quote`);
  requireNonEmpty(errors, record.pointer.key, `${path}.pointer.key`);
  requireIsoTimestamp(errors, record.capturedAt, `${path}.capturedAt`);
  validateStoragePointer(record.pointer, `${path}.pointer`, record.groupId).forEach((error) =>
    errors.push(error),
  );

  if (expectedGroupId && record.groupId !== expectedGroupId) {
    errors.push(`${path}.groupId must match bundle.groupId`);
  }
  if (record.listingId && listingIds && !listingIds.has(record.listingId)) {
    errors.push(`${path}.listingId must reference a listing in the same bundle group`);
  }

  return errors;
}

export function validateTriageMetadata(
  record: ConfidenceTriageMetadata,
  path = "triageMetadata",
  expectedGroupId?: string,
  listingIds?: Set<string>,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, record.groupId, `${path}.groupId`);
  requireNonEmpty(errors, record.listingId, `${path}.listingId`);
  requireIsoTimestamp(errors, record.updatedAt, `${path}.updatedAt`);

  if (expectedGroupId && record.groupId !== expectedGroupId) {
    errors.push(`${path}.groupId must match bundle.groupId`);
  }
  if (listingIds && !listingIds.has(record.listingId)) {
    errors.push(`${path}.listingId must reference a listing in the same bundle group`);
  }
  for (const [scoreName, score] of Object.entries(record.confidence)) {
    if (score < 0 || score > 1) {
      errors.push(`${path}.confidence.${scoreName} must be between 0 and 1`);
    }
  }

  return errors;
}

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
  if (history.contract !== "g3c-briefing-run-history-v1") {
    errors.push("history.contract must be g3c-briefing-run-history-v1");
  }
  if (history.schemaVersion !== "g3c-briefing-run-history-v1") {
    errors.push("history.schemaVersion must be g3c-briefing-run-history-v1");
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

export function validateGeminiBriefingDraftContract(
  draft: GeminiBriefingDraftContract,
  history: BriefingRunHistoryContract,
): string[] {
  const errors: string[] = [];
  const candidateById = new Map(
    history.latestRun.candidateSummaries.map((candidate) => [candidate.listingId, candidate]),
  );
  const coverageBySource = new Map(
    history.latestRun.sourceCoverage.map((coverage) => [coverage.source, coverage]),
  );

  if (draft.contract !== "gemini-briefing-draft-v1") {
    errors.push("geminiDraft.contract must be gemini-briefing-draft-v1");
  }
  if (draft.schemaVersion !== GEMINI_BRIEFING_SCHEMA_VERSION) {
    errors.push(`geminiDraft.schemaVersion must be ${GEMINI_BRIEFING_SCHEMA_VERSION}`);
  }
  if (draft.groupId !== history.groupId) {
    errors.push("geminiDraft.groupId must match briefing history groupId");
  }
  if (draft.runId !== history.latestRun.runId) {
    errors.push("geminiDraft.runId must match latest briefing runId");
  }
  requireIsoTimestamp(errors, draft.generatedAt, "geminiDraft.generatedAt");
  requireNonEmpty(errors, draft.summary, "geminiDraft.summary");
  validateProviderMetadata(
    draft.providerMetadata,
    "geminiDraft.providerMetadata",
    "briefing",
  ).forEach((error) => errors.push(error));

  for (const [index, ref] of draft.listingReferences.entries()) {
    const path = `geminiDraft.listingReferences.${index}`;
    const candidate = candidateById.get(ref.listingId);
    if (!candidate) {
      errors.push(`${path}.listingId must reference a candidate in briefing history`);
    } else {
      if (ref.sourceUrl !== candidate.sourceUrl) {
        errors.push(`${path}.sourceUrl must match referenced candidate sourceUrl`);
      }
      const allowedClaims = new Set([
        ...candidate.evidenceSummary.evidenceQuotes,
        ...candidate.evidenceSummary.reasons,
        ...candidate.evidenceSummary.concerns,
      ]);
      for (const [claimIndex, claim] of ref.evidenceClaims.entries()) {
        if (!allowedClaims.has(claim)) {
          errors.push(
            `${path}.evidenceClaims.${claimIndex} must come from recorded evidence/confidence facts`,
          );
        }
      }
    }
  }

  for (const [index, claim] of draft.sourceCoverageClaims.entries()) {
    const path = `geminiDraft.sourceCoverageClaims.${index}`;
    const coverage = coverageBySource.get(claim.source);
    if (!coverage) {
      errors.push(`${path}.source must match checked source coverage`);
      if (claim.failureCode) {
        errors.push(`${path}.failureCode must match the recorded source failure`);
      }
      continue;
    }
    if (claim.status !== coverage.status) {
      errors.push(`${path}.status must match recorded source coverage status`);
    }
    if (claim.checkedCount !== coverage.checkedCount) {
      errors.push(`${path}.checkedCount must match recorded source coverage count`);
    }
    if ((claim.failureCode ?? "") !== (coverage.failureCode ?? "")) {
      errors.push(`${path}.failureCode must match the recorded source failure`);
    }
  }
  if (draft.suggestedActions.length === 0) {
    errors.push("geminiDraft.suggestedActions must include at least one action");
  }
  for (const [index, pointer] of draft.rawArtifactPointers.entries()) {
    errors.push(
      ...validateStoragePointer(
        pointer,
        `geminiDraft.rawArtifactPointers.${index}`,
        history.groupId,
      ),
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
  return {
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
  };
}

function validateBundleHeader(bundle: SharedAgentContractFixtureBundle): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, bundle.groupId, "bundle.groupId");
  requireIsoTimestamp(errors, bundle.generatedAt, "bundle.generatedAt");

  return errors;
}

function validateGroupAccess(
  record: GroupAccessRecord,
  path: string,
  expectedGroupId: string,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, record.id, `${path}.id`);
  requireNonEmpty(errors, record.groupId, `${path}.groupId`);
  if (record.credentialSource !== "server-configured-invite") {
    errors.push(`${path}.credentialSource must be server-configured-invite`);
  }
  requireNonEmpty(errors, record.actorDisplayName, `${path}.actorDisplayName`);
  requireNonEmpty(errors, record.actorIdentityToken, `${path}.actorIdentityToken`);
  requireIsoTimestamp(errors, record.createdAt, `${path}.createdAt`);
  if (record.groupId !== expectedGroupId) {
    errors.push(`${path}.groupId must match bundle.groupId`);
  }
  if (record.identityPersistence !== "localStorage") {
    errors.push(`${path}.identityPersistence must be localStorage`);
  }

  return errors;
}

function validateGroupAction(
  record: GroupActionRecord,
  path: string,
  expectedGroupId: string,
  listingById: Map<string, ListingCandidate>,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, record.id, `${path}.id`);
  requireNonEmpty(errors, record.groupId, `${path}.groupId`);
  requireNonEmpty(errors, record.listingId, `${path}.listingId`);
  requireNonEmpty(errors, record.actorDisplayName, `${path}.actorDisplayName`);
  requireIsoTimestamp(errors, record.createdAt, `${path}.createdAt`);

  if (record.groupId !== expectedGroupId) {
    errors.push(`${path}.groupId must match bundle.groupId`);
  }
  const listing = listingById.get(record.listingId);
  if (!listing || listing.groupId !== expectedGroupId) {
    errors.push(`${path}.listingId must reference a listing in the same bundle group`);
  }
  if (record.actionType === "comment" && !record.commentBody) {
    errors.push(`${path}.commentBody is required for comment actions`);
  }
  if (record.actionType === "reaction" && !record.reaction) {
    errors.push(`${path}.reaction is required for reaction actions`);
  }
  if (record.actionType === "status-change" && !record.status) {
    errors.push(`${path}.status is required for status-change actions`);
  }
  if (record.actionType === "source-link-open" && !record.sourceUrl) {
    errors.push(`${path}.sourceUrl is required for source-link-open actions`);
  }
  if (record.actionType === "feedback") {
    if (!record.feedback) {
      errors.push(`${path}.feedback is required for feedback actions`);
    } else if (record.feedback.doesNotMutateRanking !== true) {
      errors.push(`${path}.feedback.doesNotMutateRanking must remain true for MVP`);
    }
  }
  if (record.sourceUrl) {
    requireHttpUrl(errors, record.sourceUrl, `${path}.sourceUrl`);
    if (listing && record.sourceUrl !== listing.url) {
      errors.push(`${path}.sourceUrl must match listing source URL`);
    }
  }

  return errors;
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

function validateRunLog(
  record: AgentRunLogRecord,
  path: string,
  expectedGroupId?: string,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, record.id, `${path}.id`);
  requireNonEmpty(errors, record.groupId, `${path}.groupId`);
  requireIsoTimestamp(errors, record.startedAt, `${path}.startedAt`);
  if (record.completedAt) {
    requireIsoTimestamp(errors, record.completedAt, `${path}.completedAt`);
  }
  if (expectedGroupId && record.groupId !== expectedGroupId) {
    errors.push(`${path}.groupId must match bundle.groupId`);
  }
  if (record.boundedConcurrency < 1) {
    errors.push(`${path}.boundedConcurrency must be at least 1`);
  }
  if (
    record.counts.sourceFailures !== record.units.filter((unit) => unit.status === "failed").length
  ) {
    errors.push(`${path}.counts.sourceFailures must match failed run units`);
  }

  return errors;
}

function validateBriefing(
  record: BriefingRecord,
  path: string,
  expectedGroupId?: string,
  listingIds?: Set<string>,
): string[] {
  const errors: string[] = [];

  requireNonEmpty(errors, record.id, `${path}.id`);
  requireNonEmpty(errors, record.groupId, `${path}.groupId`);
  requireNonEmpty(errors, record.runId, `${path}.runId`);
  requireNonEmpty(errors, record.summary, `${path}.summary`);
  requireIsoTimestamp(errors, record.generatedAt, `${path}.generatedAt`);
  if (expectedGroupId && record.groupId !== expectedGroupId) {
    errors.push(`${path}.groupId must match bundle.groupId`);
  }
  for (const [field, ids] of Object.entries({
    bestNewListingIds: record.bestNewListingIds,
    reviewNeededListingIds: record.reviewNeededListingIds,
    rejectedListingIds: record.rejectedListingIds,
  })) {
    for (const [index, id] of ids.entries()) {
      if (listingIds && !listingIds.has(id)) {
        errors.push(`${path}.${field}.${index} must reference a listing in the same bundle group`);
      }
    }
  }
  if (record.suggestedNextActions.length === 0) {
    errors.push(`${path}.suggestedNextActions must include at least one action`);
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

function validateProviderMetadata(
  metadata: AiProviderAttemptMetadata,
  path: string,
  purpose?: AiProviderAttemptMetadata["purpose"],
): string[] {
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
  if (purpose && metadata.purpose !== purpose) {
    errors.push(`${path}.purpose must be ${purpose}`);
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
