import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GEMINI_PROVIDER_METADATA, MAX_IMAGES_PER_LISTING } from "./listings";

export const ACQUISITION_CLASSIFICATIONS = [
  "success",
  "partial",
  "blocked",
  "policy_disallowed",
  "dynamic_needs_browser",
  "manual_needed",
  "deferred",
] as const;

export type AcquisitionClassification = (typeof ACQUISITION_CLASSIFICATIONS)[number];

export type AcquisitionMode = "fixture" | "live-safe";

export type AcquisitionSource =
  | "streeteasy"
  | "zillow"
  | "nybits"
  | "openigloo"
  | "osm-overpass"
  | "maplibre-openfreemap";

export type AcquisitionFailureCode =
  | "none"
  | "missing-firecrawl-api-key"
  | "missing-gemini-api-key"
  | "missing-realtyapi-key"
  | "streeteasy-urlpath-miss"
  | "streeteasy-detail-empty-retry"
  | "provider-proof-pending"
  | "manual-input-required"
  | "dynamic-browser-required"
  | "policy-disallowed-broad-crawl"
  | "policy-disallowed-hidden-api"
  | "policy-disallowed-login-scrape"
  | "policy-disallowed-anti-bot-bypass"
  | "gemini-output-hard-constraint-rejected"
  | "fixture-mode-network-deferred";

export type ArtifactRootKind = "raw-local" | "sanitized-committed";

export type AcquisitionArtifactRoot = {
  rootKind: ArtifactRootKind;
  path: string;
  committed: boolean;
  retention: string;
  redaction: string;
  futureOwner: "r2" | "d1" | "repo";
};

export type AcquisitionArtifactRecord = {
  id: string;
  rootKind: ArtifactRootKind;
  relativePath: string;
  artifactKind:
    | "run-manifest"
    | "firecrawl-output"
    | "manual-url-sample"
    | "email-sample"
    | "screenshot-reference"
    | "open-context-response"
    | "map-render-proof"
    | "gemini-output"
    | "normalized-candidates"
    | "source-classifications"
    | "summary";
  sourceKey: string;
  sanitized: boolean;
  payload: unknown;
  futureStorage: {
    d1PointerField?: string;
    r2ObjectKeyPattern?: string;
  };
};

export const ACQUISITION_ARTIFACT_CONTRACT = {
  schemaVersion: "g2a-acquisition-artifact-contract-v1",
  roots: {
    raw: {
      rootKind: "raw-local",
      path: "tmp/proof-output/acquisition/raw",
      committed: false,
      retention:
        "local proof evidence only; do not commit secrets, paid data, raw emails, or source photos",
      redaction:
        "raw captures must omit API keys/auth headers and only include bounded non-sensitive samples",
      futureOwner: "r2",
    },
    sanitized: {
      rootKind: "sanitized-committed",
      path: "fixtures/acquisition/sanitized",
      committed: true,
      retention:
        "safe fixture/proof summaries may be committed when they contain no secrets or private emails",
      redaction:
        "strip credentials, sender/recipient addresses, cookies, hidden tokens, and full-size source images",
      futureOwner: "repo",
    },
  } satisfies Record<string, AcquisitionArtifactRoot>,
  runManifest: {
    schemaVersion: "g2a-acquisition-run-manifest-v1",
    requiredFields: [
      "runId",
      "mode",
      "startedAt",
      "artifactRoots",
      "apiKeyAvailability",
      "sourceClassifications",
    ],
  },
  normalizedCandidate: {
    schemaVersion: "g2a-normalized-candidate-v1",
    requiredFields: [
      "id",
      "source",
      "sourceUrl",
      "visibleFacts",
      "quotedEvidence",
      "extractionMetadata",
      "aiAnalysis",
      "classification",
    ],
  },
  evidenceRecord: {
    schemaVersion: "g2a-source-evidence-v1",
    requiredFields: ["claim", "quote", "sourceUrl", "artifactId", "capturedAt"],
  },
  futureStorageBoundaries: {
    d1: {
      owns: [
        "run manifests",
        "candidate metadata",
        "source classification rows",
        "failure codes",
        "R2 artifact pointers",
      ],
      notOwnerOf: ["raw Firecrawl payload bodies", "screenshots", "source image binaries"],
    },
    r2: {
      owns: [
        "raw Firecrawl payloads",
        "screenshots",
        "open context responses",
        "provider payload snapshots",
      ],
      pointerShape: "r2://acquisition/{groupId}/{runId}/{sourceKey}/{artifactId}.json",
    },
  },
  redaction: [
    { appliesTo: "api keys and auth headers", action: "never persist" },
    { appliesTo: "email samples", action: "sanitize sender/recipient" },
    { appliesTo: "screenshots", action: "commit references or redacted thumbnails only" },
    {
      appliesTo: "source images",
      action: "store capped source URLs and private R2 pointers, not image binaries",
    },
  ],
} as const;

export type AcquisitionRunManifest = {
  schemaVersion: "g2a-acquisition-run-manifest-v1";
  runId: string;
  mode: AcquisitionMode;
  startedAt: string;
  artifactRoots: typeof ACQUISITION_ARTIFACT_CONTRACT.roots;
  apiKeyAvailability: {
    firecrawl: boolean;
    gemini: boolean;
    realtyapi: boolean;
    overpassNetwork: boolean;
  };
  sourceClassifications: SourceClassificationRecord[];
  rawRoot: string;
  sanitizedRoot: string;
};

export type SourceEvidenceRecord = {
  schemaVersion: "g2a-source-evidence-v1";
  claim: string;
  quote: string;
  sourceUrl: string;
  artifactId: string;
  capturedAt: string;
};

export type CandidateExtractionMetadata = {
  extractor: string;
  mode: AcquisitionMode;
  capturedAt: string;
  sourceClassification: AcquisitionClassification;
  failureCode: AcquisitionFailureCode;
  queryMetadata?: Record<string, unknown>;
  pageMetadata?: Record<string, unknown>;
  detailRetryMetadata?: Array<{
    endpoint: string;
    attempt: number;
    status: "success" | "empty-success";
  }>;
  skipMetadata?: Array<{ listingId: string; reason: "seen" | "triaged" }>;
};

export type AcquisitionAiAnalysis = {
  providerMetadata: {
    provider: typeof GEMINI_PROVIDER_METADATA.provider;
    model: typeof GEMINI_PROVIDER_METADATA.model;
    apiKeyEnv: typeof GEMINI_PROVIDER_METADATA.apiKeyEnv;
    mode: "fixture" | "live" | "skipped-missing-key";
    status: "success" | "failed" | "skipped";
  };
  rawAiBucket: "confirmed-match" | "review-needed" | "rejected";
  finalBucket: "confirmed-match" | "review-needed" | "rejected";
  editorialSummary: string;
  hardConstraintFailures: HardConstraintFailure[];
  imageCount: number;
  maxImagesPerListing: typeof MAX_IMAGES_PER_LISTING;
};

export type HardConstraintFailure =
  | "bedrooms-below-five"
  | "bathrooms-below-two"
  | "rent-over-budget"
  | "not-whole-apartment"
  | "not-nyc-rental";

export type NormalizedAcquisitionCandidate = {
  schemaVersion: "g2a-normalized-candidate-v1";
  id: string;
  groupId: string;
  source: AcquisitionSource;
  sourceKey: string;
  sourceUrl: string;
  sourceListingId?: string;
  title: string;
  address: string;
  neighborhood?: string;
  borough?: string;
  rent?: number;
  bedrooms?: number;
  bathrooms?: number;
  availableAt?: string;
  visibleFacts: string[];
  quotedEvidence: SourceEvidenceRecord[];
  imageEvidence: Array<{ url: string; role: "primary" | "supporting"; sentToAi: boolean }>;
  extractionMetadata: CandidateExtractionMetadata;
  aiAnalysis: AcquisitionAiAnalysis;
  classification: AcquisitionClassification;
};

export type SourceClassificationRecord = {
  sourceKey: string;
  source: AcquisitionSource | "guardrail";
  inputKind:
    | "firecrawl-public-page"
    | "streeteasy-pasted-url"
    | "streeteasy-daily-search"
    | "manual-url"
    | "alert-email"
    | "saved-search-link"
    | "screenshot-reference"
    | "open-context"
    | "map-render"
    | "disallowed-attempt";
  classification: AcquisitionClassification;
  failureCode: AcquisitionFailureCode;
  handoff: "source-adapter" | "manual-intake" | "context-map" | "guardrail" | "defer";
  evidenceArtifactIds: string[];
  notes: string;
};

export type OpenContextAmenityRecord = {
  provider: "osm-overpass";
  sourceUrl: string;
  attribution: string;
  candidateId: string;
  amenities: Array<{
    name: string;
    kind: "supermarket" | "pharmacy" | "laundry";
    distanceMeters: number;
  }>;
  mode: AcquisitionMode;
};

export type MapRenderProof = {
  provider: "maplibre-openfreemap";
  renderMode: "fixture-static-spec" | "live-browser-render";
  styleUrl: "https://tiles.openfreemap.org/styles/liberty";
  candidatePins: Array<{ candidateId: string; longitude: number; latitude: number; label: string }>;
  contextOverlayInputs: string[];
  screenshotArtifactId: string;
};

export type AcquisitionProofSummary = {
  runId: string;
  mode: AcquisitionMode;
  candidateCount: number;
  classifications: Record<AcquisitionClassification, number>;
  gemini: {
    provider: typeof GEMINI_PROVIDER_METADATA.provider;
    model: typeof GEMINI_PROVIDER_METADATA.model;
    liveCallsAttempted: boolean;
    fixtureAnalyses: number;
    hardConstraintOverrides: number;
  };
  downstreamHandoff: Array<{
    sourceKey: string;
    classification: AcquisitionClassification;
    handoff: string;
  }>;
};

export type AcquisitionProof = {
  manifest: AcquisitionRunManifest;
  artifacts: AcquisitionArtifactRecord[];
  candidates: NormalizedAcquisitionCandidate[];
  sourceClassifications: SourceClassificationRecord[];
  openContext: { amenities: OpenContextAmenityRecord[] };
  mapProof: MapRenderProof;
  summary: AcquisitionProofSummary;
};

export type BuildAcquisitionProofOptions = {
  mode?: AcquisitionMode;
  now?: string;
  runId?: string;
  apiKeyAvailability?: Partial<AcquisitionRunManifest["apiKeyAvailability"]>;
};

export type WriteAcquisitionProofArtifactsResult = {
  outputRoot: string;
  summaryPath: string;
  normalizedCandidatesPath: string;
  sourceClassificationsPath: string;
  manifestPath: string;
  artifactPaths: string[];
};

const GROUP_ID = "nyc-5br-2026";
const FIXTURE_RUN_ID = "g2a-acquisition-proof-fixture";

type CandidateSeed = {
  source: AcquisitionSource;
  sourceKey: string;
  sourceUrl: string;
  sourceListingId?: string;
  title: string;
  address: string;
  neighborhood?: string;
  borough?: string;
  rent?: number;
  bedrooms?: number;
  bathrooms?: number;
  availableAt?: string;
  facts: string[];
  quote: string;
  images?: string[];
  extractor: string;
  classification: AcquisitionClassification;
  failureCode?: AcquisitionFailureCode;
  rawAiBucket?: AcquisitionAiAnalysis["rawAiBucket"];
  queryMetadata?: Record<string, unknown>;
  pageMetadata?: Record<string, unknown>;
  detailRetryMetadata?: CandidateExtractionMetadata["detailRetryMetadata"];
  skipMetadata?: CandidateExtractionMetadata["skipMetadata"];
  occupancyType?: "whole-apartment" | "room-share";
  isNycRental?: boolean;
};

type HardConstraintInput = {
  rent?: number;
  bedrooms?: number;
  bathrooms?: number;
  occupancyType?: "whole-apartment" | "room-share" | "unknown";
  isNycRental?: boolean;
  rawAiBucket: AcquisitionAiAnalysis["rawAiBucket"];
};

export function buildAcquisitionProof(
  options: BuildAcquisitionProofOptions = {},
): AcquisitionProof {
  const mode = options.mode ?? "fixture";
  const now = options.now ?? new Date().toISOString();
  const runId = options.runId ?? `${FIXTURE_RUN_ID}-${now.slice(0, 10)}`;
  const apiKeyAvailability = {
    firecrawl: mode === "live-safe" && Boolean(process.env.FIRECRAWL_API_KEY),
    gemini: mode === "live-safe" && Boolean(process.env.GEMINI_API_KEY),
    realtyapi: mode === "live-safe" && Boolean(process.env.REALTYAPI_KEY),
    overpassNetwork: mode === "live-safe",
    ...options.apiKeyAvailability,
  };
  const manifest: AcquisitionRunManifest = {
    schemaVersion: "g2a-acquisition-run-manifest-v1",
    runId,
    mode,
    startedAt: now,
    artifactRoots: ACQUISITION_ARTIFACT_CONTRACT.roots,
    apiKeyAvailability,
    sourceClassifications: [],
    rawRoot: ACQUISITION_ARTIFACT_CONTRACT.roots.raw.path,
    sanitizedRoot: ACQUISITION_ARTIFACT_CONTRACT.roots.sanitized.path,
  };
  const seeds = createCandidateSeeds();
  const candidates = seeds.map((seed, index) =>
    normalizeSeed(seed, index + 1, mode, now, apiKeyAvailability.gemini),
  );
  const openContext = createOpenContext(candidates, mode);
  const mapProof = createMapProof(candidates);
  const artifacts = createArtifacts({ manifest, candidates, openContext, mapProof, now });
  const sourceClassifications = createSourceClassifications(artifacts);
  manifest.sourceClassifications = sourceClassifications;
  const summary = createSummary({ manifest, candidates, sourceClassifications });

  return {
    manifest,
    artifacts,
    candidates,
    sourceClassifications,
    openContext,
    mapProof,
    summary,
  };
}

export function enforceDeterministicHardConstraints(input: HardConstraintInput): {
  finalBucket: AcquisitionAiAnalysis["finalBucket"];
  hardConstraintFailures: HardConstraintFailure[];
} {
  const hardConstraintFailures: HardConstraintFailure[] = [];

  if (input.rent !== undefined && input.rent > 15000) {
    hardConstraintFailures.push("rent-over-budget");
  }
  if (input.bedrooms !== undefined && input.bedrooms < 5) {
    hardConstraintFailures.push("bedrooms-below-five");
  }
  if (input.bathrooms !== undefined && input.bathrooms < 2) {
    hardConstraintFailures.push("bathrooms-below-two");
  }
  if (input.occupancyType === "room-share") {
    hardConstraintFailures.push("not-whole-apartment");
  }
  if (input.isNycRental === false) {
    hardConstraintFailures.push("not-nyc-rental");
  }

  if (hardConstraintFailures.length > 0) {
    return { finalBucket: "rejected", hardConstraintFailures };
  }

  return { finalBucket: input.rawAiBucket, hardConstraintFailures };
}

export function classifyGuardrailViolation(
  attemptedAction:
    | "broad-crawl-zillow-search-results"
    | "hidden-api-graphql-query"
    | "login-scrape-saved-homes"
    | "captcha-or-anti-bot-bypass",
): Pick<SourceClassificationRecord, "classification" | "failureCode" | "notes"> {
  const failureCodeByAction = {
    "broad-crawl-zillow-search-results": "policy-disallowed-broad-crawl",
    "hidden-api-graphql-query": "policy-disallowed-hidden-api",
    "login-scrape-saved-homes": "policy-disallowed-login-scrape",
    "captcha-or-anti-bot-bypass": "policy-disallowed-anti-bot-bypass",
  } satisfies Record<typeof attemptedAction, AcquisitionFailureCode>;

  return {
    classification: "policy_disallowed",
    failureCode: failureCodeByAction[attemptedAction],
    notes:
      "G2A permits bounded fixtures, approved providers, public/open context, and user-mediated inputs only.",
  };
}

export function writeAcquisitionProofArtifacts(
  proof: AcquisitionProof,
  options: { outputRoot?: string } = {},
): WriteAcquisitionProofArtifactsResult {
  const outputRoot = options.outputRoot ?? "tmp/proof-output/acquisition";
  const rawRoot = options.outputRoot
    ? join(outputRoot, "raw")
    : ACQUISITION_ARTIFACT_CONTRACT.roots.raw.path;
  const sanitizedRoot = options.outputRoot
    ? join(outputRoot, "sanitized")
    : ACQUISITION_ARTIFACT_CONTRACT.roots.sanitized.path;
  const artifactPaths: string[] = [];

  for (const artifact of proof.artifacts) {
    const root = artifact.rootKind === "raw-local" ? rawRoot : sanitizedRoot;
    const artifactPath = join(root, artifact.relativePath);
    writeJson(artifactPath, artifact.payload);
    artifactPaths.push(artifactPath);
  }

  const summaryPath = join(sanitizedRoot, "summary.json");
  const normalizedCandidatesPath = join(sanitizedRoot, "normalized-candidates.json");
  const sourceClassificationsPath = join(sanitizedRoot, "source-classifications.json");
  const manifestPath = join(sanitizedRoot, "run-manifest.json");
  const contractPath = join(sanitizedRoot, "artifact-contract.json");

  writeJson(summaryPath, proof.summary);
  writeJson(normalizedCandidatesPath, proof.candidates);
  writeJson(sourceClassificationsPath, proof.sourceClassifications);
  writeJson(manifestPath, proof.manifest);
  writeJson(contractPath, ACQUISITION_ARTIFACT_CONTRACT);
  artifactPaths.push(
    summaryPath,
    normalizedCandidatesPath,
    sourceClassificationsPath,
    manifestPath,
    contractPath,
  );

  return {
    outputRoot,
    summaryPath,
    normalizedCandidatesPath,
    sourceClassificationsPath,
    manifestPath,
    artifactPaths,
  };
}

function createCandidateSeeds(): CandidateSeed[] {
  const streetEasyImages = Array.from(
    { length: 8 },
    (_, index) => `https://fixtures.test/streeteasy/acquisition/${index + 1}.jpg`,
  );

  return [
    {
      source: "nybits",
      sourceKey: "nybits-firecrawl-public-detail",
      sourceUrl: "https://www.nybits.com/apartmentlistings/fixture-3-eleven.html",
      sourceListingId: "nybits-3-eleven-fixture",
      title: "3 Eleven — public NYBits sample",
      address: "311 Eleventh Avenue",
      neighborhood: "Chelsea",
      borough: "Manhattan",
      rent: 7995,
      bedrooms: 2,
      bathrooms: 1,
      availableAt: "2026-05-31",
      facts: [
        "NYBits public detail fixture",
        "Chelsea address",
        "$7,995 rent",
        "2 bedrooms",
        "1 bath",
      ],
      quote: "2-Bedroom at 3 Eleven, 311 Eleventh Avenue, Chelsea, $7,995, 1 Bath.",
      extractor: "firecrawl-fixture-structured-extract",
      classification: "success",
      queryMetadata: { firecrawlOperation: "scrape", liveRequiresEnv: "FIRECRAWL_API_KEY" },
    },
    {
      source: "openigloo",
      sourceKey: "openigloo-firecrawl-public-detail",
      sourceUrl: "https://www.openigloo.com/listing/fixture-111-worth-17d",
      sourceListingId: "openigloo-111-worth-17d-fixture",
      title: "111 Worth Street #17D",
      address: "111 Worth Street #17D",
      neighborhood: "Tribeca",
      borough: "Manhattan",
      rent: 6464,
      bedrooms: 1,
      bathrooms: 1,
      facts: ["Openigloo public unit fixture", "verified/top-rated labels", "1 bed", "1 bath"],
      quote: "111 Worth Street #17D, Tribeca, 1 bed, 1 bath, $6,464, verified/top-rated labels.",
      extractor: "firecrawl-fixture-structured-extract",
      classification: "success",
      queryMetadata: { firecrawlOperation: "scrape", avoidPaths: ["/api", "/_nuxt"] },
    },
    {
      source: "streeteasy",
      sourceKey: "streeteasy-realtyapi-pasted-url",
      sourceUrl: "https://streeteasy.com/building/152-manhattan-avenue-brooklyn/4b",
      sourceListingId: "5062766",
      title: "152 Manhattan Avenue #4B",
      address: "152 Manhattan Avenue #4B",
      neighborhood: "Williamsburg",
      borough: "Brooklyn",
      rent: 10150,
      bedrooms: 6,
      bathrooms: 2,
      availableAt: "2026-08-01",
      facts: ["exact urlPath match", "6 beds", "2 baths", "August 1 availability"],
      quote:
        "RealtyAPI fixture matched /building/152-manhattan-avenue-brooklyn/4b and returned 6 beds, 2 baths, $10,150.",
      images: streetEasyImages,
      extractor: "realtyapi-fixture-url-resolution",
      classification: "success",
      queryMetadata: {
        locationCandidates: ["Williamsburg", "Brooklyn", "NYC and NJ"],
        pagesScanned: [1, 2],
      },
      detailRetryMetadata: [
        { endpoint: "rental_detailsbyid", attempt: 1, status: "empty-success" },
        { endpoint: "rental_detailsbyid", attempt: 2, status: "success" },
      ],
    },
    {
      source: "streeteasy",
      sourceKey: "streeteasy-realtyapi-pasted-url",
      sourceUrl: "https://streeteasy.com/building/42-west-21-street-new_york/5",
      sourceListingId: "se-pasted-flatiron-5",
      title: "42 West 21st Street #5",
      address: "42 West 21st Street #5",
      neighborhood: "Flatiron",
      borough: "Manhattan",
      rent: 14500,
      bedrooms: 5,
      bathrooms: 2.5,
      availableAt: "2026-08-01",
      facts: ["second pasted StreetEasy fixture", "Flatiron", "5 beds", "2.5 baths"],
      quote:
        "RealtyAPI pasted-url fixture for 42 West 21st Street returned 5 beds, 2.5 baths, $14,500.",
      images: streetEasyImages,
      extractor: "realtyapi-fixture-url-resolution",
      classification: "success",
      queryMetadata: { locationCandidates: ["Flatiron", "Manhattan"], pagesScanned: [1] },
      detailRetryMetadata: [{ endpoint: "rental_detailsbyid", attempt: 1, status: "success" }],
    },
    {
      source: "streeteasy",
      sourceKey: "streeteasy-realtyapi-daily-search",
      sourceUrl: "https://streeteasy.com/building/daily-chelsea-five-bed/1",
      sourceListingId: "se-daily-chelsea",
      title: "Daily Chelsea five bed",
      address: "30 West 21st Street",
      neighborhood: "Chelsea",
      borough: "Manhattan",
      rent: 14950,
      bedrooms: 5,
      bathrooms: 2,
      availableAt: "2026-08-01",
      facts: ["daily search query shape 1", "Chelsea", "5 beds", "under $15,000"],
      quote: "search/rent Chelsea minBeds=5 maxRent=15000 found active 5BR under budget.",
      images: streetEasyImages,
      extractor: "realtyapi-fixture-daily-search",
      classification: "success",
      queryMetadata: {
        endpoint: "search/rent",
        areas: ["Chelsea"],
        minBeds: 5,
        maxRent: 15000,
        page: 1,
      },
      detailRetryMetadata: [{ endpoint: "rental_detailsbyid", attempt: 1, status: "success" }],
      skipMetadata: [
        { listingId: "se-seen-fixture", reason: "seen" },
        { listingId: "se-triaged-fixture", reason: "triaged" },
      ],
    },
    {
      source: "streeteasy",
      sourceKey: "streeteasy-realtyapi-daily-search",
      sourceUrl: "https://streeteasy.com/building/daily-east-village-five-bed/2",
      sourceListingId: "se-daily-east-village",
      title: "Daily East Village five bed",
      address: "50 East 7th Street",
      neighborhood: "East Village",
      borough: "Manhattan",
      rent: 13800,
      bedrooms: 5,
      bathrooms: 2,
      facts: ["daily search query shape 2", "East Village", "5 beds", "2 baths"],
      quote: "search/rent East Village sort=newest returned active 5BR with 2 baths.",
      images: streetEasyImages,
      extractor: "realtyapi-fixture-daily-search",
      classification: "success",
      queryMetadata: {
        endpoint: "search/rent",
        areas: ["East Village", "Lower East Side"],
        minBeds: 5,
        page: 2,
      },
      detailRetryMetadata: [{ endpoint: "rental_detailsbyid", attempt: 1, status: "success" }],
    },
    {
      source: "streeteasy",
      sourceKey: "streeteasy-realtyapi-daily-search",
      sourceUrl: "https://streeteasy.com/building/daily-nomad-over-budget/3",
      sourceListingId: "se-daily-over-budget",
      title: "Daily NoMad over-budget AI override fixture",
      address: "15 West 28th Street",
      neighborhood: "NoMad",
      borough: "Manhattan",
      rent: 15100,
      bedrooms: 5,
      bathrooms: 2,
      facts: ["daily search query shape 3", "NoMad", "5 beds", "$15,100 rent"],
      quote: "Gemini fixture said promising, but source rent is $15,100.",
      images: streetEasyImages,
      extractor: "realtyapi-fixture-daily-search",
      classification: "partial",
      rawAiBucket: "confirmed-match",
      queryMetadata: {
        endpoint: "search/rent",
        areas: ["NoMad", "Flatiron"],
        minBeds: 5,
        maxRent: 16000,
        page: 1,
      },
      detailRetryMetadata: [{ endpoint: "rental_detailsbyid", attempt: 1, status: "success" }],
    },
    {
      source: "zillow",
      sourceKey: "zillow-user-mediated-fallback",
      sourceUrl: "https://www.zillow.com/homedetails/100-W-14th-St-New-York-NY/fixture_zpid/",
      sourceListingId: "zillow-fixture-zpid",
      title: "Zillow manual URL sample — 100 West 14th Street",
      address: "100 West 14th Street",
      neighborhood: "Chelsea",
      borough: "Manhattan",
      rent: 15000,
      bedrooms: 5,
      bathrooms: 3,
      availableAt: "2026-08-01",
      facts: [
        "pasted Zillow URL sample",
        "forwarded alert-email snippet",
        "saved-search link captured",
        "screenshot reference captured",
      ],
      quote:
        "Sanitized Zillow alert sample: 5 bd, 3 ba, $15,000 near Chelsea; open the saved-search link manually.",
      images: ["screenshot://zillow-alert-card-redacted.png"],
      extractor: "zillow-user-mediated-fixture",
      classification: "manual_needed",
      failureCode: "provider-proof-pending",
      rawAiBucket: "review-needed",
      queryMetadata: {
        pastedUrls: 2,
        forwardedAlertEmailSamples: 1,
        savedSearchLinks: ["https://www.zillow.com/new-york-ny/rentals/?beds=5&price=0-15000"],
        screenshotReferences: ["zillow-alert-card-redacted.png"],
      },
    },
  ];
}

function normalizeSeed(
  seed: CandidateSeed,
  index: number,
  mode: AcquisitionMode,
  capturedAt: string,
  geminiKeyAvailable: boolean,
): NormalizedAcquisitionCandidate {
  const rawAiBucket = seed.rawAiBucket ?? inferRawAiBucket(seed);
  const hardConstraints = enforceDeterministicHardConstraints({
    rent: seed.rent,
    bedrooms: seed.bedrooms,
    bathrooms: seed.bathrooms,
    occupancyType: seed.occupancyType ?? "whole-apartment",
    isNycRental: seed.isNycRental ?? true,
    rawAiBucket,
  });
  const imageEvidence = (seed.images ?? [])
    .slice(0, MAX_IMAGES_PER_LISTING)
    .map((url, imageIndex) => ({
      url,
      role: imageIndex === 0 ? ("primary" as const) : ("supporting" as const),
      sentToAi: true,
    }));
  const artifactId = stableId(`${seed.sourceKey}:${seed.sourceUrl}:evidence`);
  const failureCode =
    hardConstraints.hardConstraintFailures.length > 0
      ? "gemini-output-hard-constraint-rejected"
      : (seed.failureCode ?? "none");

  return {
    schemaVersion: "g2a-normalized-candidate-v1",
    id: stableId(`${GROUP_ID}:${seed.sourceUrl}`),
    groupId: GROUP_ID,
    source: seed.source,
    sourceKey: seed.sourceKey,
    sourceUrl: seed.sourceUrl,
    sourceListingId: seed.sourceListingId,
    title: seed.title,
    address: seed.address,
    neighborhood: seed.neighborhood,
    borough: seed.borough,
    rent: seed.rent,
    bedrooms: seed.bedrooms,
    bathrooms: seed.bathrooms,
    availableAt: seed.availableAt,
    visibleFacts: seed.facts,
    quotedEvidence: [
      {
        schemaVersion: "g2a-source-evidence-v1",
        claim: `${seed.source} visible facts captured`,
        quote: seed.quote,
        sourceUrl: seed.sourceUrl,
        artifactId,
        capturedAt,
      },
    ],
    imageEvidence,
    extractionMetadata: {
      extractor: seed.extractor,
      mode,
      capturedAt,
      sourceClassification: seed.classification,
      failureCode,
      queryMetadata: seed.queryMetadata,
      pageMetadata: seed.pageMetadata ?? { fixtureRecord: index },
      detailRetryMetadata: seed.detailRetryMetadata,
      skipMetadata: seed.skipMetadata,
    },
    aiAnalysis: {
      providerMetadata: {
        ...GEMINI_PROVIDER_METADATA,
        mode: mode === "live-safe" && geminiKeyAvailable ? "live" : "fixture",
        status: "success",
      },
      rawAiBucket,
      finalBucket: hardConstraints.finalBucket,
      editorialSummary: createEditorialSummary(seed, hardConstraints.finalBucket),
      hardConstraintFailures: hardConstraints.hardConstraintFailures,
      imageCount: imageEvidence.length,
      maxImagesPerListing: MAX_IMAGES_PER_LISTING,
    },
    classification: seed.classification,
  };
}

function inferRawAiBucket(seed: CandidateSeed): AcquisitionAiAnalysis["rawAiBucket"] {
  if (seed.classification === "manual_needed" || seed.source === "zillow") {
    return "review-needed";
  }

  if (hasConfirmedFixtureFit(seed)) {
    return "confirmed-match";
  }

  return "review-needed";
}

function hasConfirmedFixtureFit(seed: CandidateSeed): boolean {
  const availableMonth = seed.availableAt?.slice(0, 7);
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

  return Boolean(
    seed.classification === "success" &&
    seed.bedrooms !== undefined &&
    seed.bedrooms >= 5 &&
    seed.bathrooms !== undefined &&
    seed.bathrooms >= 2 &&
    seed.rent !== undefined &&
    seed.rent <= 15000 &&
    availableMonth !== undefined &&
    ["2026-07", "2026-08", "2026-09"].includes(availableMonth) &&
    seed.borough?.toLowerCase() === "manhattan" &&
    preferredNeighborhoods.has(seed.neighborhood?.toLowerCase() ?? ""),
  );
}

function createEditorialSummary(
  seed: CandidateSeed,
  finalBucket: AcquisitionAiAnalysis["finalBucket"],
): string {
  if (finalBucket === "rejected") {
    return `${seed.title} is preserved as evidence but cannot be a confirmed match until deterministic hard constraints pass.`;
  }

  if (finalBucket === "confirmed-match") {
    return `${seed.title} looks like a strong group candidate based on captured visible facts and capped image evidence.`;
  }

  return `${seed.title} remains review-needed because source/provider certainty is incomplete or manual confirmation is required.`;
}

function createOpenContext(
  candidates: NormalizedAcquisitionCandidate[],
  mode: AcquisitionMode,
): { amenities: OpenContextAmenityRecord[] } {
  const candidate =
    candidates.find((item) => item.neighborhood === "Chelsea") ??
    candidates.find((item) => item.source === "streeteasy")!;

  return {
    amenities: [
      {
        provider: "osm-overpass",
        sourceUrl: "https://overpass-api.de/api/interpreter",
        attribution:
          "© OpenStreetMap contributors; fixture mirrors bounded Overpass amenity query shape.",
        candidateId: candidate.id,
        mode,
        amenities: [
          { name: "Fixture Market", kind: "supermarket", distanceMeters: 180 },
          { name: "Fixture Pharmacy", kind: "pharmacy", distanceMeters: 260 },
          { name: "Fixture Laundry", kind: "laundry", distanceMeters: 320 },
        ],
      },
    ],
  };
}

function createMapProof(candidates: NormalizedAcquisitionCandidate[]): MapRenderProof {
  return {
    provider: "maplibre-openfreemap",
    renderMode: "fixture-static-spec",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
    candidatePins: candidates.slice(0, 3).map((candidate, index) => ({
      candidateId: candidate.id,
      longitude: -73.999 + index * 0.01,
      latitude: 40.741 + index * 0.01,
      label: candidate.title,
    })),
    contextOverlayInputs: ["candidate pins", "OSM amenities", "future NTA polygon overlay"],
    screenshotArtifactId: stableId("maplibre-openfreemap-render-proof"),
  };
}

function createArtifacts({
  manifest,
  candidates,
  openContext,
  mapProof,
  now,
}: {
  manifest: AcquisitionRunManifest;
  candidates: NormalizedAcquisitionCandidate[];
  openContext: { amenities: OpenContextAmenityRecord[] };
  mapProof: MapRenderProof;
  now: string;
}): AcquisitionArtifactRecord[] {
  const rawPayloads = [
    {
      id: "raw-firecrawl-nybits",
      artifactKind: "firecrawl-output" as const,
      sourceKey: "nybits-firecrawl-public-detail",
      relativePath: "firecrawl/nybits-public-detail.json",
      payload: {
        tool: "Firecrawl fixture",
        sourceUrl: "https://www.nybits.com/apartmentlistings/fixture-3-eleven.html",
        markdownExcerpt: "2-Bedroom at 3 Eleven, Chelsea, $7,995, 1 Bath",
        metadata: { capturedAt: now, liveRequiresEnv: "FIRECRAWL_API_KEY" },
      },
    },
    {
      id: "raw-firecrawl-openigloo",
      artifactKind: "firecrawl-output" as const,
      sourceKey: "openigloo-firecrawl-public-detail",
      relativePath: "firecrawl/openigloo-public-detail.json",
      payload: {
        tool: "Firecrawl fixture",
        sourceUrl: "https://www.openigloo.com/listing/fixture-111-worth-17d",
        markdownExcerpt: "111 Worth Street #17D, Tribeca, 1 bed, 1 bath, $6,464",
        metadata: { capturedAt: now, avoidedPaths: ["/api", "/_nuxt"] },
      },
    },
    {
      id: "raw-zillow-manual-url-sample",
      artifactKind: "manual-url-sample" as const,
      sourceKey: "zillow-user-mediated-fallback",
      relativePath: "manual/zillow-manual-url-sample.json",
      payload: {
        sourceUrl: "https://www.zillow.com/homedetails/100-W-14th-St-New-York-NY/fixture_zpid/",
        capturedInputKind: "user-pasted-url",
        providerStatus: "provider-proof-pending",
        retainedFields: ["sourceUrl", "sourceListingId", "title", "rent", "bedrooms", "bathrooms"],
      },
    },
    {
      id: "raw-zillow-email-sample",
      artifactKind: "email-sample" as const,
      sourceKey: "zillow-user-mediated-fallback",
      relativePath: "manual/zillow-alert-email.redacted.json",
      payload: {
        from: "redacted-sender@example.invalid",
        to: "redacted-recipient@example.invalid",
        subject: "Zillow saved search alert fixture",
        snippets: ["5 bd, 3 ba, $15,000, Chelsea"],
        savedSearchUrl: "https://www.zillow.com/new-york-ny/rentals/?beds=5&price=0-15000",
      },
    },
    {
      id: "raw-zillow-screenshot-ref",
      artifactKind: "screenshot-reference" as const,
      sourceKey: "zillow-user-mediated-fallback",
      relativePath: "manual/zillow-screenshot-reference.json",
      payload: {
        screenshotRef: "zillow-alert-card-redacted.png",
        storageBoundary: "future R2 object pointer only; no committed image binary",
      },
    },
    {
      id: "raw-open-context-overpass",
      artifactKind: "open-context-response" as const,
      sourceKey: "osm-overpass-amenities",
      relativePath: "context/osm-overpass-amenities.json",
      payload: openContext,
    },
    {
      id: "raw-maplibre-render",
      artifactKind: "map-render-proof" as const,
      sourceKey: "maplibre-openfreemap-render",
      relativePath: "map/maplibre-openfreemap-render-proof.json",
      payload: mapProof,
    },
    {
      id: "raw-gemini-provider-fixture",
      artifactKind: "gemini-output" as const,
      sourceKey: "gemini-provider-fixture",
      relativePath: "ai/gemini-provider-fixture.json",
      payload: {
        provider: GEMINI_PROVIDER_METADATA.provider,
        model: GEMINI_PROVIDER_METADATA.model,
        analyses: candidates.map((candidate) => ({
          candidateId: candidate.id,
          rawAiBucket: candidate.aiAnalysis.rawAiBucket,
          finalBucket: candidate.aiAnalysis.finalBucket,
          hardConstraintFailures: candidate.aiAnalysis.hardConstraintFailures,
        })),
      },
    },
  ];

  const rawArtifacts = rawPayloads.map(
    (artifact): AcquisitionArtifactRecord => ({
      ...artifact,
      rootKind: "raw-local",
      sanitized:
        artifact.artifactKind === "email-sample" ||
        artifact.artifactKind === "screenshot-reference",
      futureStorage: {
        d1PointerField: "artifact_r2_key",
        r2ObjectKeyPattern: `acquisition/${manifest.runId}/${artifact.sourceKey}/${artifact.id}.json`,
      },
    }),
  );

  const sanitizedArtifacts: AcquisitionArtifactRecord[] = [
    {
      id: "sanitized-run-manifest",
      rootKind: "sanitized-committed",
      relativePath: "run-manifest.json",
      artifactKind: "run-manifest",
      sourceKey: "run",
      sanitized: true,
      payload: manifest,
      futureStorage: { d1PointerField: "agent_runs.metadata_json" },
    },
    {
      id: "sanitized-normalized-candidates",
      rootKind: "sanitized-committed",
      relativePath: "normalized-candidates.json",
      artifactKind: "normalized-candidates",
      sourceKey: "candidates",
      sanitized: true,
      payload: candidates,
      futureStorage: { d1PointerField: "candidate.metadata_json" },
    },
  ];

  return [...rawArtifacts, ...sanitizedArtifacts];
}

function createSourceClassifications(
  artifacts: AcquisitionArtifactRecord[],
): SourceClassificationRecord[] {
  const artifactIdsBySource = (sourceKey: string) =>
    artifacts.filter((artifact) => artifact.sourceKey === sourceKey).map((artifact) => artifact.id);

  return [
    {
      sourceKey: "nybits-firecrawl-public-detail",
      source: "nybits",
      inputKind: "firecrawl-public-page",
      classification: "success",
      failureCode: "none",
      handoff: "source-adapter",
      evidenceArtifactIds: artifactIdsBySource("nybits-firecrawl-public-detail"),
      notes: "Bounded Firecrawl fixture produced normalized public-page candidate/evidence JSON.",
    },
    {
      sourceKey: "openigloo-firecrawl-public-detail",
      source: "openigloo",
      inputKind: "firecrawl-public-page",
      classification: "success",
      failureCode: "none",
      handoff: "source-adapter",
      evidenceArtifactIds: artifactIdsBySource("openigloo-firecrawl-public-detail"),
      notes:
        "Public-page fixture works with caution; avoid hidden/internal paths and keep source-linked evidence minimal.",
    },
    {
      sourceKey: "streeteasy-realtyapi-pasted-url",
      source: "streeteasy",
      inputKind: "streeteasy-pasted-url",
      classification: "success",
      failureCode: "none",
      handoff: "source-adapter",
      evidenceArtifactIds: [],
      notes:
        "Multiple pasted URL samples normalize through RealtyAPI-style fixtures with urlPath match and detail retry metadata.",
    },
    {
      sourceKey: "streeteasy-realtyapi-daily-search",
      source: "streeteasy",
      inputKind: "streeteasy-daily-search",
      classification: "partial",
      failureCode: "gemini-output-hard-constraint-rejected",
      handoff: "source-adapter",
      evidenceArtifactIds: [],
      notes:
        "Three daily-search query shapes work in fixture mode; one AI-positive sample is deterministically rejected as over budget.",
    },
    {
      sourceKey: "zillow-user-mediated-fallback",
      source: "zillow",
      inputKind: "manual-url",
      classification: "manual_needed",
      failureCode: "provider-proof-pending",
      handoff: "manual-intake",
      evidenceArtifactIds: artifactIdsBySource("zillow-user-mediated-fallback"),
      notes:
        "Pasted URL, alert-email, saved-search link, and screenshot reference create first-class candidate stubs only.",
    },
    {
      sourceKey: "osm-overpass-amenities",
      source: "osm-overpass",
      inputKind: "open-context",
      classification: "success",
      failureCode: "none",
      handoff: "context-map",
      evidenceArtifactIds: artifactIdsBySource("osm-overpass-amenities"),
      notes:
        "Fixture mirrors bounded Overpass amenity query with OSM attribution; live-safe mode may query public Overpass separately.",
    },
    {
      sourceKey: "maplibre-openfreemap-render",
      source: "maplibre-openfreemap",
      inputKind: "map-render",
      classification: "success",
      failureCode: "none",
      handoff: "context-map",
      evidenceArtifactIds: artifactIdsBySource("maplibre-openfreemap-render"),
      notes:
        "Render proof captures MapLibre/OpenFreeMap style URL, pins, and overlay inputs without building UI.",
    },
    {
      sourceKey: "dynamic-zillow-browser-escalation",
      source: "zillow",
      inputKind: "screenshot-reference",
      classification: "dynamic_needs_browser",
      failureCode: "dynamic-browser-required",
      handoff: "manual-intake",
      evidenceArtifactIds: artifactIdsBySource("zillow-user-mediated-fallback"),
      notes:
        "If user screenshots need OCR/browser inspection, route to a bounded explicit browser proof rather than crawling.",
    },
    {
      sourceKey: "renthop-craigslist-repeatable-automation",
      source: "guardrail",
      inputKind: "disallowed-attempt",
      classification: "deferred",
      failureCode: "fixture-mode-network-deferred",
      handoff: "defer",
      evidenceArtifactIds: [],
      notes:
        "Repeatable automation remains deferred unless future approved proof identifies a compliant bounded path.",
    },
    {
      sourceKey: "zillow-hidden-api-guardrail",
      source: "guardrail",
      inputKind: "disallowed-attempt",
      classification: "policy_disallowed",
      failureCode: "policy-disallowed-hidden-api",
      handoff: "guardrail",
      evidenceArtifactIds: [],
      notes:
        "No hidden Zillow APIs, broad crawling, login scraping, CAPTCHA bypass, or anti-bot bypass are permitted.",
    },
  ];
}

function createSummary({
  manifest,
  candidates,
  sourceClassifications,
}: {
  manifest: AcquisitionRunManifest;
  candidates: NormalizedAcquisitionCandidate[];
  sourceClassifications: SourceClassificationRecord[];
}): AcquisitionProofSummary {
  const classifications = Object.fromEntries(
    ACQUISITION_CLASSIFICATIONS.map((classification) => [classification, 0]),
  ) as Record<AcquisitionClassification, number>;

  for (const item of sourceClassifications) {
    classifications[item.classification] += 1;
  }

  return {
    runId: manifest.runId,
    mode: manifest.mode,
    candidateCount: candidates.length,
    classifications,
    gemini: {
      provider: GEMINI_PROVIDER_METADATA.provider,
      model: GEMINI_PROVIDER_METADATA.model,
      liveCallsAttempted: manifest.mode === "live-safe" && manifest.apiKeyAvailability.gemini,
      fixtureAnalyses: candidates.length,
      hardConstraintOverrides: candidates.filter(
        (candidate) =>
          candidate.aiAnalysis.rawAiBucket === "confirmed-match" &&
          candidate.aiAnalysis.finalBucket !== "confirmed-match",
      ).length,
    },
    downstreamHandoff: sourceClassifications.map((item) => ({
      sourceKey: item.sourceKey,
      classification: item.classification,
      handoff: item.handoff,
    })),
  };
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function stableId(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hash = 0;

  for (const byte of bytes) {
    hash = (hash * 31 + byte) >>> 0;
  }

  return `g2a-${hash.toString(36)}`;
}
