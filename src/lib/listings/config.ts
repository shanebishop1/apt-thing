import { SEARCH_CONFIG } from "../search-config";
import type {
  Cadence,
  ExtractionStatus,
  PersistenceBoundary,
  ProhibitedSourceAutomation,
  RealtyApiSearchQuery,
  ReviewStatus,
  RunStatus,
  TriageStatus,
} from "./domain";

export const PREFERRED_NEIGHBORHOODS = SEARCH_CONFIG.preferredNeighborhoods.map((name) =>
  name.toLowerCase(),
);

export const preferredNeighborhoods = new Set<string>(PREFERRED_NEIGHBORHOODS);

export const MAX_IMAGES_PER_LISTING = 5;

export const PROHIBITED_SOURCE_AUTOMATION: ProhibitedSourceAutomation[] = [
  "credential-theft",
  "captcha-bypass",
  "login-automation",
  "abusive-traffic",
] as const;

export const DEFAULT_STREETEASY_URL_RESOLUTION_QUERY: RealtyApiSearchQuery = {
  endpoint: "search/rent",
  areas: [],
  minBeds: SEARCH_CONFIG.minBedrooms,
  maxRent: SEARCH_CONFIG.maxRent,
  rentalStatus: "active",
  sort: "newest",
};

export const DEFAULT_STREETEASY_DISCOVERY_QUERY: RealtyApiSearchQuery = {
  ...DEFAULT_STREETEASY_URL_RESOLUTION_QUERY,
  areas: [...PREFERRED_NEIGHBORHOODS],
};

export const INVITE_IDENTITY_STORAGE_KEY = "apt-thing:v1:invite-identity";
export const INVITE_LINK_BASE_PATH = "/invite";

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
