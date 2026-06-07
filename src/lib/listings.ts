export type SourceType = "streeteasy" | "zillow" | "renthop" | "craigslist" | "other";

export type ExtractionStatus = "pending" | "success" | "partial" | "failed" | "manual-needed";

export type ReviewStatus = "new" | "interested" | "touring" | "rejected";

export type FitFlag =
  | "price_fit"
  | "beds_fit"
  | "bathrooms_fit"
  | "location_fit"
  | "manual_review_needed"
  | "missing_required_fields";

export type FieldProvenance = {
  field: keyof Pick<
    ListingCandidate,
    "title" | "address" | "neighborhood" | "rent" | "bedrooms" | "bathrooms" | "availableAt"
  >;
  source: "ai-extracted" | "user-confirmed" | "user-edited";
  originalValue?: string;
  editedValue?: string;
  actor?: string;
  updatedAt: string;
};

export type ListingEvidence = {
  claim: string;
  quote: string;
  sourceUrl: string;
};

export type SearchGroup = {
  id: string;
  inviteCode: string;
  name: string;
};

export type ListingCandidate = {
  id: string;
  groupId: string;
  source: SourceType;
  url: string;
  submittedBy: string;
  title: string;
  extractionStatus: ExtractionStatus;
  reviewStatus: ReviewStatus;
  fitFlags: FitFlag[];
  address: string;
  neighborhood?: string;
  borough?: string;
  rent?: number;
  bedrooms?: number;
  bathrooms?: number;
  availableAt?: string;
  description?: string;
  evidence: ListingEvidence[];
  concerns: string[];
  fieldProvenance: FieldProvenance[];
  createdAt: string;
  updatedAt: string;
};

export type InviteIdentity = {
  groupId: string;
  inviteCode: string;
  displayName: string;
};

export type ListingDraft = Partial<
  Pick<
    ListingCandidate,
    | "title"
    | "address"
    | "neighborhood"
    | "borough"
    | "rent"
    | "bedrooms"
    | "bathrooms"
    | "availableAt"
    | "description"
  >
>;

const preferredNeighborhoods = new Set([
  "chelsea",
  "flatiron",
  "nomad",
  "east village",
  "lower east side",
  "greenwich village",
  "nolita",
  "soho",
]);

export const hardcodedSearchGroups: SearchGroup[] = [
  {
    id: "nyc-5br-2026",
    inviteCode: "apt-g1",
    name: "NYC 5BR search",
  },
];

export const defaultSearchGroup = hardcodedSearchGroups[0];

export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl.trim());
  url.hash = "";
  url.searchParams.sort();

  return url.toString();
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

export function createDuplicateKey(rawUrl: string): string {
  const url = new URL(normalizeUrl(rawUrl));
  const path = url.pathname.replace(/\/$/, "").toLowerCase();

  return `${url.hostname.replace(/^www\./, "").toLowerCase()}${path}`;
}

export function createGroupScopedDuplicateKey(groupId: string, rawUrl: string): string {
  return `${groupId}:${createDuplicateKey(rawUrl)}`;
}

export function resolveSearchGroup(inviteCode: string): SearchGroup | undefined {
  return hardcodedSearchGroups.find((group) => group.inviteCode === inviteCode.trim());
}

export function createListingFromUrl(
  rawUrl: string,
  identity: InviteIdentity,
  draft: ListingDraft = {},
): ListingCandidate {
  const normalizedUrl = normalizeUrl(rawUrl);
  const source = classifySource(normalizedUrl);
  const now = new Date().toISOString();
  const inferredDraft = inferDraftFromUrl(normalizedUrl, source);
  const mergedDraft = { ...inferredDraft, ...draft };
  const fitFlags = calculateFitFlags(mergedDraft);
  const extractionStatus: ExtractionStatus = hasMinimumRowFields(mergedDraft)
    ? "partial"
    : "manual-needed";

  return {
    id: createId(`${identity.groupId}:${normalizedUrl}`),
    groupId: identity.groupId,
    source,
    url: normalizedUrl,
    submittedBy: identity.displayName,
    title: mergedDraft.title ?? "Manual review needed",
    extractionStatus,
    reviewStatus: "new",
    fitFlags,
    address: mergedDraft.address ?? "Unknown address",
    neighborhood: mergedDraft.neighborhood,
    borough: mergedDraft.borough,
    rent: mergedDraft.rent,
    bedrooms: mergedDraft.bedrooms,
    bathrooms: mergedDraft.bathrooms,
    availableAt: mergedDraft.availableAt,
    description: mergedDraft.description,
    evidence: [
      {
        claim: "Source link captured",
        quote: normalizedUrl,
        sourceUrl: normalizedUrl,
      },
    ],
    concerns:
      extractionStatus === "manual-needed"
        ? ["Required row fields need manual entry or AI extraction."]
        : [],
    fieldProvenance: Object.entries(mergedDraft).map(([field, value]) => ({
      field: field as FieldProvenance["field"],
      source: "ai-extracted",
      originalValue: String(value),
      updatedAt: now,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function updateReviewStatus(
  listing: ListingCandidate,
  reviewStatus: ReviewStatus,
): ListingCandidate {
  return {
    ...listing,
    reviewStatus,
    updatedAt: new Date().toISOString(),
  };
}

export function updateListingField(
  listing: ListingCandidate,
  field: FieldProvenance["field"],
  value: string | number,
  actor: string,
): ListingCandidate {
  const originalValue = listing[field];
  const nextListing = {
    ...listing,
    [field]: value,
    updatedAt: new Date().toISOString(),
  };

  return {
    ...nextListing,
    fitFlags: calculateFitFlags(nextListing),
    fieldProvenance: [
      ...listing.fieldProvenance,
      {
        field,
        source: originalValue === undefined ? "user-confirmed" : "user-edited",
        originalValue: originalValue === undefined ? undefined : String(originalValue),
        editedValue: String(value),
        actor,
        updatedAt: nextListing.updatedAt,
      },
    ],
  };
}

export function calculateFitFlags(draft: ListingDraft): FitFlag[] {
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

  if (!hasMinimumRowFields(draft)) {
    flags.push("missing_required_fields", "manual_review_needed");
  }

  return flags;
}

export function hasMinimumRowFields(draft: ListingDraft): boolean {
  return Boolean(draft.title && draft.rent !== undefined && draft.bedrooms !== undefined);
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
      address: titleCase(readablePath.split("/").at(-1) || "StreetEasy listing"),
      borough: "Manhattan",
    };
  }

  if (source === "zillow") {
    return {
      title: "Zillow listing ready for extraction",
      address: titleCase(readablePath.split("/").at(-1) || "Zillow listing"),
    };
  }

  return {
    title: titleCase(readablePath.split("/").filter(Boolean).at(-1) || `${source} listing`),
  };
}

function createId(normalizedUrl: string): string {
  const bytes = new TextEncoder().encode(normalizedUrl);
  let hash = 0;

  for (const byte of bytes) {
    hash = (hash * 31 + byte) >>> 0;
  }

  return `listing-${hash.toString(36)}`;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
