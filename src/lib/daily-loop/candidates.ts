import type {
  AgentRunLogRecord,
  ConfidenceScore,
  ConfidenceTriageMetadata,
  EvidenceStoragePointer,
  SeenRejectedMemoryRecord,
  SourceEvidenceRecord,
} from "../agent-contracts";
import type { StreetEasyBatchFixture, StreetEasySearchResultFixture } from "../extraction";
import {
  createDuplicateKey,
  createGroupScopedDuplicateKey,
  type AiProviderAttemptMetadata,
  type GroupScopedListingState,
  type ListingCandidate,
} from "../listings";
import { AI_TRIAGE_SCHEMA_VERSION } from "../triage";
import { stableId } from "./ids";
import {
  DAILY_LOOP_RETRY_POLICY,
  type DailyLoopSkippedCandidate,
  type DailyLoopSourceCoverage,
  type ExistingCandidateState,
} from "./types";

/** Candidate bookkeeping: what the loop has already seen, and how each outcome is logged. */

export function buildExistingStates({
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

export function findExistingState(
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

export function detectMaterialChange(
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

export function toSkippedUnit(
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

export function toMaterialChangeUnit(
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

export function toSuccessUnit(
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

export function toProviderFailureUnits(
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

export function createDailyLoopSourceEvidence({
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

export function toTriageMetadata(listing: ListingCandidate, now: string): ConfidenceTriageMetadata {
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

export function createSeenMemory(
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
