import {
  evidencePointerToSourceEvidenceRecord,
  type AgentRunLogRecord,
  type BriefingCandidateSummary,
  type BriefingRecord,
  type BriefingRunHistoryContract,
  type BriefingRunHistoryRun,
  type ConfidenceScore,
  type ConfidenceTriageMetadata,
  type EvidenceStoragePointer,
  type FeedbackSummary,
  type GroupActionRecord,
  type LatestBriefingSummary,
  type SeenRejectedMemoryRecord,
  type SourceCoverageSummary,
  type SourceEvidenceRecord,
} from "./agent-contracts";
import { extractSingleLinkFixture, runStreetEasyBatchFixture } from "./extraction";
import {
  nonFirstClassApartmentFixture,
  streetEasyBatchFixture,
  streetEasyPastedFixture,
} from "./fixtures";
import {
  createDuplicateKey,
  createGroupScopedDuplicateKey,
  createGroupScopedListingState,
  createGroupIdentity,
  createListingFromUrl,
  defaultSearchGroup,
  updateReviewStatus,
  type AiProviderAttemptMetadata,
  type ListingCandidate,
} from "./listings";
import { withDefined } from "./utils/records";

/**
 * Deterministic fixture inputs assembled from the extraction pipeline so tests can
 * exercise the briefing/run-history contract without a live run.
 */
type AgentContractFixtureBundle = {
  generatedAt: string;
  groupId: string;
  listingCandidates: {
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

const generatedAt = "2026-06-07T12:00:00.000Z";
const identity = createGroupIdentity(defaultSearchGroup.id, "Contract Fixture")!;

const pastedExtraction = extractSingleLinkFixture({
  rawUrl: streetEasyPastedFixture.sourceUrl,
  identity,
  fixture: streetEasyPastedFixture,
});

const batchResult = runStreetEasyBatchFixture({
  identity,
  fixture: streetEasyBatchFixture,
  priorStates: [
    createGroupScopedListingState(
      defaultSearchGroup.id,
      streetEasyBatchFixture.results[0]!.sourceUrl,
      {
        seen: true,
        triaged: false,
      },
    ),
    createGroupScopedListingState(
      defaultSearchGroup.id,
      streetEasyBatchFixture.results[1]!.sourceUrl,
      {
        seen: true,
        triaged: true,
        triageBucket: "rejected",
        reviewStatus: "rejected",
      },
    ),
  ],
  concurrencyLimit: 2,
});

const confirmedMatch = batchResult.listings.find(
  (listing) => listing.triageBucket === "confirmed-match",
)!;
const reviewNeeded = batchResult.listings.find(
  (listing) => listing.triageBucket === "review-needed",
)!;

const rejectedDowngradedBase = createListingFromUrl(
  "https://streeteasy.com/building/rejected-downgraded/5",
  identity,
  {
    sourceListingId: "rejected-downgraded-1",
    title: "Downgraded four bed over ceiling",
    address: "500 Rejected Street",
    neighborhood: "Chelsea",
    borough: "Manhattan",
    rent: 16250,
    bedrooms: 4,
    bathrooms: 2,
    availableAt: "2026-08-01",
    description: "Fixture preserved for rejected/downgraded memory coverage.",
  },
);
const rejectedDowngraded: ListingCandidate = {
  ...updateReviewStatus(rejectedDowngradedBase, "rejected"),
  extractionStatus: "success",
  triageStatus: "success",
  triageBucket: "rejected",
  concerns: ["Rent is above the $15,000 ceiling.", "Bedroom count is below the 5BR target."],
};

const pastedIntake = pastedExtraction.listing;

const sourceEvidence: SourceEvidenceRecord[] = [
  evidencePointerToSourceEvidenceRecord({
    pointer: pastedIntake.evidencePointers[0]!,
    sourceUrl: pastedIntake.url,
    claim: "Pasted StreetEasy intake source captured",
    quote: "RealtyAPI fixture resolved the pasted StreetEasy URL.",
  }),
  {
    id: "source-evidence-d1-metadata-fixture",
    contract: "source-evidence-v1",
    groupId: defaultSearchGroup.id,
    listingId: confirmedMatch.id,
    runId: batchResult.run.id,
    sourceUrl: confirmedMatch.url,
    claim: "D1 evidence metadata fixture",
    quote:
      "Source image URLs and normalized evidence metadata are retained in D1 without R2 raw artifact storage.",
    pointer: {
      owner: "d1",
      key: `source_evidence_records:${confirmedMatch.id}:metadata`,
      contentType: "application/json",
      groupScoped: true,
    },
    capturedAt: generatedAt,
  },
  {
    id: "source-evidence-review-needed-raw-artifact-fixture",
    contract: "source-evidence-v1",
    groupId: defaultSearchGroup.id,
    listingId: reviewNeeded.id,
    runId: batchResult.run.id,
    sourceUrl: reviewNeeded.url,
    claim: "Review-needed source artifact retained",
    quote: "Williamsburg fallback candidate kept for manual review with source evidence.",
    pointer: {
      owner: "d1",
      key: `source_evidence_records:${reviewNeeded.id}:metadata`,
      contentType: "application/json",
      groupScoped: true,
    },
    capturedAt: generatedAt,
  },
  {
    id: "source-evidence-source-failure-fixture",
    contract: "source-evidence-v1",
    groupId: defaultSearchGroup.id,
    runId: batchResult.run.id,
    sourceUrl: nonFirstClassApartmentFixture.sourceUrl,
    claim: "Source failure isolated",
    quote: "A fixture-only source failed without failing the whole scheduled run.",
    pointer: {
      owner: "d1",
      key: `source_evidence_records:${batchResult.run.id}:source-failure`,
      contentType: "application/json",
      groupScoped: true,
    },
    capturedAt: generatedAt,
  },
];

const triageMetadata: ConfidenceTriageMetadata[] = [
  toTriageMetadata(confirmedMatch, "passed", "fixture-triage-v1"),
  toTriageMetadata(reviewNeeded, "review-needed", "fixture-triage-v1"),
  toTriageMetadata(rejectedDowngraded, "failed", "fixture-triage-v1"),
];

const shaneActor = {
  displayName: "Shane",
  identityToken: "actor_nyc-5br-2026_shane-fixture",
};
const roommateActor = {
  displayName: "Roommate",
  identityToken: "actor_nyc-5br-2026_roommate-fixture",
};

const groupActions: GroupActionRecord[] = [
  {
    id: "group-action-comment-confirmed-match",
    contract: "group-action-v1",
    groupId: defaultSearchGroup.id,
    listingId: confirmedMatch.id,
    actorDisplayName: shaneActor.displayName,
    actorIdentityToken: shaneActor.identityToken,
    actor: shaneActor,
    actionType: "comment",
    commentBody: "Looks viable if the bedrooms are legal; ask about floorplan.",
    sourceUrl: confirmedMatch.url,
    provenance: { source: "user-entered", visibleToGroup: true },
    createdAt: generatedAt,
  },
  {
    id: "group-action-reaction-review-needed",
    contract: "group-action-v1",
    groupId: defaultSearchGroup.id,
    listingId: reviewNeeded.id,
    actorDisplayName: roommateActor.displayName,
    actorIdentityToken: roommateActor.identityToken,
    actor: roommateActor,
    actionType: "reaction",
    reaction: "question",
    sourceUrl: reviewNeeded.url,
    provenance: { source: "user-entered", visibleToGroup: true },
    createdAt: generatedAt,
  },
  {
    id: "group-action-status-rejected",
    contract: "group-action-v1",
    groupId: defaultSearchGroup.id,
    listingId: rejectedDowngraded.id,
    actorDisplayName: shaneActor.displayName,
    actorIdentityToken: shaneActor.identityToken,
    actor: shaneActor,
    actionType: "status-change",
    status: "rejected",
    sourceUrl: rejectedDowngraded.url,
    provenance: { source: "user-entered", visibleToGroup: true },
    createdAt: generatedAt,
  },
  {
    id: "group-action-source-link-open-confirmed-match",
    contract: "group-action-v1",
    groupId: defaultSearchGroup.id,
    listingId: confirmedMatch.id,
    actorDisplayName: shaneActor.displayName,
    actorIdentityToken: shaneActor.identityToken,
    actor: shaneActor,
    actionType: "source-link-open",
    sourceUrl: confirmedMatch.url,
    provenance: { source: "original-listing-source-link", visibleToGroup: true },
    createdAt: generatedAt,
  },
  {
    id: "group-action-feedback-confirmed-match",
    contract: "group-action-v1",
    groupId: defaultSearchGroup.id,
    listingId: confirmedMatch.id,
    actorDisplayName: roommateActor.displayName,
    actorIdentityToken: roommateActor.identityToken,
    actor: roommateActor,
    actionType: "feedback",
    sourceUrl: confirmedMatch.url,
    feedback: {
      category: "evidence",
      summary: "One roommate wants the floorplan before agreeing this is a real 5BR.",
      disagreement: true,
      doesNotMutateRanking: true,
    },
    provenance: { source: "user-entered", visibleToGroup: true },
    createdAt: generatedAt,
  },
];

const seenRejectedState = createGroupScopedListingState(
  defaultSearchGroup.id,
  rejectedDowngraded.url,
  {
    seen: true,
    triaged: true,
    triageBucket: "rejected",
    reviewStatus: "rejected",
  },
);

const sourceFailureUnit = {
  id: "run-unit-source-failure-fixture",
  source: "other" as const,
  sourceUrl: nonFirstClassApartmentFixture.sourceUrl,
  status: "failed" as const,
  attempt: 2,
  maxRetries: 1,
  errorCode: "fixture-source-unavailable",
  startedAt: generatedAt,
  completedAt: generatedAt,
};

const runSummary: AgentRunLogRecord = {
  id: "agent-run-log-fixture-summary",
  contract: "agent-run-log-v1",
  groupId: defaultSearchGroup.id,
  cadence: "daily",
  trigger: "cron",
  status: "partial",
  startedAt: generatedAt,
  completedAt: generatedAt,
  counts: {
    candidatesFound: 4,
    candidatesSkippedSeen: 1,
    candidatesSkippedTriaged: 1,
    candidatesAnalyzed: 2,
    candidatesSaved: 2,
    candidatesRejected: 1,
    sourceFailures: 1,
  },
  boundedConcurrency: 2,
  retryPolicy: {
    maxRetries: 1,
    retryDelayMs: 250,
  },
  units: [
    {
      id: "run-unit-seen-skip-fixture",
      source: "streeteasy",
      sourceUrl: streetEasyBatchFixture.results[0]!.sourceUrl,
      listingId: streetEasyBatchFixture.results[0]!.listingId,
      status: "skipped-seen",
      attempt: 0,
      maxRetries: 1,
      startedAt: generatedAt,
      completedAt: generatedAt,
    },
    withDefined<AgentRunLogRecord["units"][number]>({
      id: "run-unit-confirmed-match-fixture",
      source: "streeteasy",
      sourceUrl: confirmedMatch.url,
      listingId: confirmedMatch.sourceListingId,
      status: "success",
      attempt: 1,
      maxRetries: 1,
      startedAt: generatedAt,
      completedAt: generatedAt,
    }),
    sourceFailureUnit,
  ],
};

const briefing: BriefingRecord = {
  id: "briefing-record-fixture",
  contract: "briefing-record-v1",
  groupId: defaultSearchGroup.id,
  runId: runSummary.id,
  generatedAt,
  bestNewListingIds: [confirmedMatch.id],
  reviewNeededListingIds: [reviewNeeded.id],
  rejectedListingIds: [rejectedDowngraded.id],
  summary:
    "One strong Chelsea candidate is ready for review, one Williamsburg candidate needs location review, and one source failed in isolation.",
  whatChanged: ["New Chelsea batch candidate added", "Seen StreetEasy result skipped"],
  sourceCoverage: [
    { source: "streeteasy", status: "success", checkedCount: 4 },
    {
      source: "fixture-secondary-source",
      status: "failed",
      checkedCount: 1,
      failureCode: "fixture-source-unavailable",
    },
  ],
  skippedSeenCount: 1,
  recommendationRationale: [
    "Confirmed candidate fits price, bedroom, bathroom, and preferred Manhattan criteria.",
    "Review-needed candidate has strong unit fit but is outside the preferred Manhattan zone.",
  ],
  suggestedNextActions: [
    "Open source link",
    "Ask broker for floorplan",
    "Keep failed source in run log",
  ],
};

const agentContractFixtureBundle: AgentContractFixtureBundle = {
  generatedAt,
  groupId: defaultSearchGroup.id,
  listingCandidates: {
    confirmedMatch,
    reviewNeeded,
    rejectedDowngraded,
  },
  sourceEvidence,
  triageMetadata,
  groupActions,
  seenRejectedMemory: [
    {
      id: "seen-rejected-memory-fixture",
      contract: "seen-rejected-memory-v1",
      groupId: defaultSearchGroup.id,
      sourceUrl: rejectedDowngraded.url,
      duplicateKey: createDuplicateKey(rejectedDowngraded.url),
      groupScopedDuplicateKey: createGroupScopedDuplicateKey(
        defaultSearchGroup.id,
        rejectedDowngraded.url,
      ),
      memoryState: "rejected",
      reason: "Over budget and not a credible 5BR.",
      lastSeenAt: seenRejectedState.lastSeenAt,
    },
  ],
  runLogs: [runSummary],
  briefingRecords: [briefing],
};

export function createBriefingRunHistoryFixture(
  bundle: AgentContractFixtureBundle = agentContractFixtureBundle,
): BriefingRunHistoryContract {
  const run = bundle.runLogs[0]!;
  const sourceBriefing = bundle.briefingRecords[0]!;
  const candidateSummaries = [
    bundle.listingCandidates.confirmedMatch,
    bundle.listingCandidates.reviewNeeded,
    bundle.listingCandidates.rejectedDowngraded,
  ].map((listing) => toCandidateSummary(listing, bundle));
  const rawArtifactPointers = rawPointersForRun(bundle, run.id);
  const sourceCoverage = sourceBriefing.sourceCoverage.map((coverage) =>
    withDefined<SourceCoverageSummary>({
      source: coverage.source,
      status: coverage.status,
      checkedCount: coverage.checkedCount,
      candidateCount:
        coverage.source === "streeteasy"
          ? candidateSummaries.filter((candidate) => candidate.source === "streeteasy").length
          : 0,
      failureCode: coverage.failureCode,
      failureMessage: coverage.failureCode
        ? "Fixture source failed without blocking other sources."
        : undefined,
      rawArtifactPointers:
        coverage.status === "failed"
          ? rawArtifactPointers.filter((pointer) => pointer.key.includes("source-failures"))
          : rawArtifactPointers.filter((pointer) => !pointer.key.includes("source-failures")),
    }),
  );
  const latestRun = withDefined<BriefingRunHistoryRun>({
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
    sourceCoverage,
    candidateSummaries,
    providerMetadata: [briefingProviderMetadata()],
    rawArtifactPointers,
  });
  const latestBriefing: LatestBriefingSummary = {
    id: sourceBriefing.id,
    runId: run.id,
    generatedAt: sourceBriefing.generatedAt,
    summary: sourceBriefing.summary,
    bestNewListingIds: sourceBriefing.bestNewListingIds,
    reviewNeededListingIds: sourceBriefing.reviewNeededListingIds,
    rejectedListingIds: sourceBriefing.rejectedListingIds,
    whatChanged: sourceBriefing.whatChanged,
    sourceCoverage,
    skippedSeenCount: sourceBriefing.skippedSeenCount,
    evidenceConfidenceSummaries: candidateSummaries.map((candidate) => candidate.evidenceSummary),
    recommendationRationale: sourceBriefing.recommendationRationale,
    suggestedActions: sourceBriefing.suggestedNextActions,
  };

  return {
    contract: "briefing-run-history-v1",
    schemaVersion: "briefing-run-history-v1",
    groupId: bundle.groupId,
    generatedAt: bundle.generatedAt,
    supportedCadences: ["manual", "daily", "hourly"],
    latestRun,
    runs: [latestRun],
    latestBriefing,
    seenRejectedMemory: bundle.seenRejectedMemory,
    feedbackSummaries: createFeedbackSummaries(bundle, candidateSummaries),
  };
}

export const briefingRunHistoryFixture = createBriefingRunHistoryFixture();

function toTriageMetadata(
  listing: ListingCandidate,
  deterministicHardConstraintResult: ConfidenceTriageMetadata["deterministicHardConstraintResult"],
  promptVersion: string,
): ConfidenceTriageMetadata {
  return {
    contract: "confidence-triage-v1",
    groupId: listing.groupId,
    listingId: listing.id,
    bucket: listing.triageBucket === "untriaged" ? "review-needed" : listing.triageBucket,
    status: listing.triageStatus,
    confidence: confidenceForListing(listing),
    reasons: listing.evidence.map((evidence) => evidence.claim),
    concerns: listing.concerns,
    deterministicHardConstraintResult,
    schemaValidationResult: "passed",
    promptVersion,
    updatedAt: listing.updatedAt,
  };
}

function toCandidateSummary(
  listing: ListingCandidate,
  bundle: AgentContractFixtureBundle,
): BriefingCandidateSummary {
  const triage = bundle.triageMetadata.find((record) => record.listingId === listing.id)!;
  const memory = bundle.seenRejectedMemory.find((record) => record.sourceUrl === listing.url);
  const sourceEvidenceForListing = bundle.sourceEvidence.filter(
    (record) => record.listingId === listing.id || record.sourceUrl === listing.url,
  );

  return withDefined<BriefingCandidateSummary>({
    listingId: listing.id,
    sourceUrl: listing.url,
    source: listing.source,
    title: listing.title,
    bucket: listing.triageBucket === "untriaged" ? "review-needed" : listing.triageBucket,
    triageStatus: listing.triageStatus,
    reviewStatus: listing.reviewStatus,
    providerRoute: listing.providerRoute,
    evidenceSummary: {
      confidence: triage.confidence,
      reasons: triage.reasons,
      concerns: triage.concerns,
      evidenceQuotes: [
        ...listing.evidence.map((evidence) => evidence.quote),
        ...sourceEvidenceForListing.map((record) => record.quote),
      ],
      sourceLinks: [
        ...new Set([listing.url, ...sourceEvidenceForListing.map((record) => record.sourceUrl)]),
      ],
      rawArtifactPointers: sourceEvidenceForListing.map((record) => record.pointer),
    },
    memoryState: memory?.memoryState,
    suggestedAction:
      listing.triageBucket === "confirmed-match"
        ? "Prioritize for roommate review and ask for floorplan."
        : listing.triageBucket === "review-needed"
          ? "Review uncertainty before promoting to current matches."
          : "Keep rejected in memory so it is not repeatedly reviewed.",
  });
}

function createFeedbackSummaries(
  bundle: AgentContractFixtureBundle,
  candidates: BriefingCandidateSummary[],
): FeedbackSummary[] {
  return candidates
    .map((candidate) => {
      const actions = bundle.groupActions.filter(
        (action) => action.listingId === candidate.listingId,
      );
      const summaries: string[] = actions.flatMap((action) => {
        if (action.commentBody) return [action.commentBody];
        if (action.feedback?.summary) return [action.feedback.summary];
        return [];
      });

      if (actions.length === 0) {
        return undefined;
      }

      return {
        listingId: candidate.listingId,
        sourceUrl: candidate.sourceUrl,
        commentCount: actions.filter((action) => action.actionType === "comment").length,
        reactionCount: actions.filter((action) => action.actionType === "reaction").length,
        statusChangeCount: actions.filter((action) => action.actionType === "status-change").length,
        disagreementCount: actions.filter((action) => action.feedback?.disagreement).length,
        summaries,
        doesNotMutateRanking: true,
      } satisfies FeedbackSummary;
    })
    .filter((summary): summary is FeedbackSummary => Boolean(summary));
}

function rawPointersForRun(
  bundle: AgentContractFixtureBundle,
  runId: string,
): EvidenceStoragePointer[] {
  return bundle.sourceEvidence
    .filter((record) => record.runId === runId || record.pointer.owner === "d1")
    .map((record) => record.pointer);
}

function briefingProviderMetadata(): AiProviderAttemptMetadata {
  return {
    provider: "google-direct",
    model: "gemini-3.5-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    purpose: "briefing",
    attemptId: "provider-attempt-briefing-fixture",
    status: "success",
    startedAt: generatedAt,
    completedAt: generatedAt,
    latencyMs: 125,
    inputTokenCount: 900,
    outputTokenCount: 220,
    imageCount: 0,
    maxImagesPerListing: 5,
    promptVersion: "briefing-fixture-v1",
    schemaValidation: "passed",
  };
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
