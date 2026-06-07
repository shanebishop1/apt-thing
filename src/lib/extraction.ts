import {
  MAX_IMAGES_PER_LISTING,
  calculateFitFlags,
  capImageEvidence,
  classifySource,
  createAiProviderAttemptMetadata,
  createDuplicateKey,
  createGroupScopedDuplicateKey,
  createListingFromUrl,
  createSavedListDisplayFields,
  createStreetEasyBatchRun,
  createStreetEasyUrlResolutionJob,
  getProviderRoute,
  hasMinimumRowFields,
  normalizeUrl,
  type AgentTriage,
  type AiExtractionOutput,
  type AiProviderAttemptMetadata,
  type ExtractionJob,
  type ExtractionStatus,
  type FitFlag,
  type GroupScopedListingState,
  type ImageEvidence,
  type InviteIdentity,
  type ListingCandidate,
  type ListingDraft,
  type ListingEvidence,
  type RealtyApiSearchQuery,
  type SourceType,
  type StreetEasyBatchRun,
  type StreetEasyUrlResolutionJob,
  type TriageBucket,
  type TriageStatus,
} from "./listings";
import {
  AI_TRIAGE_SCHEMA_VERSION,
  assignFitEvidenceTriage,
  handleGeminiTriageOutput,
  type TriageCandidateInput,
  type TriageEvidence,
  type TriageResult,
  type TriageSource,
} from "./triage";

export type StreetEasyDetailsFixture = ListingDraft & {
  listingId: string;
  sourceUrl: string;
  urlPath: string;
  fullBathrooms?: number;
  halfBathrooms?: number;
  noFee?: boolean;
  status?: string;
};

export type StreetEasySearchResultFixture = {
  listingId: string;
  sourceUrl: string;
  urlPath: string;
  page: number;
  location: string;
  details: StreetEasyDetailsFixture;
};

export type StreetEasyPastedExtractionFixture = {
  kind: "streeteasy-realtyapi-url-resolution-fixture";
  sourceUrl: string;
  query: RealtyApiSearchQuery;
  locationCandidates: string[];
  pagesScanned: number[];
  searchResults: StreetEasySearchResultFixture[];
};

export type ManualProviderFixture = ListingDraft & {
  kind: "zillow-manual-fixture" | "fallback-apartment-fixture";
  sourceUrl: string;
  status: ExtractionStatus;
  evidence: ListingEvidence[];
  concerns: string[];
  triageBucket?: TriageBucket;
  triageStatus?: TriageStatus;
  manualReviewRequired?: boolean;
  extractionFailureCode?: string;
};

export type SingleLinkExtractionFixture = StreetEasyPastedExtractionFixture | ManualProviderFixture;

export type StreetEasyBatchFixture = {
  kind: "streeteasy-batch-fixture";
  query: RealtyApiSearchQuery;
  results: StreetEasySearchResultFixture[];
};

export type SingleLinkExtractionResult = {
  listing: ListingCandidate;
  extractionJob: ExtractionJob;
  output: AiExtractionOutput;
  resolutionJob?: StreetEasyUrlResolutionJob;
};

export type StreetEasyBatchResult = {
  run: StreetEasyBatchRun;
  listings: ListingCandidate[];
  extractionJobs: ExtractionJob[];
  skipped: Array<{ listingId: string; reason: "seen" | "triaged" }>;
};

type StreetEasyBatchExtractionRecord = {
  sourceResult: StreetEasySearchResultFixture;
  listing: ListingCandidate;
  extractionJob: ExtractionJob;
  output: AiExtractionOutput;
};

export type GeminiFixtureAnalysisInput = {
  listing: ListingCandidate;
  extractionJob: ExtractionJob;
  output: AiExtractionOutput;
  fixtureResult: StreetEasySearchResultFixture;
  concurrencyLimit: number;
  concurrencySlot: number;
  runId: string;
};

export type GeminiFixtureAnalysisResult = {
  status: ExtractionStatus;
  triage: AgentTriage;
  providerMetadata: AiProviderAttemptMetadata;
};

export type GeminiFixtureAnalyzer = (
  input: GeminiFixtureAnalysisInput,
) => Promise<GeminiFixtureAnalysisResult> | GeminiFixtureAnalysisResult;

export type StreetEasyBatchGeminiAnalysisStatus = {
  listingId: string;
  sourceUrl: string;
  status: ExtractionStatus;
  triageStatus: TriageStatus;
  triageBucket: TriageBucket;
  providerMetadata: AiProviderAttemptMetadata;
};

export type StreetEasyBatchGeminiAnalysisSummary = {
  concurrencyLimit: number;
  maxObservedInFlight: number;
  listingStatuses: StreetEasyBatchGeminiAnalysisStatus[];
};

export type StreetEasyBatchGeminiAnalysisResult = StreetEasyBatchResult & {
  geminiAnalysis: StreetEasyBatchGeminiAnalysisSummary;
};

export function extractSingleLinkFixture({
  rawUrl,
  identity,
  fixture,
  concurrencyLimit = 2,
  concurrencySlot = 1,
}: {
  rawUrl: string;
  identity: InviteIdentity;
  fixture: SingleLinkExtractionFixture;
  concurrencyLimit?: number;
  concurrencySlot?: number;
}): SingleLinkExtractionResult {
  if (fixture.kind === "streeteasy-realtyapi-url-resolution-fixture") {
    return extractStreetEasyFixture({
      rawUrl,
      identity,
      fixture,
      concurrencyLimit,
      concurrencySlot,
    });
  }

  return extractManualProviderFixture({
    rawUrl,
    identity,
    fixture,
    concurrencyLimit,
    concurrencySlot,
  });
}

export async function runStreetEasyBatchFixtureWithGeminiAnalysis({
  identity,
  fixture,
  priorStates = [],
  concurrencyLimit = 2,
  analyzer = analyzeStreetEasyFixtureWithMockGemini,
}: {
  identity: InviteIdentity;
  fixture: StreetEasyBatchFixture;
  priorStates?: GroupScopedListingState[];
  concurrencyLimit?: number;
  analyzer?: GeminiFixtureAnalyzer;
}): Promise<StreetEasyBatchGeminiAnalysisResult> {
  const normalizedConcurrencyLimit = normalizeConcurrencyLimit(concurrencyLimit);
  const run = createStreetEasyBatchRun(identity.groupId, fixture.query, "manual");
  const skipped: StreetEasyBatchResult["skipped"] = [];
  const records: StreetEasyBatchExtractionRecord[] = [];

  for (const result of fixture.results) {
    const state = priorStates.find(
      (candidateState) =>
        candidateState.groupScopedDuplicateKey ===
        createGroupScopedDuplicateKey(identity.groupId, result.sourceUrl),
    );

    if (state?.triaged) {
      skipped.push({ listingId: result.listingId, reason: "triaged" });
      continue;
    }

    if (state?.seen) {
      skipped.push({ listingId: result.listingId, reason: "seen" });
      continue;
    }

    const concurrencySlot = (records.length % normalizedConcurrencyLimit) + 1;
    const extraction = extractStreetEasyFixture({
      rawUrl: result.sourceUrl,
      identity,
      fixture: {
        kind: "streeteasy-realtyapi-url-resolution-fixture",
        sourceUrl: result.sourceUrl,
        query: fixture.query,
        locationCandidates: [result.location],
        pagesScanned: [result.page],
        searchResults: [result],
      },
      concurrencyLimit: normalizedConcurrencyLimit,
      concurrencySlot,
      intakeKind: "batch-search",
      runId: run.id,
    });

    records.push({
      sourceResult: result,
      listing: extraction.listing,
      extractionJob: extraction.extractionJob,
      output: extraction.output,
    });
  }

  const analysis = await mapWithBoundedConcurrency(
    records,
    normalizedConcurrencyLimit,
    async (record, index) => {
      const concurrencySlot = (index % normalizedConcurrencyLimit) + 1;
      const analysisInput = {
        listing: record.listing,
        extractionJob: record.extractionJob,
        output: record.output,
        fixtureResult: record.sourceResult,
        concurrencyLimit: normalizedConcurrencyLimit,
        concurrencySlot,
        runId: run.id,
      } satisfies GeminiFixtureAnalysisInput;

      try {
        return await analyzer(analysisInput);
      } catch (error) {
        return providerExceptionAnalysis(analysisInput, error);
      }
    },
  );

  const analyzedRecords = records.map((record, index) =>
    applyGeminiFixtureAnalysis(record, analysis.results[index]!),
  );
  const listings = analyzedRecords.map((record) => record.listing);
  const extractionJobs = analyzedRecords.map((record) => record.extractionJob);
  const rejected = listings.filter((listing) => listing.triageBucket === "rejected").length;

  return {
    run: {
      ...run,
      status: "success",
      counts: {
        candidatesFound: fixture.results.length,
        candidatesSkippedSeen: skipped.filter((item) => item.reason === "seen").length,
        candidatesSkippedTriaged: skipped.filter((item) => item.reason === "triaged").length,
        candidatesAnalyzed: listings.length,
        candidatesSaved: listings.length,
        candidatesRejected: rejected,
      },
      completedAt: new Date().toISOString(),
    },
    listings,
    extractionJobs,
    skipped,
    geminiAnalysis: {
      concurrencyLimit: normalizedConcurrencyLimit,
      maxObservedInFlight: analysis.maxObservedInFlight,
      listingStatuses: analyzedRecords.map(({ listing, extractionJob }) => ({
        listingId: listing.sourceListingId ?? listing.id,
        sourceUrl: listing.url,
        status: extractionJob.status,
        triageStatus: extractionJob.triageStatus,
        triageBucket: listing.triageBucket,
        providerMetadata: extractionJob.providerAttempts[0]!,
      })),
    },
  };
}

export async function analyzeStreetEasyFixtureWithMockGemini(
  input: GeminiFixtureAnalysisInput,
): Promise<GeminiFixtureAnalysisResult> {
  await Promise.resolve();

  return {
    status: input.output.status,
    triage: input.output.triage,
    providerMetadata: successfulProviderMetadata(
      input.listing.imageEvidence.length,
      input.concurrencyLimit,
      input.concurrencySlot,
    ),
  };
}

function providerExceptionAnalysis(
  input: GeminiFixtureAnalysisInput,
  error: unknown,
): GeminiFixtureAnalysisResult {
  const failureCode =
    error instanceof Error && error.message ? error.message : "gemini-provider-failed";

  return {
    status: "failed",
    triage: input.output.triage,
    providerMetadata: {
      ...createAiProviderAttemptMetadata("fit-triage", input.listing.imageEvidence.length),
      status: "failed",
      completedAt: new Date().toISOString(),
      latencyMs: 0,
      imageCount: Math.min(input.listing.imageEvidence.length, MAX_IMAGES_PER_LISTING),
      concurrencyLimit: input.concurrencyLimit,
      concurrencySlot: input.concurrencySlot,
      promptVersion: AI_TRIAGE_SCHEMA_VERSION,
      schemaValidation: "failed",
      failureCode,
    },
  };
}

export function runStreetEasyBatchFixture({
  identity,
  fixture,
  priorStates = [],
  concurrencyLimit = 2,
}: {
  identity: InviteIdentity;
  fixture: StreetEasyBatchFixture;
  priorStates?: GroupScopedListingState[];
  concurrencyLimit?: number;
}): StreetEasyBatchResult {
  const run = createStreetEasyBatchRun(identity.groupId, fixture.query, "manual");
  const skipped: StreetEasyBatchResult["skipped"] = [];
  const listings: ListingCandidate[] = [];
  const extractionJobs: ExtractionJob[] = [];

  for (const result of fixture.results) {
    const state = priorStates.find(
      (candidateState) =>
        candidateState.groupScopedDuplicateKey ===
        createGroupScopedDuplicateKey(identity.groupId, result.sourceUrl),
    );

    if (state?.triaged) {
      skipped.push({ listingId: result.listingId, reason: "triaged" });
      continue;
    }

    if (state?.seen) {
      skipped.push({ listingId: result.listingId, reason: "seen" });
      continue;
    }

    const extraction = extractStreetEasyFixture({
      rawUrl: result.sourceUrl,
      identity,
      fixture: {
        kind: "streeteasy-realtyapi-url-resolution-fixture",
        sourceUrl: result.sourceUrl,
        query: fixture.query,
        locationCandidates: [result.location],
        pagesScanned: [result.page],
        searchResults: [result],
      },
      concurrencyLimit,
      concurrencySlot: (listings.length % concurrencyLimit) + 1,
      intakeKind: "batch-search",
      runId: run.id,
    });
    listings.push(extraction.listing);
    extractionJobs.push(extraction.extractionJob);
  }

  const rejected = listings.filter((listing) => listing.triageBucket === "rejected").length;

  return {
    run: {
      ...run,
      status: "success",
      counts: {
        candidatesFound: fixture.results.length,
        candidatesSkippedSeen: skipped.filter((item) => item.reason === "seen").length,
        candidatesSkippedTriaged: skipped.filter((item) => item.reason === "triaged").length,
        candidatesAnalyzed: listings.length,
        candidatesSaved: listings.length,
        candidatesRejected: rejected,
      },
      completedAt: new Date().toISOString(),
    },
    listings,
    extractionJobs,
    skipped,
  };
}

function extractStreetEasyFixture({
  rawUrl,
  identity,
  fixture,
  concurrencyLimit,
  concurrencySlot,
  intakeKind = "pasted-url",
  runId,
}: {
  rawUrl: string;
  identity: InviteIdentity;
  fixture: StreetEasyPastedExtractionFixture;
  concurrencyLimit: number;
  concurrencySlot: number;
  intakeKind?: "pasted-url" | "batch-search";
  runId?: string;
}): SingleLinkExtractionResult {
  const normalizedUrl = normalizeUrl(rawUrl);
  const parsedUrlPath = new URL(normalizedUrl).pathname.toLowerCase();
  const match = fixture.searchResults.find(
    (result) => result.urlPath.toLowerCase() === parsedUrlPath,
  );

  if (!match) {
    const fallback: ManualProviderFixture = {
      kind: "fallback-apartment-fixture",
      sourceUrl: normalizedUrl,
      status: "manual-needed",
      title: "StreetEasy manual review needed",
      address: "Unknown address",
      evidence: [sourceEvidence("StreetEasy source link captured", normalizedUrl)],
      concerns: ["RealtyAPI fixture did not contain an exact urlPath match."],
      manualReviewRequired: true,
      extractionFailureCode: "streeteasy-urlpath-miss",
    };
    return extractManualProviderFixture({
      rawUrl,
      identity,
      fixture: fallback,
      concurrencyLimit,
      concurrencySlot,
    });
  }

  const details = match.details;
  const bathrooms =
    details.bathrooms ?? (details.fullBathrooms ?? 0) + (details.halfBathrooms ?? 0) * 0.5;
  const draft: ListingDraft = {
    sourceListingId: details.listingId,
    title: details.title,
    address: details.address,
    neighborhood: details.neighborhood,
    borough: details.borough,
    rent: details.rent,
    bedrooms: details.bedrooms,
    bathrooms,
    availableAt: details.availableAt,
    description: details.description,
    amenities: details.amenities,
    photos: details.photos,
  };
  const evidence = [
    sourceEvidence("RealtyAPI search/rent exact urlPath match", match.sourceUrl),
    sourceEvidence("RealtyAPI detail payload", match.sourceUrl),
  ];
  const normalized = buildNormalizedListing({
    identity,
    sourceUrl: normalizedUrl,
    draft,
    evidence,
    concerns: buildConcerns(draft, false),
    manualReviewRequired: false,
  });
  const triage = buildTriage({
    normalized,
    intakeKind,
    runId: runId ?? "manual-single-link",
  });
  const providerMetadata = successfulProviderMetadata(
    normalized.imageEvidence.length,
    concurrencyLimit,
    concurrencySlot,
  );
  const output = buildOutput(normalized, triage, providerMetadata);
  const listing = buildListingFromOutput({ rawUrl: normalizedUrl, identity, output, intakeKind });
  const resolutionJob = createStreetEasyUrlResolutionJob(
    identity.groupId,
    normalizedUrl,
    fixture.query,
  );

  return {
    listing,
    extractionJob: buildExtractionJob({
      identity,
      listing,
      output,
      intakeKind,
      runId,
      providerMetadata,
    }),
    output,
    resolutionJob: {
      ...resolutionJob,
      status: "success",
      provenance: {
        ...resolutionJob.provenance,
        listingId: details.listingId,
        realtyApiListingId: details.listingId,
        exactUrlPathMatch: true,
        matchedUrlPath: match.urlPath,
        locationCandidates: fixture.locationCandidates,
        pagesScanned: fixture.pagesScanned,
        nycGeoSearch: {
          status: "success",
          strategy: "infer-location-candidates-from-streeteasy-url-slug",
          locationCandidates: fixture.locationCandidates,
        },
      },
      updatedAt: new Date().toISOString(),
    },
  };
}

function extractManualProviderFixture({
  rawUrl,
  identity,
  fixture,
  concurrencyLimit,
  concurrencySlot,
}: {
  rawUrl: string;
  identity: InviteIdentity;
  fixture: ManualProviderFixture;
  concurrencyLimit: number;
  concurrencySlot: number;
}): SingleLinkExtractionResult {
  const sourceUrl = normalizeUrl(rawUrl);
  const manualReviewRequired = fixture.manualReviewRequired ?? fixture.status !== "success";
  const draft: ListingDraft = {
    sourceListingId: fixture.sourceListingId,
    title: fixture.title,
    address: fixture.address,
    neighborhood: fixture.neighborhood,
    borough: fixture.borough,
    rent: fixture.rent,
    bedrooms: fixture.bedrooms,
    bathrooms: fixture.bathrooms,
    availableAt: fixture.availableAt,
    description: fixture.description,
    amenities: fixture.amenities,
    photos: fixture.photos,
  };
  const normalized = buildNormalizedListing({
    identity,
    sourceUrl,
    draft,
    evidence: fixture.evidence,
    concerns: fixture.concerns,
    manualReviewRequired,
  });
  const triage = buildTriage({
    normalized,
    intakeKind: "pasted-url",
    runId: "manual-single-link",
    overrideBucket: fixture.triageBucket,
    overrideStatus: fixture.triageStatus,
  });
  const providerMetadata = successfulProviderMetadata(
    normalized.imageEvidence.length,
    concurrencyLimit,
    concurrencySlot,
    fixture.extractionFailureCode,
  );
  const output = buildOutput(normalized, triage, providerMetadata, fixture.status);
  const listing = buildListingFromOutput({ rawUrl: sourceUrl, identity, output });

  return {
    listing,
    extractionJob: buildExtractionJob({
      identity,
      listing,
      output,
      intakeKind: "pasted-url",
      providerMetadata,
    }),
    output,
  };
}

function buildNormalizedListing({
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
}) {
  const source = classifySource(sourceUrl);
  const imageEvidence = capImageEvidence(
    (draft.photos ?? []).map(
      (url, index): ImageEvidence => ({
        url,
        role: index === 0 ? "primary" : "supporting",
        sentToAi: false,
      }),
    ),
  );
  const fitFlags = withManualFlag(
    calculateFitFlags(draft, sourceUrl),
    manualReviewRequired ||
      !hasMinimumRowFields({
        url: sourceUrl,
        title: draft.title,
        rent: draft.rent,
        bedrooms: draft.bedrooms,
      }),
  );

  return {
    groupId: identity.groupId,
    source,
    sourceUrl,
    sourceListingId: draft.sourceListingId,
    title: draft.title ?? "Manual review needed",
    address: draft.address ?? "Unknown address",
    neighborhood: draft.neighborhood,
    borough: draft.borough,
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
  };
}

function buildListingFromOutput({
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
  const base = createListingFromUrl(rawUrl, identity, {
    sourceListingId: normalized.sourceListingId,
    title: normalized.title,
    address: normalized.address,
    neighborhood: normalized.neighborhood,
    borough: normalized.borough,
    rent: normalized.rent,
    bedrooms: normalized.bedrooms,
    bathrooms: normalized.bathrooms,
    availableAt: normalized.availableAt,
    description: normalized.description,
    amenities: normalized.amenities,
    photos: normalized.photos,
  });
  const extractionStatus = output.status;
  const triageStatus = output.triage.status;
  const triageBucket = output.triage.bucket;
  const nextListing = {
    ...base,
    providerRoute: getProviderRoute(normalized.source, intakeKind),
    providerRouting: {
      ...base.providerRouting,
      intakeKind,
      providerRoute: getProviderRoute(normalized.source, intakeKind),
    },
    userQualified: intakeKind === "pasted-url",
    sourceListingId: normalized.sourceListingId,
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
  };

  return {
    ...nextListing,
    display: createSavedListDisplayFields(nextListing),
  };
}

function buildOutput(
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

function buildExtractionJob({
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

  return {
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
  };
}

function buildTriage({
  normalized,
  intakeKind,
  runId,
  overrideBucket,
  overrideStatus,
}: {
  normalized: AiExtractionOutput["normalizedListing"];
  intakeKind: "pasted-url" | "batch-search";
  runId: string;
  overrideBucket?: TriageBucket;
  overrideStatus?: TriageStatus;
}): TriageResult {
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

function createTriageCandidateFromNormalized(
  normalized: AiExtractionOutput["normalizedListing"],
  intakeKind: "pasted-url" | "batch-search",
  runId: string,
  options: { manualReviewRequired?: boolean } = {},
): TriageCandidateInput {
  const sourceUrl = normalized.sourceUrl;

  return {
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
    exceptionalFallbackEvidence:
      normalized.borough === "Brooklyn" || normalized.borough === "Queens"
        ? Boolean(
            normalized.rent &&
            normalized.rent <= 12000 &&
            normalized.bedrooms &&
            normalized.bedrooms >= 5,
          )
        : false,
  };
}

function createTriageCandidateFromListing(
  listing: ListingCandidate,
  runId: string,
): TriageCandidateInput {
  return {
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
    exceptionalFallbackEvidence:
      listing.borough === "Brooklyn" || listing.borough === "Queens"
        ? Boolean(
            listing.rent && listing.rent <= 12000 && listing.bedrooms && listing.bedrooms >= 5,
          )
        : false,
  };
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

function buildConcerns(draft: ListingDraft, manualReviewRequired: boolean): string[] {
  const concerns: string[] = [];

  if (draft.rent === undefined || draft.bedrooms === undefined || !draft.title) {
    concerns.push("Missing required saved-list row fields.");
  }
  if (draft.rent !== undefined && draft.rent > 15000) {
    concerns.push("Rent is above the $15,000 ceiling.");
  }
  if (draft.bedrooms !== undefined && draft.bedrooms < 5) {
    concerns.push("Bedroom count is below the 5BR target.");
  }
  if (draft.bathrooms !== undefined && draft.bathrooms < 2) {
    concerns.push("Bathroom count is below the 2 bath target.");
  }
  if (manualReviewRequired) {
    concerns.push("Manual review needed before treating this extraction as authoritative.");
  }

  return [...new Set(concerns)];
}

function withManualFlag(flags: FitFlag[], manualReviewRequired: boolean): FitFlag[] {
  if (!manualReviewRequired) {
    return flags;
  }

  return [...new Set([...flags, "manual_review_needed"])] as FitFlag[];
}

function successfulProviderMetadata(
  imageCount: number,
  concurrencyLimit: number,
  concurrencySlot: number,
  failureCode?: string,
): AiProviderAttemptMetadata {
  return {
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
  };
}

function sourceEvidence(claim: string, sourceUrl: string): ListingEvidence {
  return {
    claim,
    quote: sourceUrl,
    sourceUrl,
  };
}

function stableId(value: string): string {
  return `extraction-${createDuplicateKey(`https://fixture.local/${encodeURIComponent(value)}`).replace(/[^a-z0-9]+/g, "-")}`;
}

function applyGeminiFixtureAnalysis(
  record: StreetEasyBatchExtractionRecord,
  analysis: GeminiFixtureAnalysisResult,
): StreetEasyBatchExtractionRecord {
  const handled = handleGeminiTriageOutput({
    candidate: createTriageCandidateFromListing(
      record.listing,
      record.extractionJob.runId ?? "manual-single-link",
    ),
    rawOutput: analysis.triage,
    providerMetadata: analysis.providerMetadata,
  });
  const outputStatus: ExtractionStatus =
    handled.providerMetadata.status === "failed" ? "failed" : analysis.status;
  const output: AiExtractionOutput = {
    ...record.output,
    status: outputStatus,
    triage: handled.triage,
    providerMetadata: handled.providerMetadata,
  };
  const listingWithoutDisplay = {
    ...record.listing,
    extractionStatus: outputStatus,
    triageStatus: handled.triage.status,
    triageBucket: handled.triage.bucket,
    concerns: handled.triage.concerns,
    updatedAt: new Date().toISOString(),
  };
  const listing: ListingCandidate = {
    ...listingWithoutDisplay,
    display: createSavedListDisplayFields(listingWithoutDisplay),
  };
  const extractionJob: ExtractionJob = {
    ...record.extractionJob,
    status: outputStatus,
    triageStatus: handled.triage.status,
    providerAttempts: [handled.providerMetadata],
    output,
    updatedAt: new Date().toISOString(),
  };

  return {
    ...record,
    listing,
    extractionJob,
    output,
  };
}

async function mapWithBoundedConcurrency<T, R>(
  items: T[],
  concurrencyLimit: number,
  worker: (item: T, index: number) => Promise<R> | R,
): Promise<{ results: R[]; maxObservedInFlight: number }> {
  const normalizedConcurrencyLimit = normalizeConcurrencyLimit(concurrencyLimit);
  const results: R[] = [];
  results.length = items.length;
  let nextIndex = 0;
  let inFlight = 0;
  let maxObservedInFlight = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index]!;

      inFlight += 1;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);

      try {
        results[index] = await worker(item, index);
      } finally {
        inFlight -= 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(normalizedConcurrencyLimit, items.length) }, () => runWorker()),
  );

  return { results, maxObservedInFlight };
}

function normalizeConcurrencyLimit(concurrencyLimit: number): number {
  if (!Number.isFinite(concurrencyLimit) || concurrencyLimit < 1) {
    return 1;
  }

  return Math.max(1, Math.floor(concurrencyLimit));
}
