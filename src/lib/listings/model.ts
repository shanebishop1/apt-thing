import { withDefined } from "../utils/records";
import { SEARCH_CONFIG } from "../search-config";
import { titleCase } from "../utils/text";
import type {
  AiProviderAttemptMetadata,
  Cadence,
  FieldProvenance,
  FitFlag,
  GroupScopedListingState,
  InviteIdentity,
  ListingCandidate,
  ListingDraft,
  ListingEvidence,
  MinimumSavedListRow,
  PastedListingIntakeInput,
  PastedListingIntakeResult,
  RealtyApiSearchQuery,
  ReviewStatus,
  SavedListDisplayFields,
  SourceType,
  StreetEasyBatchRun,
  StreetEasyUrlResolutionJob,
  SubmittedUrl,
  TriageBucket,
  TriageStatus,
} from "./domain";
import {
  DEFAULT_STREETEASY_URL_RESOLUTION_QUERY,
  GEMINI_PROVIDER_METADATA,
  MAX_IMAGES_PER_LISTING,
  preferredNeighborhoods,
} from "./config";
import {
  capImageEvidence,
  createFieldProvenanceFromDraft,
  createSourceEvidencePointer,
} from "./evidence";
import {
  classifySource,
  createDuplicateKey,
  createGroupScopedDuplicateKey,
  createProviderRoutingMetadata,
  inferStreetEasyLocationCandidates,
  normalizeUrl,
  validateApartmentUrl,
} from "./routing";
import { createId } from "./identity";

export function createSubmittedUrl(rawUrl: string, identity: InviteIdentity): SubmittedUrl {
  const normalizedUrl = normalizeUrl(rawUrl);
  const source = classifySource(normalizedUrl);
  const duplicateKey = createDuplicateKey(normalizedUrl);
  const providerRouting = createProviderRoutingMetadata(source, "pasted-url");

  return {
    id: createId(`${identity.groupId}:submitted:${normalizedUrl}`),
    groupId: identity.groupId,
    rawUrl,
    normalizedUrl,
    source,
    sourceTarget: providerRouting.sourceTarget,
    providerRoute: providerRouting.providerRoute,
    providerRouting,
    duplicateKey,
    groupScopedDuplicateKey: `${identity.groupId}:${duplicateKey}`,
    submittedByDisplayName: identity.displayName,
    submittedAt: new Date().toISOString(),
    userQualified: true,
    intakeKind: "pasted-url",
  };
}

export function createListingFromUrl(
  rawUrl: string,
  identity: InviteIdentity,
  draft: ListingDraft = {},
): ListingCandidate {
  const submittedUrl = createSubmittedUrl(rawUrl, identity);
  const now = new Date().toISOString();
  const inferredDraft = inferDraftFromUrl(submittedUrl.normalizedUrl, submittedUrl.source);
  const mergedDraft = { ...inferredDraft, ...draft };
  const fitFlags = calculateFitFlags(mergedDraft, submittedUrl.normalizedUrl);
  const extractionStatus = hasMinimumRowFields(
    withDefined<Partial<MinimumSavedListRow>>({
      url: submittedUrl.normalizedUrl,
      title: mergedDraft.title,
      rent: mergedDraft.rent,
      bedrooms: mergedDraft.bedrooms,
    }),
  )
    ? "partial"
    : "manual-needed";
  const triageBucket: TriageBucket =
    extractionStatus === "manual-needed" ? "review-needed" : "untriaged";
  const evidencePointers = [
    createSourceEvidencePointer(identity.groupId, submittedUrl.normalizedUrl, now),
  ];
  const imageEvidence = capImageEvidence(
    (mergedDraft.photos ?? []).map((url, index) => ({
      url,
      role: index === 0 ? "primary" : "supporting",
      sentToAi: false,
    })),
  );
  const listingId = createId(`${identity.groupId}:${submittedUrl.normalizedUrl}`);

  const baseListing = withDefined<Omit<ListingCandidate, "display">>({
    id: listingId,
    groupId: identity.groupId,
    source: submittedUrl.source,
    sourceTarget: submittedUrl.sourceTarget,
    providerRoute: submittedUrl.providerRoute,
    providerRouting: submittedUrl.providerRouting,
    sourceListingId: mergedDraft.sourceListingId,
    duplicateKey: submittedUrl.duplicateKey,
    groupScopedDuplicateKey: submittedUrl.groupScopedDuplicateKey,
    url: submittedUrl.normalizedUrl,
    submittedBy: identity.displayName,
    submittedUrlId: submittedUrl.id,
    userQualified: true,
    title: mergedDraft.title ?? "Manual review needed",
    extractionStatus,
    triageStatus: "pending" as TriageStatus,
    triageBucket,
    reviewStatus: "new" as ReviewStatus,
    fitFlags,
    address: mergedDraft.address ?? "Unknown address",
    neighborhood: mergedDraft.neighborhood,
    borough: mergedDraft.borough,
    location: mergedDraft.location,
    rent: mergedDraft.rent,
    bedrooms: mergedDraft.bedrooms,
    bathrooms: mergedDraft.bathrooms,
    availableAt: mergedDraft.availableAt,
    description: mergedDraft.description,
    amenities: mergedDraft.amenities ?? [],
    photos: mergedDraft.photos ?? [],
    imageEvidence,
    evidence: [
      withDefined<ListingEvidence>({
        claim: "Source link captured",
        quote: submittedUrl.normalizedUrl,
        sourceUrl: submittedUrl.normalizedUrl,
        pointerId: evidencePointers[0]?.id,
      }),
    ],
    evidencePointers,
    concerns:
      extractionStatus === "manual-needed"
        ? ["Required row fields need manual entry or AI extraction."]
        : [],
    fieldProvenance: createFieldProvenanceFromDraft(mergedDraft, now),
    createdAt: now,
    updatedAt: now,
  });

  return {
    ...baseListing,
    display: createSavedListDisplayFields(baseListing),
  };
}

export function intakePastedListingUrl({
  rawUrl,
  identity,
  existingListings,
  draft = {},
  streetEasyQuery = DEFAULT_STREETEASY_URL_RESOLUTION_QUERY,
}: PastedListingIntakeInput): PastedListingIntakeResult {
  const validation = validateApartmentUrl(rawUrl);

  if (!validation.ok) {
    return {
      status: "rejected",
      feedback: validation.feedback,
      errorCode: validation.errorCode,
    };
  }

  const submittedUrl = createSubmittedUrl(validation.normalizedUrl, identity);
  const existingListing = existingListings.find(
    (listing) =>
      listing.groupScopedDuplicateKey === submittedUrl.groupScopedDuplicateKey ||
      createGroupScopedDuplicateKey(listing.groupId, listing.url) ===
        submittedUrl.groupScopedDuplicateKey,
  );

  if (existingListing) {
    return {
      status: "duplicate",
      feedback: "Duplicate listing found. Opening the existing saved record instead.",
      submittedUrl,
      existingListing,
    };
  }

  const listing = createListingFromUrl(validation.normalizedUrl, identity, draft);
  const streetEasyResolutionJob =
    listing.source === "streeteasy"
      ? createStreetEasyUrlResolutionJob(identity.groupId, listing.url, streetEasyQuery)
      : undefined;

  return withDefined<Extract<PastedListingIntakeResult, { status: "accepted" }>>({
    status: "accepted",
    feedback: createIntakeFeedback(listing.source),
    submittedUrl,
    listing,
    providerRouting: listing.providerRouting,
    streetEasyResolutionJob,
  });
}

export function createStreetEasyBatchRun(
  groupId: string,
  query: RealtyApiSearchQuery,
  cadence: Cadence = "manual",
): StreetEasyBatchRun {
  const now = new Date().toISOString();

  return {
    id: createId(`${groupId}:streeteasy-batch:${cadence}:${JSON.stringify(query)}`),
    groupId,
    source: "streeteasy",
    providerRoute: "streeteasy-realtyapi-batch-search",
    cadence,
    status: "queued",
    query,
    counts: {
      candidatesFound: 0,
      candidatesSkippedSeen: 0,
      candidatesSkippedTriaged: 0,
      candidatesAnalyzed: 0,
      candidatesSaved: 0,
      candidatesRejected: 0,
    },
    maxImagesPerListing: MAX_IMAGES_PER_LISTING,
    startedAt: now,
    evidencePointers: [],
  };
}

export function createStreetEasyUrlResolutionJob(
  groupId: string,
  sourceUrl: string,
  query: RealtyApiSearchQuery,
): StreetEasyUrlResolutionJob {
  const normalizedUrl = normalizeUrl(sourceUrl);
  const now = new Date().toISOString();
  const parsedUrlPath = new URL(normalizedUrl).pathname;
  const locationCandidates = inferStreetEasyLocationCandidates(parsedUrlPath);

  return {
    id: createId(`${groupId}:streeteasy-url-resolution:${normalizedUrl}`),
    groupId,
    sourceUrl: normalizedUrl,
    status: "pending",
    provenance: {
      parsedUrlPath,
      exactUrlPathMatch: false,
      locationCandidates,
      nycGeoSearch: {
        status: "pending",
        strategy: "infer-location-candidates-from-streeteasy-url-slug",
        locationCandidates,
      },
      pagesScanned: [],
      query,
    },
    detailsEndpoint: "rental_detailsbyid",
    evidencePointers: [createSourceEvidencePointer(groupId, normalizedUrl, now)],
    createdAt: now,
    updatedAt: now,
  };
}

export function createAiProviderAttemptMetadata(
  purpose: AiProviderAttemptMetadata["purpose"],
  imageCount = 0,
): AiProviderAttemptMetadata {
  const cappedImageCount = Math.min(imageCount, MAX_IMAGES_PER_LISTING);

  return {
    ...GEMINI_PROVIDER_METADATA,
    purpose,
    attemptId: createId(`${purpose}:${new Date().toISOString()}:${cappedImageCount}`),
    status: "pending",
    startedAt: new Date().toISOString(),
    imageCount: cappedImageCount,
    maxImagesPerListing: MAX_IMAGES_PER_LISTING,
  };
}

export function createGroupScopedListingState(
  groupId: string,
  rawUrl: string,
  options: Partial<
    Pick<GroupScopedListingState, "seen" | "triaged" | "triageBucket" | "reviewStatus">
  > = {},
): GroupScopedListingState {
  const duplicateKey = createDuplicateKey(rawUrl);

  return withDefined<GroupScopedListingState>({
    groupId,
    duplicateKey,
    groupScopedDuplicateKey: `${groupId}:${duplicateKey}`,
    seen: options.seen ?? true,
    triaged: options.triaged ?? false,
    triageBucket: options.triageBucket ?? "untriaged",
    reviewStatus: options.reviewStatus,
    lastSeenAt: new Date().toISOString(),
  });
}

export function createSavedListDisplayFields(
  listing: Pick<
    ListingCandidate,
    | "url"
    | "title"
    | "source"
    | "rent"
    | "bedrooms"
    | "bathrooms"
    | "address"
    | "neighborhood"
    | "extractionStatus"
    | "triageBucket"
    | "reviewStatus"
    | "fitFlags"
  >,
): SavedListDisplayFields {
  return withDefined<SavedListDisplayFields>({
    url: listing.url,
    title: listing.title,
    source: listing.source,
    rent: listing.rent,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    address: listing.address,
    neighborhood: listing.neighborhood,
    extractionStatus: listing.extractionStatus,
    triageBucket: listing.triageBucket,
    reviewStatus: listing.reviewStatus,
    fitFlags: listing.fitFlags,
  });
}

export function updateReviewStatus(
  listing: ListingCandidate,
  reviewStatus: ReviewStatus,
): ListingCandidate {
  const nextListing = {
    ...listing,
    reviewStatus,
    updatedAt: new Date().toISOString(),
  };

  return {
    ...nextListing,
    display: createSavedListDisplayFields(nextListing),
  };
}

export function updateListingField(
  listing: ListingCandidate,
  field: FieldProvenance["field"],
  value: string | number,
  actorDisplayName: string,
): ListingCandidate {
  const originalValue = listing[field];
  const nextListing = {
    ...listing,
    [field]: value,
    updatedAt: new Date().toISOString(),
  };
  const listingWithFlags = {
    ...nextListing,
    fitFlags: calculateFitFlags(nextListing, nextListing.url),
  };

  return {
    ...listingWithFlags,
    display: createSavedListDisplayFields(listingWithFlags),
    fieldProvenance: [
      ...listing.fieldProvenance,
      {
        field,
        source: originalValue === undefined ? "user-confirmed" : "user-edited",
        originalValue: originalValue === undefined ? "" : String(originalValue),
        editedValue: String(value),
        actorDisplayName,
        actor: actorDisplayName,
        updatedAt: nextListing.updatedAt,
      },
    ],
  };
}

export function calculateFitFlags(draft: ListingDraft, rowUrl = "fixture://draft-row"): FitFlag[] {
  const flags: FitFlag[] = [];

  if (draft.rent !== undefined && draft.rent <= SEARCH_CONFIG.maxRent) {
    flags.push("price_fit");
  }

  if (draft.bedrooms !== undefined && draft.bedrooms >= SEARCH_CONFIG.minBedrooms) {
    flags.push("beds_fit");
  }

  if (draft.bathrooms !== undefined && draft.bathrooms >= SEARCH_CONFIG.minBathrooms) {
    flags.push("bathrooms_fit");
  }

  if (draft.neighborhood && preferredNeighborhoods.has(draft.neighborhood.toLowerCase())) {
    flags.push("location_fit");
  }

  if (
    !hasMinimumRowFields(
      withDefined<Partial<MinimumSavedListRow>>({
        url: rowUrl,
        title: draft.title,
        rent: draft.rent,
        bedrooms: draft.bedrooms,
      }),
    )
  ) {
    flags.push("missing_required_fields", "manual_review_needed");
  }

  return flags;
}

export function hasMinimumRowFields(row: Partial<MinimumSavedListRow>): boolean {
  return Boolean(row.url && row.title && row.rent !== undefined && row.bedrooms !== undefined);
}

function createIntakeFeedback(source: SourceType): string {
  if (source === "streeteasy") {
    return "Saved StreetEasy URL. RealtyAPI/NYC GeoSearch resolution is pending.";
  }

  if (source === "zillow") {
    return "Saved Zillow URL. Provider proof or manual fallback is pending.";
  }

  return "Saved an editable manual-needed stub for this source.";
}

function inferDraftFromUrl(normalizedUrl: string, source: SourceType): ListingDraft {
  const url = new URL(normalizedUrl);
  const readablePath = decodeURIComponent(url.pathname)
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (source === "streeteasy") {
    return {
      title: "StreetEasy listing ready for extraction",
      address: titleCase(getLastPathSegment(readablePath) || "StreetEasy listing"),
      borough: "Manhattan",
    };
  }

  if (source === "zillow") {
    return {
      title: "Zillow listing ready for extraction",
      address: titleCase(getLastPathSegment(readablePath) || "Zillow listing"),
    };
  }

  return {
    title: titleCase(getLastPathSegment(readablePath) || `${source} listing`),
  };
}

function getLastPathSegment(readablePath: string): string {
  const segments = readablePath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}
