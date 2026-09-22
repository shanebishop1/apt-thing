import {
  createStreetEasyUrlResolutionJob,
  normalizeUrl,
  type InviteIdentity,
  type ListingDraft,
  type ListingEvidence,
} from "../listings";
import { withDefined } from "../utils/records";
import {
  buildConcerns,
  buildExtractionJob,
  buildListingFromOutput,
  buildNormalizedListing,
  buildOutput,
  successfulProviderMetadata,
} from "./normalization";
import { buildTriage } from "./triage-candidates";
import type {
  ManualProviderFixture,
  SingleLinkExtractionFixture,
  SingleLinkExtractionResult,
  StreetEasyUrlResolutionInput,
} from "./contracts";

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
    return extractStreetEasyListing({
      rawUrl,
      identity,
      resolution: fixture,
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

export function extractStreetEasyListing({
  rawUrl,
  identity,
  resolution,
  concurrencyLimit,
  concurrencySlot,
  intakeKind = "pasted-url",
  runId,
}: {
  rawUrl: string;
  identity: InviteIdentity;
  resolution: StreetEasyUrlResolutionInput;
  concurrencyLimit: number;
  concurrencySlot: number;
  intakeKind?: "pasted-url" | "batch-search";
  runId?: string;
}): SingleLinkExtractionResult {
  const normalizedUrl = normalizeUrl(rawUrl);
  const parsedUrlPath = new URL(normalizedUrl).pathname.toLowerCase();
  const match = resolution.searchResults.find(
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
      rawUrl: normalizedUrl,
      identity,
      fixture: fallback,
      concurrencyLimit,
      concurrencySlot,
    });
  }

  const details = match.details;
  const fallbackBathrooms =
    details.fullBathrooms === undefined && details.halfBathrooms === undefined
      ? undefined
      : (details.fullBathrooms ?? 0) + (details.halfBathrooms ?? 0) * 0.5;
  const bathrooms = details.bathrooms ?? fallbackBathrooms;
  const draft = withDefined<ListingDraft>({
    sourceListingId: details.listingId,
    title: details.title,
    address: details.address,
    neighborhood: details.neighborhood,
    borough: details.borough,
    location: details.location,
    rent: details.rent,
    bedrooms: details.bedrooms,
    bathrooms,
    availableAt: details.availableAt,
    description: details.description,
    amenities: details.amenities,
    photos: details.photos,
  });
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
    resolution.query,
  );

  return {
    listing,
    extractionJob: buildExtractionJob({
      identity,
      listing,
      output,
      intakeKind,
      ...(runId !== undefined ? { runId } : {}),
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
        locationCandidates: resolution.locationCandidates,
        pagesScanned: resolution.pagesScanned,
        nycGeoSearch: {
          status: "success",
          strategy: "infer-location-candidates-from-streeteasy-url-slug",
          locationCandidates: resolution.locationCandidates,
        },
      },
      updatedAt: new Date().toISOString(),
    },
  };
}

export function extractManualProviderFixture({
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
  const draft = withDefined<ListingDraft>({
    sourceListingId: fixture.sourceListingId,
    title: fixture.title,
    address: fixture.address,
    neighborhood: fixture.neighborhood,
    borough: fixture.borough,
    location: fixture.location,
    rent: fixture.rent,
    bedrooms: fixture.bedrooms,
    bathrooms: fixture.bathrooms,
    availableAt: fixture.availableAt,
    description: fixture.description,
    amenities: fixture.amenities,
    photos: fixture.photos,
  });
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
    ...(fixture.triageBucket !== undefined ? { overrideBucket: fixture.triageBucket } : {}),
    ...(fixture.triageStatus !== undefined ? { overrideStatus: fixture.triageStatus } : {}),
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

function sourceEvidence(claim: string, sourceUrl: string): ListingEvidence {
  return {
    claim,
    quote: sourceUrl,
    sourceUrl,
  };
}
