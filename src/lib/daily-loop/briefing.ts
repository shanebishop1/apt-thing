import type {
  AgentRunLogRecord,
  AgentRunOperatorEvidence,
  BriefingCandidateSummary,
  BriefingRecord,
  BriefingRunHistoryContract,
  BriefingRunHistoryRun,
  ConfidenceTriageMetadata,
  EvidenceStoragePointer,
  SeenRejectedMemoryRecord,
  SourceCoverageSummary,
  SourceEvidenceRecord,
} from "../agent-contracts";
import {
  MAX_IMAGES_PER_LISTING,
  type AiProviderAttemptMetadata,
  type ListingCandidate,
} from "../listings";
import { uniqueStrings } from "../utils/text";
import { stableId } from "./ids";
import type {
  DailyLoopMode,
  DailyLoopResult,
  DailyLoopSkippedCandidate,
  DailyLoopSourceCoverage,
} from "./types";

/** Operator-facing outputs: the run briefing, its history contract, and observability rollups. */

export function createDailyLoopBriefing({
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

export function createDailyLoopHistory({
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

export function createRawArtifactPointers(
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

export function createDailyLoopObservability(input: {
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

export function createDailyLoopOperatorEvidence(input: {
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
