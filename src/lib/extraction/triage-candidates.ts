import {
  assignFitEvidenceTriage,
  type TriageCandidateInput,
  type TriageEvidence,
  type TriageResult,
  type TriageSource,
} from "../triage";
import {
  type AiExtractionOutput,
  type ListingCandidate,
  type ListingEvidence,
  type SourceType,
} from "../listings";
import { stableId } from "./normalization";
import type { BuildTriageOptions } from "./contracts";
import { withDefined } from "../utils/records";
import { SEARCH_CONFIG } from "../search-config";

function isExceptionalFallback(candidate: {
  borough?: string;
  rent?: number;
  bedrooms?: number;
}): boolean {
  return (
    SEARCH_CONFIG.exceptionalFallback.boroughs.some(
      (borough) => borough.toLowerCase() === candidate.borough?.toLowerCase(),
    ) &&
    candidate.rent !== undefined &&
    candidate.rent <= SEARCH_CONFIG.exceptionalFallback.maxRent &&
    candidate.bedrooms !== undefined &&
    candidate.bedrooms >= SEARCH_CONFIG.minBedrooms
  );
}

export function buildTriage({
  normalized,
  intakeKind,
  runId,
  overrideBucket,
  overrideStatus,
}: {
  normalized: AiExtractionOutput["normalizedListing"];
  intakeKind: "pasted-url" | "batch-search";
  runId: string;
} & BuildTriageOptions): TriageResult {
  const triage = assignFitEvidenceTriage(
    createTriageCandidateFromNormalized(normalized, intakeKind, runId, {
      manualReviewRequired:
        normalized.fitFlags.includes("manual_review_needed") || overrideBucket === "review-needed",
    }),
  );

  if (!overrideBucket || overrideBucket === triage.bucket) {
    return overrideStatus ? { ...triage, status: overrideStatus } : triage;
  }

  if (overrideBucket === "review-needed" && triage.bucket === "confirmed-match") {
    return {
      ...triage,
      bucket: "review-needed",
      status: overrideStatus ?? "partial",
      downgradeReasons: [
        ...triage.downgradeReasons,
        "Fixture/provider contract explicitly requires manual review.",
      ],
      concerns: [
        ...triage.concerns,
        "Fixture/provider contract explicitly requires manual review.",
      ],
      suggestedAction: "Send to manual roommate/operator review before confirmation.",
    } satisfies TriageResult;
  }

  if (overrideBucket === "rejected" && triage.bucket !== "confirmed-match") {
    return {
      ...triage,
      bucket: "rejected",
      status: overrideStatus ?? "success",
      rejectionReasons: [
        ...triage.rejectionReasons,
        "Fixture/provider contract marked this listing rejected.",
      ],
      suggestedAction: "Keep rejection history and avoid repeated manual review.",
    } satisfies TriageResult;
  }

  return overrideStatus ? { ...triage, status: overrideStatus } : triage;
}

export function createTriageCandidateFromListing(
  listing: ListingCandidate,
  runId: string,
): TriageCandidateInput {
  return withDefined<TriageCandidateInput>({
    ownership: {
      groupId: listing.groupId,
      runId,
      listingId: listing.sourceListingId ?? listing.id,
      sourceUrl: listing.url,
    },
    source: toTriageSource(listing.source, listing.url),
    sourceName: listing.source,
    sourceUrl: listing.url,
    intakeKind: listing.userQualified ? "pasted-url" : "batch-search",
    userQualified: listing.userQualified,
    title: listing.title,
    address: listing.address,
    neighborhood: listing.neighborhood,
    borough: listing.borough,
    rent: listing.rent,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    availableAt: listing.availableAt,
    listingStatus: listing.extractionStatus === "failed" ? "unavailable" : "active",
    description: listing.description,
    evidence: toTriageEvidence(listing.evidence, listing.url),
    concerns: listing.concerns,
    manualReviewRequired: listing.fitFlags.includes("manual_review_needed"),
    wholeApartment: inferWholeApartment(listing.source, listing.description),
    occupancyType: inferOccupancyType(listing.description),
    stayType: inferStayType(listing.description),
    scamSignal: inferScamSignal(listing.description),
    exceptionalFallbackEvidence: isExceptionalFallback(listing),
  });
}

function createTriageCandidateFromNormalized(
  normalized: AiExtractionOutput["normalizedListing"],
  intakeKind: "pasted-url" | "batch-search",
  runId: string,
  options: { manualReviewRequired?: boolean } = {},
): TriageCandidateInput {
  const sourceUrl = normalized.sourceUrl;

  return withDefined<TriageCandidateInput>({
    ownership: {
      groupId: normalized.groupId,
      runId,
      listingId:
        normalized.sourceListingId ?? stableId(`${normalized.groupId}:${sourceUrl}:triage`),
      sourceUrl,
    },
    source: toTriageSource(normalized.source, sourceUrl),
    sourceName: normalized.source,
    sourceUrl,
    intakeKind,
    userQualified: intakeKind === "pasted-url",
    title: normalized.title,
    address: normalized.address,
    neighborhood: normalized.neighborhood,
    borough: normalized.borough,
    rent: normalized.rent,
    bedrooms: normalized.bedrooms,
    bathrooms: normalized.bathrooms,
    availableAt: normalized.availableAt,
    listingStatus: "active",
    description: normalized.description,
    evidence: toTriageEvidence(normalized.evidence, sourceUrl),
    concerns: normalized.concerns,
    manualReviewRequired: options.manualReviewRequired,
    wholeApartment: inferWholeApartment(normalized.source, normalized.description),
    occupancyType: inferOccupancyType(normalized.description),
    stayType: inferStayType(normalized.description),
    scamSignal: inferScamSignal(normalized.description),
    exceptionalFallbackEvidence: isExceptionalFallback(normalized),
  });
}

function toTriageEvidence(evidence: ListingEvidence[], sourceUrl: string): TriageEvidence[] {
  return evidence.map((item, index) => ({
    factor: "source",
    claim: item.claim,
    quote: item.quote,
    sourceUrl: item.sourceUrl || sourceUrl,
    artifactPointer: {
      kind: "source-page",
      pointerId: item.pointerId ?? `${sourceUrl}:evidence:${index}`,
      storageOwner: "local-fixture",
      url: item.sourceUrl || sourceUrl,
    },
  }));
}

function toTriageSource(source: SourceType, sourceUrl: string): TriageSource {
  const hostname = new URL(sourceUrl).hostname.toLowerCase();

  if (hostname.includes("nybits")) {
    return "nybits";
  }
  if (hostname.includes("openigloo")) {
    return "openigloo";
  }

  return source;
}

function inferWholeApartment(source: SourceType, description = ""): boolean | undefined {
  const normalized = description.toLowerCase();

  if (/\b(room share|room for rent|individual room)\b/.test(normalized)) {
    return false;
  }
  if (
    normalized.includes("whole apartment") ||
    normalized.includes("entire apartment") ||
    normalized.includes("full-floor")
  ) {
    return true;
  }
  if (source === "streeteasy" || source === "zillow") {
    return true;
  }

  return undefined;
}

function inferOccupancyType(description = ""): TriageCandidateInput["occupancyType"] {
  const normalized = description.toLowerCase();

  if (/\b(room share|room for rent)\b/.test(normalized)) {
    return "room-share";
  }
  if (normalized.includes("individual room")) {
    return "individual-room";
  }
  if (
    normalized.includes("whole apartment") ||
    normalized.includes("entire apartment") ||
    normalized.includes("full-floor")
  ) {
    return "whole-apartment";
  }

  return undefined;
}

function inferStayType(description = ""): TriageCandidateInput["stayType"] {
  return /\b(short-term|nightly|weekly)\b/.test(description.toLowerCase())
    ? "short-term"
    : undefined;
}

function inferScamSignal(description = ""): TriageCandidateInput["scamSignal"] {
  const normalized = description.toLowerCase();

  if (normalized.includes("wire money") || normalized.includes("too good to be true")) {
    return "confirmed";
  }

  return undefined;
}
