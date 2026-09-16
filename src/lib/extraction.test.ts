import { describe, expect, it } from "vitest";
import {
  createGroupScopedListingState,
  createGroupIdentity,
  defaultSearchGroup,
  MAX_IMAGES_PER_LISTING,
} from "./listings";
import {
  extractSingleLinkFixture,
  runStreetEasyBatchFixtureWithGeminiAnalysis,
} from "./extraction";
import {
  nonFirstClassApartmentFixture,
  streetEasyBatchFixture,
  streetEasyPastedFixture,
  zillowManualFixture,
} from "./fixtures";

const identity = createGroupIdentity(defaultSearchGroup.id, "Tester")!;

describe("fixture extraction pipeline", () => {
  it("resolves a pasted StreetEasy sample through exact urlPath metadata and saves it as user-qualified", () => {
    const result = extractSingleLinkFixture({
      rawUrl: streetEasyPastedFixture.sourceUrl,
      identity,
      fixture: streetEasyPastedFixture,
    });

    expect(result.resolutionJob).toMatchObject({
      status: "success",
      detailsEndpoint: "rental_detailsbyid",
      provenance: {
        parsedUrlPath: "/building/152-manhattan-avenue-brooklyn/4b",
        exactUrlPathMatch: true,
        matchedUrlPath: "/building/152-manhattan-avenue-brooklyn/4b",
        realtyApiListingId: "5062766",
        locationCandidates: ["Williamsburg", "Brooklyn", "NYC and NJ"],
        pagesScanned: [1, 2],
      },
    });
    expect(result.listing).toMatchObject({
      source: "streeteasy",
      providerRoute: "streeteasy-realtyapi-url-resolution",
      sourceListingId: "5062766",
      userQualified: true,
      extractionStatus: "success",
      title: "152 Manhattan Avenue #4B",
      rent: 10150,
      bedrooms: 6,
      bathrooms: 2,
      availableAt: "2026-08-01",
    });
    expect(result.listing.imageEvidence).toHaveLength(MAX_IMAGES_PER_LISTING);
    expect(result.extractionJob.providerAttempts[0]).toMatchObject({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      purpose: "fit-triage",
      status: "success",
      imageCount: MAX_IMAGES_PER_LISTING,
      concurrencyLimit: 2,
    });
    expect(result.output.normalizedListing.evidence.map((evidence) => evidence.claim)).toContain(
      "RealtyAPI detail payload",
    );
  });

  it("processes StreetEasy batch fixtures through bounded async Gemini fixture analysis", async () => {
    const seen = createGroupScopedListingState(
      defaultSearchGroup.id,
      streetEasyBatchFixture.results[0]!.sourceUrl,
      { seen: true, triaged: false },
    );
    const triaged = createGroupScopedListingState(
      defaultSearchGroup.id,
      streetEasyBatchFixture.results[1]!.sourceUrl,
      { seen: true, triaged: true, triageBucket: "rejected" },
    );
    const analyzerCalls: string[] = [];

    const result = await runStreetEasyBatchFixtureWithGeminiAnalysis({
      identity,
      fixture: streetEasyBatchFixture,
      priorStates: [seen, triaged],
      concurrencyLimit: 2,
      analyzer: async (input) => {
        analyzerCalls.push(input.listing.sourceListingId ?? input.listing.id);
        await new Promise((resolve) => setTimeout(resolve, 5));

        return {
          status: "success",
          triage: input.output.triage,
          providerMetadata: {
            ...input.output.providerMetadata,
            status: "success",
            schemaValidation: "passed",
            concurrencyLimit: input.concurrencyLimit,
            concurrencySlot: input.concurrencySlot,
            imageCount: input.listing.imageEvidence.length,
          },
        };
      },
    });

    expect(result.run).toMatchObject({
      status: "success",
      counts: {
        candidatesFound: 4,
        candidatesSkippedSeen: 1,
        candidatesSkippedTriaged: 1,
        candidatesAnalyzed: 2,
        candidatesSaved: 2,
      },
      maxImagesPerListing: MAX_IMAGES_PER_LISTING,
    });
    expect(result.skipped).toEqual([
      { listingId: "batch-seen-1", reason: "seen" },
      { listingId: "batch-triaged-1", reason: "triaged" },
    ]);
    expect(result.listings).toHaveLength(2);
    expect(analyzerCalls).toEqual(["batch-save-1", "batch-review-1"]);
    expect(result.geminiAnalysis).toMatchObject({
      concurrencyLimit: 2,
      maxObservedInFlight: 2,
    });
    expect(result.geminiAnalysis.listingStatuses).toEqual([
      expect.objectContaining({
        listingId: "batch-save-1",
        status: "success",
        triageBucket: "confirmed-match",
        providerMetadata: expect.objectContaining({
          provider: "google-direct",
          model: "gemini-3.5-flash",
          concurrencyLimit: 2,
          concurrencySlot: 1,
          imageCount: MAX_IMAGES_PER_LISTING,
        }),
      }),
      expect.objectContaining({
        listingId: "batch-review-1",
        status: "success",
        triageBucket: "review-needed",
        providerMetadata: expect.objectContaining({
          provider: "google-direct",
          model: "gemini-3.5-flash",
          concurrencyLimit: 2,
          concurrencySlot: 2,
          imageCount: MAX_IMAGES_PER_LISTING,
        }),
      }),
    ]);
    expect(result.listings[0]!.imageEvidence).toHaveLength(MAX_IMAGES_PER_LISTING);
    expect(result.listings.every((listing) => !listing.userQualified)).toBe(true);
    expect(result.listings.map((listing) => listing.triageBucket)).toEqual([
      "confirmed-match",
      "review-needed",
    ]);
    expect(result.extractionJobs[0]!.providerAttempts[0]).toMatchObject({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      purpose: "fit-triage",
      status: "success",
      imageCount: MAX_IMAGES_PER_LISTING,
      concurrencyLimit: 2,
      concurrencySlot: 1,
    });
  });

  it("rejects malformed Gemini analyzer output before persistence on the extraction path", async () => {
    const result = await runStreetEasyBatchFixtureWithGeminiAnalysis({
      identity,
      fixture: {
        ...streetEasyBatchFixture,
        results: [streetEasyBatchFixture.results[2]!],
      },
      concurrencyLimit: 1,
      analyzer: (input) => ({
        status: "success",
        triage: {
          bucket: "confirmed-match",
          status: "success",
          confidence: {
            realFiveBedroom: 1,
            twoPlusBathrooms: 1,
            priceFit: 1,
            locationFit: 1,
            overall: 1,
          },
          reasons: ["Malformed analyzer tried to confirm without schema/evidence."],
          concerns: [],
          downgradeReasons: [],
          rejectionReasons: [],
        },
        providerMetadata: {
          ...input.output.providerMetadata,
          status: "success",
          schemaValidation: "passed",
          concurrencyLimit: input.concurrencyLimit,
          concurrencySlot: input.concurrencySlot,
        },
      }),
    });

    expect(result.listings[0]).toMatchObject({
      triageBucket: "review-needed",
      triageStatus: "failed",
      extractionStatus: "failed",
    });
    expect(result.extractionJobs[0]!.providerAttempts[0]).toMatchObject({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      status: "failed",
      schemaValidation: "failed",
      failureCode: "gemini-output-schema-invalid",
    });
    expect(result.extractionJobs[0]!.output?.triage).toMatchObject({
      providerFailure: { failureCode: "gemini-output-schema-invalid" },
    });
  });

  it("normalizes Zillow manual/provider fixtures into required saved-list JSON with concerns and triage state", () => {
    const result = extractSingleLinkFixture({
      rawUrl: zillowManualFixture.sourceUrl,
      identity,
      fixture: zillowManualFixture,
    });

    expect(result.listing).toMatchObject({
      source: "zillow",
      providerRoute: "zillow-provider-or-manual-fallback",
      extractionStatus: "partial",
      title: "Zillow manual fixture — 100 West 14th Street",
      rent: 15000,
      bedrooms: 5,
      bathrooms: 3,
      userQualified: true,
    });
    expect(result.output.normalizedListing).toMatchObject({
      source: "zillow",
      sourceUrl: zillowManualFixture.sourceUrl,
      title: "Zillow manual fixture — 100 West 14th Street",
      rent: 15000,
      bedrooms: 5,
      bathrooms: 3,
    });
    expect(result.output.triage.bucket).toBe("review-needed");
    expect(result.output.normalizedListing.concerns).toContain(
      "Zillow structured provider not proven; manual/provider fixture requires review.",
    );
    expect(result.extractionJob.status).toBe("partial");
  });

  it("infers room-share and short-term rejection from extracted text before persistence", () => {
    const roomShare = extractSingleLinkFixture({
      rawUrl: "https://example-rentals.test/listings/room-share-five-bed",
      identity,
      fixture: {
        kind: "fallback-apartment-fixture",
        sourceUrl: "https://example-rentals.test/listings/room-share-five-bed",
        status: "success",
        title: "Room share five bed",
        address: "50 East 10th Street",
        neighborhood: "East Village",
        borough: "Manhattan",
        rent: 9000,
        bedrooms: 5,
        bathrooms: 2,
        availableAt: "2026-08-01",
        description: "Room share available in a 5 bedroom apartment.",
        evidence: [
          {
            claim: "Source text captured",
            quote: "Room share available in a 5 bedroom apartment.",
            sourceUrl: "https://example-rentals.test/listings/room-share-five-bed",
          },
        ],
        concerns: [],
      },
    });
    const shortTerm = extractSingleLinkFixture({
      rawUrl: "https://example-rentals.test/listings/short-term-five-bed",
      identity,
      fixture: {
        kind: "fallback-apartment-fixture",
        sourceUrl: "https://example-rentals.test/listings/short-term-five-bed",
        status: "success",
        title: "Short-term five bed",
        address: "52 East 10th Street",
        neighborhood: "East Village",
        borough: "Manhattan",
        rent: 9000,
        bedrooms: 5,
        bathrooms: 2,
        availableAt: "2026-08-01",
        description: "Short-term weekly stay for an entire apartment.",
        evidence: [
          {
            claim: "Source text captured",
            quote: "Short-term weekly stay for an entire apartment.",
            sourceUrl: "https://example-rentals.test/listings/short-term-five-bed",
          },
        ],
        concerns: [],
      },
    });

    expect(roomShare.listing.triageBucket).toBe("rejected");
    expect(roomShare.output.triage.concerns.join(" ")).toMatch(/room share/i);
    expect(shortTerm.listing.triageBucket).toBe("rejected");
    expect(shortTerm.output.triage.concerns.join(" ")).toMatch(/short-term/i);
  });

  it("creates structured fallback JSON and extraction failure state for a non-first-class apartment fixture", () => {
    const result = extractSingleLinkFixture({
      rawUrl: nonFirstClassApartmentFixture.sourceUrl,
      identity,
      fixture: nonFirstClassApartmentFixture,
    });

    expect(result.listing).toMatchObject({
      source: "other",
      sourceTarget: "fallback",
      providerRoute: "generic-source-or-manual-fallback",
      extractionStatus: "manual-needed",
      triageBucket: "review-needed",
      title: "NYBits-style fallback fixture",
      rent: 13250,
      bedrooms: 5,
      userQualified: true,
    });
    expect(result.output.normalizedListing.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ claim: "Fallback source link captured" })]),
    );
    expect(result.output.normalizedListing.fitFlags).toEqual(
      expect.arrayContaining(["manual_review_needed"]),
    );
    expect(result.extractionJob).toMatchObject({
      status: "manual-needed",
      triageStatus: "partial",
    });
  });
});
