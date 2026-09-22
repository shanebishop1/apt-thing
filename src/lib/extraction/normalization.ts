import {
  MAX_IMAGES_PER_LISTING,
  calculateFitFlags,
  capImageEvidence,
  classifySource,
  createAiProviderAttemptMetadata,
  createDuplicateKey,
  createListingFromUrl,
  createSavedListDisplayFields,
  getProviderRoute,
  hasMinimumRowFields,
  type AiExtractionOutput,
  type AiProviderAttemptMetadata,
  type AgentTriage,
  type ExtractionJob,
  type ExtractionStatus,
  type FitFlag,
  type ImageEvidence,
  type InviteIdentity,
  type ListingCandidate,
  type ListingDraft,
  type ListingEvidence,
  type MinimumSavedListRow,
  type NormalizedListingJson,
} from "../listings";
import { AI_TRIAGE_SCHEMA_VERSION } from "../triage";
import { SEARCH_CONFIG } from "../search-config";
import { withDefined } from "../utils/records";

export function buildNormalizedListing({
  identity,
  sourceUrl,
  draft,
  evidence,
  concerns,
  manualReviewRequired,
}: {
  identity: InviteIdentity;
  sourceUrl: string;
  draft: ListingDraft;
  evidence: ListingEvidence[];
  concerns: string[];
  manualReviewRequired: boolean;
}): NormalizedListingJson {
  const source = classifySource(sourceUrl);
  const imageEvidence = capImageEvidence(
    (draft.photos ?? []).map((url, index): ImageEvidence => ({
      url,
      role: index === 0 ? "primary" : "supporting",
      sentToAi: false,
    })),
  );
  const fitFlags = withManualFlag(
    calculateFitFlags(draft, sourceUrl),
    manualReviewRequired ||
      !hasMinimumRowFields(
        withDefined<Partial<MinimumSavedListRow>>({
          url: sourceUrl,
          title: draft.title,
          rent: draft.rent,
          bedrooms: draft.bedrooms,
        }),
      ),
  );

  return withDefined<NormalizedListingJson>({
    groupId: identity.groupId,
    source,
    sourceUrl,
    sourceListingId: draft.sourceListingId,
    title: draft.title ?? "Manual review needed",
    address: draft.address ?? "Unknown address",
    neighborhood: draft.neighborhood,
    borough: draft.borough,
    location: draft.location,
    rent: draft.rent,
    bedrooms: draft.bedrooms,
    bathrooms: draft.bathrooms,
    availableAt: draft.availableAt,
    description: draft.description,
    amenities: draft.amenities ?? [],
    photos: draft.photos ?? [],
    imageEvidence,
    evidence,
    concerns: [...concerns, ...buildConcerns(draft, manualReviewRequired)],
    fitFlags,
  });
}

export function buildListingFromOutput({
  rawUrl,
  identity,
  output,
  intakeKind = "pasted-url",
}: {
  rawUrl: string;
  identity: InviteIdentity;
  output: AiExtractionOutput;
  intakeKind?: "pasted-url" | "batch-search";
}): ListingCandidate {
  const normalized = output.normalizedListing;
  const base = createListingFromUrl(
    rawUrl,
    identity,
    withDefined<ListingDraft>({
      sourceListingId: normalized.sourceListingId,
      title: normalized.title,
      address: normalized.address,
      neighborhood: normalized.neighborhood,
      borough: normalized.borough,
      location: normalized.location,
      rent: normalized.rent,
      bedrooms: normalized.bedrooms,
      bathrooms: normalized.bathrooms,
      availableAt: normalized.availableAt,
      description: normalized.description,
      amenities: normalized.amenities,
      photos: normalized.photos,
    }),
  );
  const extractionStatus = output.status;
  const triageStatus = output.triage.status;
  const triageBucket = output.triage.bucket;
  const nextListing = withDefined<Omit<ListingCandidate, "display">>({
    ...base,
    providerRoute: getProviderRoute(normalized.source, intakeKind),
    providerRouting: {
      ...base.providerRouting,
      intakeKind,
      providerRoute: getProviderRoute(normalized.source, intakeKind),
    },
    userQualified: intakeKind === "pasted-url",
    sourceListingId: normalized.sourceListingId,
    location: normalized.location,
    extractionStatus,
    triageStatus,
    triageBucket,
    fitFlags: normalized.fitFlags,
    amenities: normalized.amenities,
    photos: normalized.photos,
    imageEvidence: normalized.imageEvidence,
    evidence: normalized.evidence,
    evidencePointers:
      output.evidencePointers.length > 0 ? output.evidencePointers : base.evidencePointers,
    concerns: normalized.concerns,
    updatedAt: new Date().toISOString(),
  });

  return {
    ...nextListing,
    display: createSavedListDisplayFields(nextListing),
  };
}

export function buildOutput(
  normalizedListing: AiExtractionOutput["normalizedListing"],
  triage: AgentTriage,
  providerMetadata: AiProviderAttemptMetadata,
  status: ExtractionStatus = "success",
): AiExtractionOutput {
  return {
    status,
    normalizedListing,
    triage,
    providerMetadata,
    evidencePointers: [],
  };
}

export function buildExtractionJob({
  identity,
  listing,
  output,
  intakeKind,
  runId,
  providerMetadata,
}: {
  identity: InviteIdentity;
  listing: ListingCandidate;
  output: AiExtractionOutput;
  intakeKind: "pasted-url" | "batch-search";
  runId?: string;
  providerMetadata: AiProviderAttemptMetadata;
}): ExtractionJob {
  const now = new Date().toISOString();

  return withDefined<ExtractionJob>({
    id: stableId(`${identity.groupId}:extract:${listing.url}:${runId ?? "single"}`),
    groupId: identity.groupId,
    listingId: listing.id,
    submittedUrlId: listing.submittedUrlId,
    runId,
    intakeKind,
    source: listing.source,
    status: output.status,
    triageStatus: output.triage.status,
    providerAttempts: [providerMetadata],
    output,
    createdAt: now,
    updatedAt: now,
  });
}

export function buildConcerns(draft: ListingDraft, manualReviewRequired: boolean): string[] {
  const concerns: string[] = [];

  if (draft.rent === undefined || draft.bedrooms === undefined || !draft.title) {
    concerns.push("Missing required saved-list row fields.");
  }
  if (draft.rent !== undefined && draft.rent > SEARCH_CONFIG.maxRent) {
    concerns.push(`Rent is above the $${SEARCH_CONFIG.maxRent.toLocaleString("en-US")} ceiling.`);
  }
  if (draft.bedrooms !== undefined && draft.bedrooms < SEARCH_CONFIG.minBedrooms) {
    concerns.push(`Bedroom count is below the ${SEARCH_CONFIG.minBedrooms}BR target.`);
  }
  if (draft.bathrooms !== undefined && draft.bathrooms < SEARCH_CONFIG.minBathrooms) {
    concerns.push(`Bathroom count is below the ${SEARCH_CONFIG.minBathrooms} bath target.`);
  }
  if (manualReviewRequired) {
    concerns.push("Manual review needed before treating this extraction as authoritative.");
  }

  return [...new Set(concerns)];
}

export function successfulProviderMetadata(
  imageCount: number,
  concurrencyLimit: number,
  concurrencySlot: number,
  failureCode?: string,
): AiProviderAttemptMetadata {
  return withDefined<AiProviderAttemptMetadata>({
    ...createAiProviderAttemptMetadata("fit-triage", imageCount),
    status: failureCode ? "failed" : "success",
    completedAt: new Date().toISOString(),
    latencyMs: 0,
    inputTokenCount: 0,
    outputTokenCount: 0,
    imageCount: Math.min(imageCount, MAX_IMAGES_PER_LISTING),
    concurrencyLimit,
    concurrencySlot,
    promptVersion: AI_TRIAGE_SCHEMA_VERSION,
    schemaValidation: failureCode ? "failed" : "passed",
    failureCode,
  });
}

export function stableId(value: string): string {
  return `extraction-${createDuplicateKey(`https://fixture.local/${encodeURIComponent(value)}`).replace(/[^a-z0-9]+/g, "-")}`;
}

function withManualFlag(flags: FitFlag[], manualReviewRequired: boolean): FitFlag[] {
  if (!manualReviewRequired) {
    return flags;
  }

  return [...new Set([...flags, "manual_review_needed"])] as FitFlag[];
}
