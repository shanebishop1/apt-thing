import { stableHash } from "./utils/ids";
import { withDefined } from "./utils/records";
import { titleCase } from "./utils/text";

export type SourceType = "streeteasy" | "zillow" | "renthop" | "craigslist" | "other";

export type IntakeKind = "pasted-url" | "batch-search" | "manual-entry";

export type SourceTarget = "first-class" | "fallback";

export type ProviderRoute =
  | "streeteasy-realtyapi-url-resolution"
  | "streeteasy-realtyapi-batch-search"
  | "zillow-provider-or-manual-fallback"
  | "generic-source-or-manual-fallback";

type UrlValidationErrorCode = "empty-url" | "invalid-url" | "unsupported-protocol";

type UrlValidationResult =
  | { ok: true; normalizedUrl: string }
  | { ok: false; errorCode: UrlValidationErrorCode; feedback: string };

type ProhibitedSourceAutomation =
  | "credential-theft"
  | "captcha-bypass"
  | "login-automation"
  | "abusive-traffic";

export type ProviderRoutingMetadata = {
  source: SourceType;
  sourceTarget: SourceTarget;
  providerRoute: ProviderRoute;
  intakeKind: IntakeKind;
  primaryProvider: "realtyapi" | "provider-proof-pending" | "none";
  fallback: "editable-manual-needed-stub";
  manualFallbackRequired: boolean;
  resolutionSteps: string[];
  prohibitedAutomation: ProhibitedSourceAutomation[];
  notes: string;
};

export type ExtractionStatus = "pending" | "success" | "partial" | "failed" | "manual-needed";

export type TriageBucket = "untriaged" | "confirmed-match" | "review-needed" | "rejected";

export type TriageStatus =
  | "pending"
  | "analyzing"
  | "success"
  | "partial"
  | "failed"
  | "skipped-seen";

type BatchJobStatus = "queued" | "running" | "success" | "partial" | "failed" | "cancelled";

export type RunStatus = BatchJobStatus;

export type Cadence = "manual" | "daily" | "hourly";

export type ReviewStatus =
  | "review"
  | "new"
  | "interested"
  | "touring"
  | "unavailable"
  | "gone"
  | "rejected";

export type FitFlag =
  | "price_fit"
  | "beds_fit"
  | "bathrooms_fit"
  | "location_fit"
  | "manual_review_needed"
  | "missing_required_fields";

type StorageOwner = "d1" | "r2" | "kv" | "local-fixture";

type PersistenceBoundary = {
  owner: StorageOwner;
  scope: "authoritative-relational" | "raw-artifact" | "cache-config" | "local-mock";
  groupScoped: boolean;
  notes: string;
};

export type FieldProvenance = {
  field: keyof Pick<
    ListingCandidate,
    "title" | "address" | "neighborhood" | "rent" | "bedrooms" | "bathrooms" | "availableAt"
  >;
  source: "ai-extracted" | "user-confirmed" | "user-edited" | "source-provider";
  originalValue?: string;
  editedValue?: string;
  actorDisplayName?: string;
  actor?: string;
  updatedAt: string;
};

/** The listing fields a reviewer may edit by hand, in the order the edit UI renders them. */
export const EDITABLE_LISTING_FIELDS = [
  "title",
  "address",
  "neighborhood",
  "rent",
  "bedrooms",
  "bathrooms",
  "availableAt",
] as const satisfies readonly FieldProvenance["field"][];

/** The subset of {@link EDITABLE_LISTING_FIELDS} whose values are parsed as numbers. */
export const NUMERIC_LISTING_FIELDS = [
  "rent",
  "bedrooms",
  "bathrooms",
] as const satisfies readonly FieldProvenance["field"][];

export function isEditableListingField(value: unknown): value is FieldProvenance["field"] {
  return (
    typeof value === "string" && (EDITABLE_LISTING_FIELDS as readonly string[]).includes(value)
  );
}

export type EvidencePointer = {
  id: string;
  groupId: string;
  listingId?: string;
  runId?: string;
  kind: "source-page" | "api-payload" | "screenshot" | "image" | "ai-output" | "manual-note";
  sourceUrl?: string;
  storage: Pick<PersistenceBoundary, "owner" | "scope" | "groupScoped">;
  r2Key?: string;
  d1Table?: "listing_evidence" | "agent_runs" | "extraction_jobs" | "saved_listings";
  quote?: string;
  capturedAt: string;
};

export type ListingEvidence = {
  claim: string;
  quote: string;
  sourceUrl: string;
  pointerId?: string;
};

/**
 * Public group metadata. Accepted invite codes are server-only configuration
 * (`GROUP_INVITE_CODES`, see src/lib/api-auth.ts) and are never part of this type.
 */
export type SearchGroup = {
  id: string;
  name: string;
  createdAt: string;
};

export type InviteIdentity = {
  groupId: string;
  displayName: string;
  identityToken: string;
  persistedIn?: "localStorage";
  storageKey?: typeof INVITE_IDENTITY_STORAGE_KEY;
};

export type ParsedInviteInput = {
  resolvedFrom: "invite-code" | "invite-link";
  inviteCode: string;
};

export type SubmittedUrl = {
  id: string;
  groupId: string;
  rawUrl: string;
  normalizedUrl: string;
  source: SourceType;
  sourceTarget: SourceTarget;
  providerRoute: ProviderRoute;
  providerRouting: ProviderRoutingMetadata;
  duplicateKey: string;
  groupScopedDuplicateKey: string;
  submittedByDisplayName: string;
  submittedAt: string;
  userQualified: boolean;
  intakeKind: "pasted-url";
};

export type RealtyApiSearchQuery = {
  endpoint: "search/rent";
  areas: string[];
  minBeds?: number;
  maxRent?: number;
  rentalStatus?: "active" | "available";
  sort?: "newest" | "price_desc" | "price_asc";
  page?: number;
  perPage?: number;
};

type NycGeoSearchResolutionMetadata = {
  status: "pending" | "success" | "failed";
  strategy: "infer-location-candidates-from-streeteasy-url-slug";
  locationCandidates: string[];
};

type StreetEasySearchMatchProvenance = {
  parsedUrlPath: string;
  listingId?: string;
  realtyApiListingId?: string;
  exactUrlPathMatch: boolean;
  matchedUrlPath?: string;
  locationCandidates: string[];
  nycGeoSearch: NycGeoSearchResolutionMetadata;
  pagesScanned: number[];
  query: RealtyApiSearchQuery;
};

export type StreetEasyUrlResolutionJob = {
  id: string;
  groupId: string;
  sourceUrl: string;
  status: ExtractionStatus;
  provenance: StreetEasySearchMatchProvenance;
  detailsEndpoint?: "rental_detailsbyid";
  evidencePointers: EvidencePointer[];
  createdAt: string;
  updatedAt: string;
};

type BatchRunCounts = {
  candidatesFound: number;
  candidatesSkippedSeen: number;
  candidatesSkippedTriaged: number;
  candidatesAnalyzed: number;
  candidatesSaved: number;
  candidatesRejected: number;
};

export type StreetEasyBatchRun = {
  id: string;
  groupId: string;
  source: "streeteasy";
  providerRoute: "streeteasy-realtyapi-batch-search";
  cadence: Cadence;
  status: RunStatus;
  query: RealtyApiSearchQuery;
  counts: BatchRunCounts;
  maxImagesPerListing: typeof MAX_IMAGES_PER_LISTING;
  startedAt: string;
  completedAt?: string;
  evidencePointers: EvidencePointer[];
};

export type ExtractionJob = {
  id: string;
  groupId: string;
  listingId?: string;
  submittedUrlId?: string;
  runId?: string;
  intakeKind: IntakeKind;
  source: SourceType;
  status: ExtractionStatus;
  triageStatus: TriageStatus;
  providerAttempts: AiProviderAttemptMetadata[];
  output?: AiExtractionOutput;
  createdAt: string;
  updatedAt: string;
};

export type AiProviderAttemptMetadata = {
  provider: typeof GEMINI_PROVIDER_METADATA.provider;
  model: typeof GEMINI_PROVIDER_METADATA.model;
  apiKeyEnv: typeof GEMINI_PROVIDER_METADATA.apiKeyEnv;
  purpose: "text-normalization" | "image-extraction" | "fit-triage" | "briefing";
  attemptId: string;
  status: "pending" | "success" | "failed";
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  imageCount: number;
  maxImagesPerListing: typeof MAX_IMAGES_PER_LISTING;
  concurrencyLimit?: number;
  concurrencySlot?: number;
  promptVersion?: string;
  schemaValidation?: "passed" | "failed";
  failureCode?: string;
};

type NormalizedListingJson = {
  groupId: string;
  source: SourceType;
  sourceUrl: string;
  sourceListingId?: string;
  title: string;
  address: string;
  neighborhood?: string;
  borough?: string;
  location?: ListingLocation;
  rent?: number;
  bedrooms?: number;
  bathrooms?: number;
  availableAt?: string;
  description?: string;
  amenities: string[];
  photos: string[];
  imageEvidence: ImageEvidence[];
  evidence: ListingEvidence[];
  concerns: string[];
  fitFlags: FitFlag[];
};

export type AiExtractionOutput = {
  status: ExtractionStatus;
  normalizedListing: NormalizedListingJson;
  triage: AgentTriage;
  providerMetadata: AiProviderAttemptMetadata;
  evidencePointers: EvidencePointer[];
};

export type ImageEvidence = {
  url: string;
  role: "primary" | "supporting";
  sentToAi: boolean;
};

type ListingLocation = {
  latitude?: number;
  longitude?: number;
  subwayContext?: string;
  amenityContext?: string[];
};

export type AgentTriage = {
  bucket: TriageBucket;
  status: TriageStatus;
  confidence: {
    realFiveBedroom: number;
    twoPlusBathrooms: number;
    priceFit: number;
    locationFit: number;
    overall: number;
  };
  reasons: string[];
  concerns: string[];
  downgradeReasons: string[];
  rejectionReasons: string[];
  suggestedAction?: string;
};

export type GroupScopedListingState = {
  groupId: string;
  duplicateKey: string;
  groupScopedDuplicateKey: string;
  sourceListingKey?: string;
  seen: boolean;
  triaged: boolean;
  triageBucket: TriageBucket;
  reviewStatus?: ReviewStatus;
  lastSeenAt: string;
};

export type ListingCandidate = {
  id: string;
  groupId: string;
  source: SourceType;
  sourceTarget: SourceTarget;
  providerRoute: ProviderRoute;
  providerRouting: ProviderRoutingMetadata;
  sourceListingId?: string;
  duplicateKey: string;
  groupScopedDuplicateKey: string;
  url: string;
  submittedBy: string;
  submittedUrlId?: string;
  userQualified: boolean;
  title: string;
  extractionStatus: ExtractionStatus;
  triageStatus: TriageStatus;
  triageBucket: TriageBucket;
  reviewStatus: ReviewStatus;
  fitFlags: FitFlag[];
  address: string;
  neighborhood?: string;
  borough?: string;
  location?: ListingLocation;
  rent?: number;
  bedrooms?: number;
  bathrooms?: number;
  availableAt?: string;
  description?: string;
  amenities: string[];
  photos: string[];
  imageEvidence: ImageEvidence[];
  evidence: ListingEvidence[];
  evidencePointers: EvidencePointer[];
  concerns: string[];
  fieldProvenance: FieldProvenance[];
  display: SavedListDisplayFields;
  createdAt: string;
  updatedAt: string;
  /** D1 optimistic-concurrency revision; present on listings read from shared storage. */
  revision?: number;
};

export type SavedListDisplayFields = {
  url: string;
  title: string;
  source: SourceType;
  rent?: number;
  bedrooms?: number;
  bathrooms?: number;
  address: string;
  neighborhood?: string;
  extractionStatus: ExtractionStatus;
  triageBucket: TriageBucket;
  reviewStatus: ReviewStatus;
  fitFlags: FitFlag[];
};

export type ListingDraft = Partial<
  Pick<
    ListingCandidate,
    | "title"
    | "address"
    | "neighborhood"
    | "borough"
    | "location"
    | "rent"
    | "bedrooms"
    | "bathrooms"
    | "availableAt"
    | "description"
    | "amenities"
    | "photos"
    | "sourceListingId"
  >
>;

export type MinimumSavedListRow = Pick<ListingCandidate, "url" | "title"> &
  Partial<Pick<ListingCandidate, "rent" | "bedrooms">>;

export type PastedListingIntakeInput = {
  rawUrl: string;
  identity: InviteIdentity;
  existingListings: ListingCandidate[];
  draft?: ListingDraft;
  streetEasyQuery?: RealtyApiSearchQuery;
};

export type PastedListingIntakeResult =
  | {
      status: "accepted";
      feedback: string;
      submittedUrl: SubmittedUrl;
      listing: ListingCandidate;
      providerRouting: ProviderRoutingMetadata;
      streetEasyResolutionJob?: StreetEasyUrlResolutionJob;
    }
  | {
      status: "duplicate";
      feedback: string;
      submittedUrl: SubmittedUrl;
      existingListing: ListingCandidate;
    }
  | {
      status: "rejected";
      feedback: string;
      errorCode: UrlValidationErrorCode;
    };

export const PREFERRED_NEIGHBORHOODS = [
  "chelsea",
  "flatiron",
  "nomad",
  "east village",
  "lower east side",
  "greenwich village",
  "nolita",
  "soho",
] as const;

const preferredNeighborhoods = new Set<string>(PREFERRED_NEIGHBORHOODS);

export const MAX_IMAGES_PER_LISTING = 5;

export const PROHIBITED_SOURCE_AUTOMATION: ProhibitedSourceAutomation[] = [
  "credential-theft",
  "captcha-bypass",
  "login-automation",
  "abusive-traffic",
];

const DEFAULT_STREETEASY_URL_RESOLUTION_QUERY: RealtyApiSearchQuery = {
  endpoint: "search/rent",
  areas: [],
  minBeds: 5,
  maxRent: 15000,
  rentalStatus: "active",
  sort: "newest",
};

export const INVITE_IDENTITY_STORAGE_KEY = "apt-thing:v1:invite-identity";
const INVITE_LINK_BASE_PATH = "/invite";

export const GEMINI_PROVIDER_METADATA = {
  provider: "google-direct",
  model: "gemini-3.5-flash",
  apiKeyEnv: "GEMINI_API_KEY",
} as const;

export const CONTRACT_PERSISTENCE_BOUNDARIES = {
  savedListings: {
    owner: "d1",
    scope: "authoritative-relational",
    groupScoped: true,
    notes:
      "D1 owns saved listings, review state, duplicate keys, provenance, and run logs after proof.",
  },
  rawEvidence: {
    owner: "d1",
    scope: "authoritative-relational",
    groupScoped: true,
    notes:
      "D1 stores source links, source image URLs, quoted evidence, and extraction metadata; R2 raw artifact storage is disabled for the near-term MVP.",
  },
  cacheConfig: {
    owner: "kv",
    scope: "cache-config",
    groupScoped: false,
    notes: "KV is cache/config only and is not the authoritative saved-list store.",
  },
  localMock: {
    owner: "local-fixture",
    scope: "local-mock",
    groupScoped: true,
    notes: "Fixtures/local mocks mirror D1/KV ownership fields without live credentials.",
  },
} satisfies Record<string, PersistenceBoundary>;

export const CADENCES: Cadence[] = ["manual", "daily", "hourly"];
export const EXTRACTION_STATUSES: ExtractionStatus[] = [
  "pending",
  "success",
  "partial",
  "failed",
  "manual-needed",
];
export const TRIAGE_STATUSES: TriageStatus[] = [
  "pending",
  "analyzing",
  "success",
  "partial",
  "failed",
  "skipped-seen",
];
export const BATCH_RUN_STATUSES: RunStatus[] = [
  "queued",
  "running",
  "success",
  "partial",
  "failed",
  "cancelled",
];
export const REVIEW_STATUSES: ReviewStatus[] = [
  "review",
  "new",
  "interested",
  "touring",
  "unavailable",
  "gone",
  "rejected",
];

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return REVIEW_STATUSES.some((status) => status === value);
}

const searchGroups: SearchGroup[] = [
  {
    id: "nyc-5br-2026",
    name: "NYC 5BR search",
    createdAt: "2026-06-04T00:00:00.000Z",
  },
];

export const defaultSearchGroup = searchGroups[0]!;

function validateApartmentUrl(rawUrl: string): UrlValidationResult {
  const trimmedUrl = rawUrl.trim();

  if (!trimmedUrl) {
    return {
      ok: false,
      errorCode: "empty-url",
      feedback: "Paste a valid apartment listing URL before saving.",
    };
  }

  let url: URL;

  try {
    url = new URL(trimmedUrl);
  } catch {
    return {
      ok: false,
      errorCode: "invalid-url",
      feedback: "Enter a valid apartment listing URL, including http:// or https://.",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      errorCode: "unsupported-protocol",
      feedback: "Only http:// and https:// apartment listing URLs can be saved.",
    };
  }

  url.hash = "";
  url.searchParams.sort();

  return { ok: true, normalizedUrl: url.toString() };
}

export function normalizeUrl(rawUrl: string): string {
  const validation = validateApartmentUrl(rawUrl);

  if (!validation.ok) {
    throw new TypeError(validation.feedback);
  }

  return validation.normalizedUrl;
}

export function classifySource(rawUrl: string): SourceType {
  const hostname = new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();

  if (hostname.endsWith("streeteasy.com")) {
    return "streeteasy";
  }

  if (hostname.endsWith("zillow.com")) {
    return "zillow";
  }

  if (hostname.endsWith("renthop.com")) {
    return "renthop";
  }

  if (hostname.endsWith("craigslist.org")) {
    return "craigslist";
  }

  return "other";
}

export function getSourceTarget(source: SourceType): SourceTarget {
  return source === "streeteasy" || source === "zillow" ? "first-class" : "fallback";
}

export function getProviderRoute(source: SourceType, intakeKind: IntakeKind): ProviderRoute {
  if (source === "streeteasy" && intakeKind === "batch-search") {
    return "streeteasy-realtyapi-batch-search";
  }

  if (source === "streeteasy") {
    return "streeteasy-realtyapi-url-resolution";
  }

  if (source === "zillow") {
    return "zillow-provider-or-manual-fallback";
  }

  return "generic-source-or-manual-fallback";
}

export function createProviderRoutingMetadata(
  source: SourceType,
  intakeKind: IntakeKind,
): ProviderRoutingMetadata {
  const sourceTarget = getSourceTarget(source);
  const providerRoute = getProviderRoute(source, intakeKind);
  const base = {
    source,
    sourceTarget,
    providerRoute,
    intakeKind,
    fallback: "editable-manual-needed-stub" as const,
    prohibitedAutomation: [...PROHIBITED_SOURCE_AUTOMATION],
  };

  if (source === "streeteasy") {
    return {
      ...base,
      primaryProvider: "realtyapi",
      manualFallbackRequired: false,
      resolutionSteps:
        intakeKind === "batch-search"
          ? [
              "call-realtyapi-search-rent",
              "skip-group-seen-or-triaged-candidates",
              "fetch-realtyapi-rental_detailsbyid",
            ]
          : [
              "parse-streeteasy-url-path",
              "infer-location-candidates-with-nyc-geosearch",
              "scan-realtyapi-search-rent-for-exact-urlpath",
              "fetch-realtyapi-rental_detailsbyid",
            ],
      notes:
        "StreetEasy pasted URLs route first through NYC GeoSearch-assisted RealtyAPI URL resolution; no source-page automation is attempted here.",
    };
  }

  if (source === "zillow") {
    return {
      ...base,
      primaryProvider: "provider-proof-pending",
      manualFallbackRequired: true,
      resolutionSteps: ["record-zillow-url", "queue-provider-proof-or-manual-entry"],
      notes:
        "Zillow is a first-class source target, but the app records provider/manual fallback metadata until a bounded provider integration is implemented.",
    };
  }

  return {
    ...base,
    primaryProvider: "none",
    manualFallbackRequired: true,
    resolutionSteps: ["classify-source", "create-editable-manual-needed-stub"],
    notes:
      "Unsupported or blocked sources are saved as editable manual-needed stubs without credentials, CAPTCHA bypass, login automation, or abusive traffic.",
  };
}

export function createDuplicateKey(rawUrl: string): string {
  const url = new URL(normalizeUrl(rawUrl));
  const path = url.pathname.replace(/\/$/, "").toLowerCase();

  return `${url.hostname.replace(/^www\./, "").toLowerCase()}${path}`;
}

export function createGroupScopedDuplicateKey(groupId: string, rawUrl: string): string {
  return `${groupId}:${createDuplicateKey(rawUrl)}`;
}

export function createInviteLinkPath(inviteCode: string): string {
  return `${INVITE_LINK_BASE_PATH}/${encodeURIComponent(inviteCode.trim())}`;
}

export function findSearchGroup(groupId: string): SearchGroup | undefined {
  return searchGroups.find((group) => group.id === groupId.trim());
}

export function createGroupIdentity(
  groupId: string,
  displayName: string,
): InviteIdentity | undefined {
  const group = findSearchGroup(groupId);
  const normalizedDisplayName = displayName.trim();

  if (!group || !normalizedDisplayName) {
    return undefined;
  }

  return {
    groupId: group.id,
    displayName: normalizedDisplayName,
    identityToken: createActorIdentityToken(group.id, normalizedDisplayName),
    persistedIn: "localStorage",
    storageKey: INVITE_IDENTITY_STORAGE_KEY,
  };
}

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
  const extractionStatus: ExtractionStatus = hasMinimumRowFields(
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

export function capImageEvidence(images: ImageEvidence[]): ImageEvidence[] {
  return images.slice(0, MAX_IMAGES_PER_LISTING).map((image, index) => ({
    ...image,
    role: index === 0 ? "primary" : image.role,
    sentToAi: true,
  }));
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

  if (draft.rent !== undefined && draft.rent <= 15000) {
    flags.push("price_fit");
  }

  if (draft.bedrooms !== undefined && draft.bedrooms >= 5) {
    flags.push("beds_fit");
  }

  if (draft.bathrooms !== undefined && draft.bathrooms >= 2) {
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

export function parseInviteInput(inviteInput: string): ParsedInviteInput {
  const trimmedInput = inviteInput.trim();

  try {
    const url = new URL(trimmedInput);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const inviteIndex = pathParts.indexOf(INVITE_LINK_BASE_PATH.slice(1));

    if (inviteIndex >= 0 && pathParts[inviteIndex + 1]) {
      return {
        resolvedFrom: "invite-link",
        inviteCode: decodeURIComponent(pathParts[inviteIndex + 1]!),
      };
    }
  } catch {
    // Plain invite codes and relative invite paths continue below.
  }

  if (trimmedInput.startsWith(`${INVITE_LINK_BASE_PATH}/`)) {
    return {
      resolvedFrom: "invite-link",
      inviteCode: decodeURIComponent(trimmedInput.slice(INVITE_LINK_BASE_PATH.length + 1)),
    };
  }

  return { resolvedFrom: "invite-code", inviteCode: trimmedInput };
}

function createActorIdentityToken(groupId: string, displayName: string): string {
  const normalizedDisplayName = displayName.trim().toLowerCase();
  const bytes = new TextEncoder().encode(`${groupId}:${normalizedDisplayName}`);
  let hash = 0;

  for (const byte of bytes) {
    hash = (hash * 31 + byte) >>> 0;
  }

  return `actor_${groupId}_${hash.toString(36)}`;
}

function createSourceEvidencePointer(
  groupId: string,
  sourceUrl: string,
  capturedAt: string,
): EvidencePointer {
  return {
    id: createId(`${groupId}:evidence:${sourceUrl}`),
    groupId,
    kind: "source-page",
    sourceUrl,
    storage: {
      owner: "d1",
      scope: "authoritative-relational",
      groupScoped: true,
    },
    d1Table: "listing_evidence",
    quote: sourceUrl,
    capturedAt,
  };
}

const editableProvenanceFields = new Set<string>(EDITABLE_LISTING_FIELDS);

function createFieldProvenanceFromDraft(draft: ListingDraft, updatedAt: string): FieldProvenance[] {
  return Object.entries(draft)
    .filter(([field, value]) => editableProvenanceFields.has(field) && value !== undefined)
    .map(([field, value]) => ({
      field: field as FieldProvenance["field"],
      source: "ai-extracted" as const,
      originalValue: String(value),
      updatedAt,
    }));
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

function inferStreetEasyLocationCandidates(parsedUrlPath: string): string[] {
  const normalizedPath = parsedUrlPath.toLowerCase();
  const candidates = new Set<string>();

  for (const neighborhood of preferredNeighborhoods) {
    if (normalizedPath.includes(neighborhood.replace(/\s+/g, "-"))) {
      candidates.add(neighborhood);
    }
  }

  if (normalizedPath.includes("new_york") || normalizedPath.includes("manhattan")) {
    candidates.add("manhattan");
  }

  return [...candidates];
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

function createId(normalizedUrl: string): string {
  return `listing-${stableHash(normalizedUrl)}`;
}
