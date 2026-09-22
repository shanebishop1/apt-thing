import type { ProviderAttempt } from "../providers/http";

export type SourceType = "streeteasy" | "zillow" | "renthop" | "craigslist" | "other";

export type IntakeKind = "pasted-url" | "batch-search" | "manual-entry";

export type SourceTarget = "first-class" | "fallback";

export type ProviderRoute =
  | "streeteasy-realtyapi-url-resolution"
  | "streeteasy-realtyapi-batch-search"
  | "zillow-provider-or-manual-fallback"
  | "generic-source-or-manual-fallback";

export type UrlValidationErrorCode = "empty-url" | "invalid-url" | "unsupported-protocol";

export type UrlValidationResult =
  | { ok: true; normalizedUrl: string }
  | { ok: false; errorCode: UrlValidationErrorCode; feedback: string };

export type ProhibitedSourceAutomation =
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

export type BatchJobStatus = "queued" | "running" | "success" | "partial" | "failed" | "cancelled";

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

export type StorageOwner = "d1" | "r2" | "kv" | "local-fixture";

export type PersistenceBoundary = {
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
  storageKey?: "apt-thing:v1:invite-identity";
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

export type NycGeoSearchResolutionMetadata = {
  status: "pending" | "success" | "failed";
  strategy: "infer-location-candidates-from-streeteasy-url-slug";
  locationCandidates: string[];
};

export type StreetEasySearchMatchProvenance = {
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

export type BatchRunCounts = {
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
  maxImagesPerListing: 5;
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
  requestAttempts?: ProviderAttempt[];
  provider: "google-direct";
  model: "gemini-3.5-flash";
  apiKeyEnv: "GEMINI_API_KEY";
  purpose: "text-normalization" | "image-extraction" | "fit-triage" | "briefing";
  attemptId: string;
  status: "pending" | "success" | "failed";
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  imageCount: number;
  maxImagesPerListing: 5;
  concurrencyLimit?: number;
  concurrencySlot?: number;
  promptVersion?: string;
  schemaValidation?: "passed" | "failed";
  failureCode?: string;
};

export type NormalizedListingJson = {
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

export type ListingLocation = {
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
