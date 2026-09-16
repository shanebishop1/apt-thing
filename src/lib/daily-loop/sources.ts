import type { SeenRejectedMemoryRecord, SourceCoverageSummary } from "../agent-contracts";
import {
  extractSingleLinkFixture,
  runStreetEasyBatchFixtureWithGeminiAnalysis,
  type GeminiFixtureAnalyzer,
  type StreetEasyBatchFixture,
  type StreetEasySearchResultFixture,
} from "../extraction";
import { zillowManualFixture } from "../fixtures";
import {
  createGroupScopedDuplicateKey,
  createGroupScopedListingState,
  type GroupScopedListingState,
  type InviteIdentity,
  type ListingCandidate,
} from "../listings";
import { safeJson } from "../utils/json";
import { firstRecord } from "../utils/records";
import { detectMaterialChange, findExistingState } from "./candidates";
import { stableId } from "./ids";
import {
  buildRealtyApiUrl,
  isPlausibleStreetEasySearchResult,
  mergeStreetEasyDetails,
  normalizeStreetEasySearchPayload,
  uniqueStreetEasyResults,
} from "./realtyapi";
import {
  DAILY_LOOP_RETRY_POLICY,
  type DailyLoopDetailRetryMetadata,
  type DailyLoopEnv,
  type DailyLoopMode,
  type DailyLoopSkippedCandidate,
  type DailyLoopSourceCoverage,
  type DailyLoopSourceKey,
  type ExistingCandidateState,
  type SourceRunFailure,
  type SourceRunResult,
  type SourceRunSuccess,
} from "./types";

/** The loop's sources: the StreetEasy fixture/live-safe run and the manual Zillow fixture. */

export async function runStreetEasySource({
  runId,
  identity,
  fixture,
  mode,
  env,
  now,
  concurrencyLimit,
  existingStates,
  fail,
  analyzer,
  fetchImpl,
}: {
  runId: string;
  identity: InviteIdentity;
  fixture: StreetEasyBatchFixture;
  mode: DailyLoopMode;
  env?: DailyLoopEnv;
  now: string;
  concurrencyLimit: number;
  existingStates: Map<string, ExistingCandidateState>;
  fail?: boolean;
  analyzer?: GeminiFixtureAnalyzer;
  fetchImpl?: typeof fetch;
}): Promise<SourceRunResult> {
  if (fail) {
    return failedSource(runId, "streeteasy", "streeteasy", "streeteasy-fixture-source-failed", now);
  }

  const liveMetadata = await maybeCollectStreetEasyLiveSafeMetadata({
    mode,
    env,
    fixture,
    fetchImpl,
  });
  const sourceFixture =
    liveMetadata.normalizedFixture ??
    (mode === "live-safe" ? { ...fixture, results: [] } : fixture);
  const skipped: DailyLoopSkippedCandidate[] = [];
  const statesForExtraction: GroupScopedListingState[] = [];

  for (const result of sourceFixture.results) {
    const state = existingStates.get(
      createGroupScopedDuplicateKey(identity.groupId, result.sourceUrl),
    );
    if (!state) continue;
    const material = detectMaterialChange(result, state.listing);
    if (material.changed) {
      skipped.push({
        source: "streeteasy",
        sourceUrl: result.sourceUrl,
        listingId: result.listingId,
        reason: state.reason,
        materialChangeDetected: true,
        materialChangeReasons: material.reasons,
      });
      continue;
    }
    statesForExtraction.push(
      state.state ??
        createGroupScopedListingState(identity.groupId, result.sourceUrl, {
          seen: state.reason !== "saved",
          triaged: state.reason === "triaged" || state.reason === "rejected",
          triageBucket:
            state.listing?.triageBucket ?? (state.reason === "rejected" ? "rejected" : "untriaged"),
          reviewStatus: state.reason === "rejected" ? "rejected" : state.listing?.reviewStatus,
        }),
    );
  }

  const result = await runStreetEasyBatchFixtureWithGeminiAnalysis({
    identity,
    fixture: sourceFixture,
    priorStates: statesForExtraction,
    concurrencyLimit,
    analyzer,
  });
  skipped.push(
    ...result.skipped.map((item) => ({
      source: "streeteasy" as const,
      sourceUrl:
        sourceFixture.results.find((candidate) => candidate.listingId === item.listingId)
          ?.sourceUrl ?? "https://streeteasy.com/",
      listingId: item.listingId,
      reason: item.reason,
      materialChangeDetected: false,
      materialChangeReasons: [],
    })),
  );
  const coverage: DailyLoopSourceCoverage = {
    source: "streeteasy",
    sourceKey: "streeteasy",
    status: result.run.status === "success" ? "success" : "partial",
    classification: liveMetadata.liveAttempted ? liveMetadata.classification : "success",
    checkedCount: sourceFixture.results.length,
    candidateCount: result.listings.length,
    rawArtifactPointers: [],
    queryMetadata: {
      mode,
      endpoint: "search/rent",
      query: sourceFixture.query,
      pageRange: [...new Set(sourceFixture.results.map((item) => item.page))],
      liveSafe: liveMetadata,
    },
    pageMetadata: {
      pages: [...new Set(sourceFixture.results.map((item) => item.page))],
      staleOrOffMarketHandled: true,
      noMatchHandling: "empty pages do not fail other sources",
    },
    detailRetryMetadata: sourceFixture.results.map(
      (item) =>
        liveMetadata.detailMetadataByListing[item.listingId] ?? {
          listingId: item.listingId,
          attempt: 1,
          status: "success" as const,
          fetched: true,
        },
    ),
  };

  return {
    status: "success",
    coverage,
    listings: result.listings,
    skipped,
    maxObservedInFlight: result.geminiAnalysis.maxObservedInFlight,
    providerMetadata: result.geminiAnalysis.listingStatuses.map((item) => item.providerMetadata),
  };
}

export function runSecondaryZillowFixture({
  runId,
  identity,
  now,
  concurrencyLimit,
  existingListings,
  seenMemory,
  fail,
}: {
  runId: string;
  identity: InviteIdentity;
  now: string;
  concurrencyLimit: number;
  existingListings: ListingCandidate[];
  seenMemory: SeenRejectedMemoryRecord[];
  fail?: boolean;
}): SourceRunResult {
  if (fail) {
    return failedSource(
      runId,
      "zillow-manual-fixture",
      "zillow",
      "zillow-manual-fixture-failed",
      now,
    );
  }
  const existing = findExistingState(
    identity.groupId,
    zillowManualFixture.sourceUrl,
    existingListings,
    seenMemory,
    [],
  );
  if (existing) {
    const skipped: DailyLoopSkippedCandidate = {
      source: "zillow",
      sourceUrl: zillowManualFixture.sourceUrl,
      listingId: zillowManualFixture.sourceListingId,
      reason: existing.reason,
      materialChangeDetected: false,
      materialChangeReasons: [],
    };
    return {
      status: "success",
      coverage: zillowCoverage("success", 1, 0, now),
      listings: [],
      skipped: [skipped],
      maxObservedInFlight: 0,
      providerMetadata: [],
    };
  }
  const extraction = extractSingleLinkFixture({
    rawUrl: zillowManualFixture.sourceUrl,
    identity,
    fixture: zillowManualFixture,
    concurrencyLimit,
    concurrencySlot: 1,
  });
  const listing = {
    ...extraction.listing,
    userQualified: false,
    providerRouting: {
      ...extraction.listing.providerRouting,
      intakeKind: "manual-entry" as const,
      notes:
        "Approved Zillow manual fixture/alert input; no crawling, hidden APIs, login automation, or CAPTCHA bypass.",
    },
  } satisfies ListingCandidate;
  return {
    status: "success",
    coverage: zillowCoverage("partial", 1, 1, now),
    listings: [listing],
    skipped: [],
    maxObservedInFlight: 0,
    providerMetadata: [extraction.extractionJob.providerAttempts[0]!],
  };
}

export function emptySecondaryZillowCoverage(now: string): SourceRunSuccess {
  return {
    status: "success",
    coverage: zillowCoverage("partial", 0, 0, now),
    listings: [],
    skipped: [],
    maxObservedInFlight: 0,
    providerMetadata: [],
  };
}

function failedSource(
  runId: string,
  sourceKey: DailyLoopSourceKey,
  source: "streeteasy" | "zillow",
  failureCode: string,
  now: string,
): SourceRunFailure {
  return {
    status: "failed",
    coverage: {
      source,
      sourceKey,
      status: "failed",
      classification: "failed",
      checkedCount: 1,
      candidateCount: 0,
      failureCode,
      failureMessage: "Source failed in isolation; daily loop continues with remaining sources.",
      rawArtifactPointers: [],
    },
    unit: {
      id: stableId(`${runId}:${sourceKey}:failed`),
      source: source === "streeteasy" ? "streeteasy" : "zillow",
      status: "failed",
      attempt: 1,
      maxRetries: DAILY_LOOP_RETRY_POLICY.maxRetries,
      errorCode: failureCode,
      startedAt: now,
      completedAt: now,
    },
  };
}

function zillowCoverage(
  status: SourceCoverageSummary["status"],
  checkedCount: number,
  candidateCount: number,
  now: string,
): DailyLoopSourceCoverage {
  return {
    source: "zillow",
    sourceKey: "zillow-manual-fixture",
    status,
    classification: "manual_needed",
    checkedCount,
    candidateCount,
    rawArtifactPointers: [],
    queryMetadata: {
      inputKind: "manual-url-fixture",
      sourceClassification: "manual_needed",
      capturedAt: now,
      prohibitedAutomationAvoided: [
        "broad-crawling",
        "hidden-api",
        "login-automation",
        "captcha-bypass",
      ],
    },
  };
}

async function maybeCollectStreetEasyLiveSafeMetadata({
  mode,
  env,
  fixture,
  fetchImpl = fetch,
}: {
  mode: DailyLoopMode;
  env?: DailyLoopEnv;
  fixture: StreetEasyBatchFixture;
  fetchImpl?: typeof fetch;
}): Promise<{
  liveAttempted: boolean;
  classification: DailyLoopSourceCoverage["classification"];
  missingKey: boolean;
  queryAttempts: number;
  detailMetadataByListing: Record<string, DailyLoopDetailRetryMetadata>;
  failureCode?: string;
  normalizedFixture?: StreetEasyBatchFixture;
}> {
  if (mode !== "live-safe") {
    return {
      liveAttempted: false,
      classification: "success",
      missingKey: false,
      queryAttempts: 0,
      detailMetadataByListing: {},
    };
  }
  const apiKey = env?.REALTYAPI_KEY ?? process.env.REALTYAPI_KEY;
  if (!apiKey) {
    return {
      liveAttempted: false,
      classification: "partial",
      missingKey: true,
      queryAttempts: 0,
      detailMetadataByListing: {},
      failureCode: "missing-realtyapi-key",
    };
  }
  const baseUrl = (
    env?.REALTYAPI_BASE_URL ??
    process.env.REALTYAPI_BASE_URL ??
    "https://streeteasy.realtyapi.io"
  ).replace(/\/$/, "");
  const detailMetadataByListing: Record<string, DailyLoopDetailRetryMetadata> = {};
  try {
    const liveResults: StreetEasySearchResultFixture[] = [];
    let queryAttempts = 0;
    for (const area of fixture.query.areas) {
      for (let page = 1; page <= 3; page += 1) {
        queryAttempts += 1;
        const searchResponse = await fetchImpl(
          buildRealtyApiUrl(baseUrl, "/search/rent", { ...fixture.query, areas: [area], page }),
          { headers: { "x-realtyapi-key": apiKey } },
        );
        const searchPayload = await safeJson(searchResponse);
        if (!searchResponse.ok) {
          return {
            liveAttempted: true,
            classification: "partial",
            missingKey: false,
            queryAttempts,
            detailMetadataByListing,
            failureCode: `streeteasy-live-safe-search-http-${searchResponse.status}`,
          };
        }
        liveResults.push(...normalizeStreetEasySearchPayload(searchPayload, fixture));
      }
    }
    const plausibleLiveResults = uniqueStreetEasyResults(liveResults)
      .filter((result) => isPlausibleStreetEasySearchResult(result, fixture))
      .slice(0, 24);
    const detailPayloads: Record<string, unknown> = {};
    for (const listing of plausibleLiveResults) {
      try {
        const detailResponse = await fetchImpl(
          buildRealtyApiUrl(baseUrl, "/rental_detailsbyid", { buildingid: listing.listingId }),
          { headers: { "x-realtyapi-key": apiKey } },
        );
        const detailPayload = await safeJson(detailResponse);
        const detailRecord = firstRecord(detailPayload);
        const hasDetailRecord = detailRecord && Object.keys(detailRecord).length > 0;
        if (!detailResponse.ok) {
          detailMetadataByListing[listing.listingId] = {
            listingId: listing.listingId,
            attempt: 1,
            status: "failed",
            httpStatus: detailResponse.status,
            fetched: false,
            failureCode: `streeteasy-live-safe-detail-http-${detailResponse.status}`,
          };
          continue;
        }
        if (!hasDetailRecord) {
          detailMetadataByListing[listing.listingId] = {
            listingId: listing.listingId,
            attempt: 1,
            status: "missing",
            httpStatus: detailResponse.status,
            fetched: false,
            failureCode: "streeteasy-live-safe-detail-missing-record",
          };
          continue;
        }
        detailMetadataByListing[listing.listingId] = {
          listingId: listing.listingId,
          attempt: 1,
          status: "success",
          httpStatus: detailResponse.status,
          fetched: true,
        };
        detailPayloads[listing.listingId] = detailPayload;
      } catch {
        detailMetadataByListing[listing.listingId] = {
          listingId: listing.listingId,
          attempt: 1,
          status: "failed",
          fetched: false,
          failureCode: "streeteasy-live-safe-detail-fetch-failed",
        };
      }
    }
    const normalizedFixture = mergeStreetEasyDetails(
      plausibleLiveResults,
      detailPayloads,
      fixture,
    ) ?? {
      ...fixture,
      results: [],
    };
    const hasDetailFailures = Object.values(detailMetadataByListing).some(
      (metadata) => metadata.status !== "success",
    );
    return {
      liveAttempted: true,
      classification:
        normalizedFixture.results.length > 0 && !hasDetailFailures ? "success" : "partial",
      missingKey: false,
      queryAttempts,
      detailMetadataByListing,
      failureCode:
        normalizedFixture.results.length === 0
          ? "streeteasy-live-safe-no-eligible-results"
          : hasDetailFailures
            ? "streeteasy-live-safe-detail-partial"
            : undefined,
      normalizedFixture,
    };
  } catch {
    return {
      liveAttempted: true,
      classification: "partial",
      missingKey: false,
      queryAttempts: 1,
      detailMetadataByListing,
      failureCode: "streeteasy-live-safe-fetch-failed",
    };
  }
}
