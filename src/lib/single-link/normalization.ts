import { createTriageCandidateFromListing } from "../extraction";
import {
  calculateFitFlags,
  createAiProviderAttemptMetadata,
  createSavedListDisplayFields,
  type FieldProvenance,
  type ListingCandidate,
  type ListingDraft,
} from "../listings";
import { assignFitEvidenceTriage } from "../triage";
import { withDefined } from "../utils/records";
import { cleanExtractedAddress } from "./source-page";
import type { GeminiListingExtraction, SourcePageMetadata } from "./types";

export function mergeExtraction(
  listing: ListingCandidate,
  output: GeminiListingExtraction,
): ListingCandidate {
  const now = new Date().toISOString();
  const merged = {
    ...listing,
    ...output,
    title: output.title ?? listing.title,
    address: output.address ?? listing.address,
    fitFlags: calculateFitFlags(output, listing.url),
    evidence: output.evidence.length > 0 ? output.evidence : listing.evidence,
  };
  const triage = assignFitEvidenceTriage(
    createTriageCandidateFromListing(merged, "manual-single-link"),
  );
  const nextListing = {
    ...merged,
    extractionStatus: hasUsefulExtraction(output) ? "success" : "partial",
    triageStatus: "success",
    triageBucket: "review-needed",
    concerns: [
      ...new Set([...output.concerns, ...triage.rejectionReasons, ...triage.downgradeReasons]),
    ],
    fieldProvenance: createAiFieldProvenance(output, now),
    updatedAt: now,
  } satisfies Omit<ListingCandidate, "display">;

  return { ...nextListing, display: createSavedListDisplayFields(nextListing) };
}

export function markManualNeeded(
  listing: ListingCandidate,
  failureCode: string,
  failureMessage: string,
): ListingCandidate {
  const now = new Date().toISOString();
  const attempt = createAiProviderAttemptMetadata("text-normalization", 0);
  const nextListing = {
    ...listing,
    extractionStatus: "manual-needed",
    triageStatus: "failed",
    triageBucket: "review-needed",
    concerns: [...listing.concerns, `${failureCode}: ${failureMessage}`],
    evidencePointers: [
      ...listing.evidencePointers,
      {
        id: attempt.attemptId,
        groupId: listing.groupId,
        listingId: listing.id,
        kind: "ai-output" as const,
        sourceUrl: listing.url,
        storage: {
          owner: "d1" as const,
          scope: "authoritative-relational" as const,
          groupScoped: true,
        },
        d1Table: "extraction_jobs" as const,
        quote: failureMessage,
        capturedAt: now,
      },
    ],
    updatedAt: now,
  } satisfies Omit<ListingCandidate, "display">;

  return { ...nextListing, display: createSavedListDisplayFields(nextListing) };
}

export function markExtractionFailed(
  listing: ListingCandidate,
  failureCode: string,
  failureMessage: string,
): ListingCandidate {
  return hasUsefulListingMetadata(listing)
    ? markPartialExtraction(listing, failureCode, failureMessage)
    : markManualNeeded(listing, failureCode, failureMessage);
}

export function mergeDrafts(
  metadata: SourcePageMetadata,
  output: GeminiListingExtraction,
): GeminiListingExtraction {
  const title = output.title ?? metadata.title;
  return withDefined<GeminiListingExtraction>({
    title,
    address:
      cleanExtractedAddress(output.address ?? metadata.address, title ?? "") ??
      output.address ??
      metadata.address,
    neighborhood: output.neighborhood ?? metadata.neighborhood,
    borough: output.borough ?? metadata.borough,
    rent: output.rent ?? metadata.rent,
    bedrooms: output.bedrooms ?? metadata.bedrooms,
    bathrooms: output.bathrooms ?? metadata.bathrooms,
    availableAt: output.availableAt ?? metadata.availableAt,
    description: output.description ?? metadata.description,
    amenities: output.amenities?.length ? output.amenities : (metadata.amenities ?? []),
    photos: output.photos?.length ? output.photos : (metadata.photos ?? []),
    evidence: output.evidence.length ? output.evidence : metadata.evidence,
    concerns: output.concerns,
    confidence: output.confidence,
  });
}

function markPartialExtraction(
  listing: ListingCandidate,
  failureCode: string,
  failureMessage: string,
): ListingCandidate {
  const now = new Date().toISOString();
  const nextListing = {
    ...listing,
    extractionStatus: "partial" as const,
    triageStatus: "partial" as const,
    triageBucket: "review-needed" as const,
    concerns: [...listing.concerns, `${failureCode}: ${failureMessage}`],
    fitFlags: calculateFitFlags(listing, listing.url),
    updatedAt: now,
  } satisfies Omit<ListingCandidate, "display">;

  return { ...nextListing, display: createSavedListDisplayFields(nextListing) };
}

function hasUsefulListingMetadata(listing: ListingCandidate): boolean {
  return Boolean(
    listing.title !== "Manual review needed" &&
    listing.address !== "Unknown address" &&
    (listing.rent || listing.bedrooms || listing.bathrooms || listing.photos.length > 0),
  );
}

function hasUsefulExtraction(output: GeminiListingExtraction): boolean {
  return Boolean(
    output.title && output.address && (output.rent || output.bedrooms || output.photos?.length),
  );
}

function createAiFieldProvenance(output: ListingDraft, updatedAt: string): FieldProvenance[] {
  return (
    ["title", "address", "neighborhood", "rent", "bedrooms", "bathrooms", "availableAt"] as const
  )
    .filter((field) => output[field] !== undefined)
    .map((field) => ({
      field,
      source: "ai-extracted",
      editedValue: String(output[field]),
      actor: "gemini-3.5-flash",
      updatedAt,
    }));
}
