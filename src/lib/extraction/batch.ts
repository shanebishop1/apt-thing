import {
  MAX_IMAGES_PER_LISTING,
  createAiProviderAttemptMetadata,
  createGroupScopedDuplicateKey,
  createStreetEasyBatchRun,
  createSavedListDisplayFields,
  type AiExtractionOutput,
  type ExtractionJob,
  type ExtractionStatus,
  type GroupScopedListingState,
  type InviteIdentity,
  type ListingCandidate,
} from "../listings";
import { AI_TRIAGE_SCHEMA_VERSION, handleGeminiTriageOutput } from "../triage";
import { mapWithBoundedConcurrency, normalizeConcurrencyLimit } from "../utils/concurrency";
import { extractStreetEasyListing } from "./fixture-extraction";
import { successfulProviderMetadata } from "./normalization";
import { createTriageCandidateFromListing } from "./triage-candidates";
import type {
  GeminiTriageAnalysisInput,
  GeminiTriageAnalysisResult,
  GeminiTriageAnalyzer,
  StreetEasyBatchExtractionRecord,
  StreetEasyBatchGeminiAnalysisResult,
  StreetEasyBatchInput,
  StreetEasyBatchResult,
} from "./contracts";

export async function runStreetEasyBatchWithGeminiAnalysis({
  identity,
  batch,
  priorStates = [],
  concurrencyLimit = 2,
  analyzer = analyzeStreetEasyBatchWithMockGemini,
}: {
  identity: InviteIdentity;
  batch: StreetEasyBatchInput;
  priorStates?: GroupScopedListingState[];
  concurrencyLimit?: number;
  analyzer?: GeminiTriageAnalyzer;
}): Promise<StreetEasyBatchGeminiAnalysisResult> {
  const normalizedConcurrencyLimit = normalizeConcurrencyLimit(concurrencyLimit);
  const run = createStreetEasyBatchRun(identity.groupId, batch.query, "manual");
  const skipped: StreetEasyBatchResult["skipped"] = [];
  const records: StreetEasyBatchExtractionRecord[] = [];

  for (const result of batch.results) {
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
    const extraction = extractStreetEasyListing({
      rawUrl: result.sourceUrl,
      identity,
      resolution: {
        kind: "streeteasy-realtyapi-url-resolution-fixture",
        sourceUrl: result.sourceUrl,
        query: batch.query,
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
        sourceResult: record.sourceResult,
        concurrencyLimit: normalizedConcurrencyLimit,
        concurrencySlot,
        runId: run.id,
      } satisfies GeminiTriageAnalysisInput;

      try {
        return await analyzer(analysisInput);
      } catch (error) {
        return providerExceptionAnalysis(analysisInput, error);
      }
    },
  );

  const analyzedRecords = records.map((record, index) =>
    applyGeminiTriageAnalysis(record, analysis.results[index]!),
  );
  const listings = analyzedRecords.map((record) => record.listing);
  const extractionJobs = analyzedRecords.map((record) => record.extractionJob);
  const rejected = listings.filter((listing) => listing.triageBucket === "rejected").length;

  return {
    run: {
      ...run,
      status: "success",
      counts: {
        candidatesFound: batch.results.length,
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

export function runStreetEasyBatchFixture({
  identity,
  fixture,
  priorStates = [],
  concurrencyLimit = 2,
}: {
  identity: InviteIdentity;
  fixture: StreetEasyBatchInput;
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

    const extraction = extractStreetEasyListing({
      rawUrl: result.sourceUrl,
      identity,
      resolution: {
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

async function analyzeStreetEasyBatchWithMockGemini(
  input: GeminiTriageAnalysisInput,
): Promise<GeminiTriageAnalysisResult> {
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
  input: GeminiTriageAnalysisInput,
  error: unknown,
): GeminiTriageAnalysisResult {
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

function applyGeminiTriageAnalysis(
  record: StreetEasyBatchExtractionRecord,
  analysis: GeminiTriageAnalysisResult,
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
