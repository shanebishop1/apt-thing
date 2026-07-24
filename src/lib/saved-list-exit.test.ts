import { execFileSync } from "node:child_process";
import { buildPlatformSmokePayload } from "../../app/api/platform/smoke/route";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractSingleLinkFixture,
  runStreetEasyBatchFixtureWithGeminiAnalysis,
  type StreetEasyBatchResult,
} from "./extraction";
import {
  nonFirstClassApartmentFixture,
  streetEasyBatchFixture,
  streetEasyPastedFixture,
  zillowManualFixture,
} from "./fixtures";
import {
  INVITE_IDENTITY_STORAGE_KEY,
  MAX_IMAGES_PER_LISTING,
  PROHIBITED_SOURCE_AUTOMATION,
  createGroupScopedDuplicateKey,
  createGroupScopedListingState,
  createInviteIdentity,
  defaultSearchGroup,
  resolveSearchGroup,
} from "./listings";
import {
  createReviewDashboardModel,
  createSavedListing,
  readInviteIdentity,
  readSavedListings,
  updateSavedListingField,
  updateSavedListingStatus,
  writeInviteIdentity,
  writeSavedListings,
  type StorageLike,
} from "./saved-list-storage";
import { runMobileAcceptanceScenario } from "./mobile-acceptance";

class MemoryStorage implements StorageLike {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const identity = createInviteIdentity(defaultSearchGroup.inviteCode, "Exit Tester")!;

describe("G1 saved-list exit verification", () => {
  it("covers URL intake, extraction, batch skipping, group persistence, edits, dedupe, and guardrails", async () => {
    const storage = new MemoryStorage();
    const storedIdentity = writeInviteIdentity(storage, " apt-g1 ", " Exit Tester ");

    expect(resolveSearchGroup("apt-g1")).toEqual(defaultSearchGroup);
    expect(resolveSearchGroup("self-serve-group")).toBeUndefined();
    expect(createInviteIdentity("self-serve-group", "Exit Tester")).toBeUndefined();
    expect(storedIdentity).toMatchObject({
      kind: "valid",
      identity: {
        groupId: defaultSearchGroup.id,
        displayName: "Exit Tester",
        persistedIn: "localStorage",
        storageKey: INVITE_IDENTITY_STORAGE_KEY,
      },
    });
    expect(readInviteIdentity(storage)).toMatchObject({ kind: "valid" });

    const pastedStreetEasy = extractSingleLinkFixture({
      rawUrl: streetEasyPastedFixture.sourceUrl,
      identity,
      fixture: streetEasyPastedFixture,
    });
    const zillowFallback = extractSingleLinkFixture({
      rawUrl: zillowManualFixture.sourceUrl,
      identity,
      fixture: zillowManualFixture,
    });
    const genericFallback = extractSingleLinkFixture({
      rawUrl: nonFirstClassApartmentFixture.sourceUrl,
      identity,
      fixture: nonFirstClassApartmentFixture,
    });

    expect(pastedStreetEasy.listing).toMatchObject({
      userQualified: true,
      providerRoute: "streeteasy-realtyapi-url-resolution",
      extractionStatus: "success",
      title: "152 Manhattan Avenue #4B",
      rent: 10150,
      bedrooms: 6,
      fitFlags: expect.arrayContaining(["price_fit", "beds_fit", "bathrooms_fit"]),
    });
    expect(pastedStreetEasy.output.normalizedListing).toMatchObject({
      groupId: defaultSearchGroup.id,
      source: "streeteasy",
      sourceUrl: streetEasyPastedFixture.sourceUrl,
      sourceListingId: "5062766",
      title: "152 Manhattan Avenue #4B",
      rent: 10150,
      bedrooms: 6,
      bathrooms: 2,
      imageEvidence: expect.any(Array),
      evidence: expect.arrayContaining([
        expect.objectContaining({ claim: "RealtyAPI detail payload" }),
      ]),
      concerns: expect.any(Array),
      fitFlags: expect.any(Array),
    });
    expect(pastedStreetEasy.listing.imageEvidence).toHaveLength(MAX_IMAGES_PER_LISTING);
    expect(pastedStreetEasy.extractionJob.providerAttempts[0]).toMatchObject({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      apiKeyEnv: "GEMINI_API_KEY",
      purpose: "fit-triage",
      status: "success",
      schemaValidation: "passed",
      imageCount: MAX_IMAGES_PER_LISTING,
      maxImagesPerListing: MAX_IMAGES_PER_LISTING,
      concurrencyLimit: 2,
      concurrencySlot: 1,
    });
    expect(pastedStreetEasy.resolutionJob).toMatchObject({
      status: "success",
      provenance: {
        exactUrlPathMatch: true,
        matchedUrlPath: "/building/152-manhattan-avenue-brooklyn/4b",
        pagesScanned: [1, 2],
        nycGeoSearch: { status: "success" },
      },
    });

    expect(zillowFallback.output.normalizedListing).toMatchObject({
      source: "zillow",
      sourceUrl: zillowManualFixture.sourceUrl,
      title: "Zillow manual fixture — 100 West 14th Street",
      rent: 15000,
      bedrooms: 5,
      fitFlags: expect.arrayContaining(["manual_review_needed"]),
    });
    expect(genericFallback.output.normalizedListing).toMatchObject({
      source: "other",
      sourceUrl: nonFirstClassApartmentFixture.sourceUrl,
      title: "NYBits-style fallback fixture",
      rent: 13250,
      bedrooms: 5,
      concerns: expect.arrayContaining([
        "Fallback source requires manual verification before relying on extracted fields.",
      ]),
    });
    expect(genericFallback.extractionJob.providerAttempts[0]).toMatchObject({
      status: "failed",
      schemaValidation: "failed",
      failureCode: "fallback-provider-not-implemented",
    });

    const batch = await runStreetEasyBatchFixtureWithGeminiAnalysis({
      identity,
      fixture: streetEasyBatchFixture,
      priorStates: [
        createGroupScopedListingState(
          defaultSearchGroup.id,
          streetEasyBatchFixture.results[0]!.sourceUrl,
          {
            seen: true,
            triaged: false,
          },
        ),
        createGroupScopedListingState(
          defaultSearchGroup.id,
          streetEasyBatchFixture.results[1]!.sourceUrl,
          {
            seen: true,
            triaged: true,
            triageBucket: "rejected",
          },
        ),
      ],
      concurrencyLimit: 2,
    });

    assertBatchExitShape(batch);
    expect(batch.run.counts).toMatchObject({
      candidatesFound: 4,
      candidatesSkippedSeen: 1,
      candidatesSkippedTriaged: 1,
      candidatesAnalyzed: 2,
      candidatesSaved: 2,
    });
    expect(batch.skipped).toEqual([
      { listingId: "batch-seen-1", reason: "seen" },
      { listingId: "batch-triaged-1", reason: "triaged" },
    ]);
    expect(batch.extractionJobs.map((job) => job.providerAttempts[0]?.concurrencySlot)).toEqual([
      1, 2,
    ]);
    expect(
      batch.extractionJobs.every(
        (job) =>
          job.runId === batch.run.id &&
          job.intakeKind === "batch-search" &&
          job.providerAttempts[0]?.concurrencyLimit === 2 &&
          (job.providerAttempts[0]?.imageCount ?? 0) <= MAX_IMAGES_PER_LISTING,
      ),
    ).toBe(true);
    expect(batch.listings.every((listing) => !listing.userQualified)).toBe(true);

    const persisted = writeSavedListings(storage, defaultSearchGroup.id, [
      pastedStreetEasy.listing,
      zillowFallback.listing,
      genericFallback.listing,
      ...batch.listings,
      { ...pastedStreetEasy.listing, id: "wrong-group-copy", groupId: "wrong-group" },
    ]);
    expect(persisted.listings).toHaveLength(5);
    expect(readSavedListings(storage, defaultSearchGroup.id, [])).toHaveLength(5);
    expect(readSavedListings(storage, "wrong-group", [])).toEqual([]);

    const duplicate = createSavedListing(
      persisted.listings,
      `${streetEasyPastedFixture.sourceUrl}#photos`,
      identity,
    );
    expect(duplicate.kind).toBe("duplicate");
    expect(duplicate.listings).toHaveLength(5);
    expect(
      createGroupScopedDuplicateKey(defaultSearchGroup.id, streetEasyPastedFixture.sourceUrl),
    ).not.toBe(createGroupScopedDuplicateKey("another-group", streetEasyPastedFixture.sourceUrl));

    const [statusUpdated] = updateSavedListingStatus(
      persisted.listings,
      defaultSearchGroup.id,
      pastedStreetEasy.listing.id,
      "touring",
    );
    const [edited] = updateSavedListingField(
      statusUpdated ? [statusUpdated] : [],
      defaultSearchGroup.id,
      pastedStreetEasy.listing.id,
      "rent",
      9900,
      "Exit Tester",
    );
    expect(edited).toMatchObject({
      reviewStatus: "touring",
      rent: 9900,
      display: { reviewStatus: "touring", rent: 9900 },
      fieldProvenance: expect.arrayContaining([
        expect.objectContaining({
          field: "rent",
          source: "user-edited",
          originalValue: "10150",
          editedValue: "9900",
          actorDisplayName: "Exit Tester",
          actor: "Exit Tester",
        }),
      ]),
    });

    const dashboard = createReviewDashboardModel(persisted.listings, batch.run);
    expect(dashboard.counts).toMatchObject({
      skippedSeen: 1,
      skippedTriaged: 1,
      candidatesFound: 4,
      candidatesSaved: 2,
    });
    expect(dashboard.userQualifiedPasted.map((listing) => listing.id)).toEqual(
      expect.arrayContaining([zillowFallback.listing.id, genericFallback.listing.id]),
    );

    for (const listing of persisted.listings) {
      expect(listing.providerRouting.prohibitedAutomation).toEqual(PROHIBITED_SOURCE_AUTOMATION);
      expect(listing.providerRouting.fallback).toBe("editable-manual-needed-stub");
    }
  });

  it("locks mobile viewport acceptance selectors and Cloudflare/OpenNext preview commands", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const wrangler = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");
    const smokeRoute = readFileSync(join(process.cwd(), "app/api/platform/smoke/route.ts"), "utf8");

    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("@media (max-width: 860px)");
    expect(css).toContain("@media (max-width: 560px)");
    expect(css).toMatch(
      /\.intake-form,[\s\S]*\.listing-rowgrid \{[\s\S]*grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(/button,[\s\S]*input \{[\s\S]*min-height: 52px;/);
    expect(css).toMatch(/\.card-actions summary \{[\s\S]*min-height: 48px;/);

    expect(packageJson.scripts["cf:build"]).toBe("opennextjs-cloudflare build");
    expect(packageJson.scripts["cf:deploy:dry"]).toBe("pnpm cf:build && wrangler deploy --dry-run");
    expect(packageJson.scripts["cf:preview"]).toBe("pnpm cf:build && wrangler dev");
    expect(wrangler).toContain('"main": "src/worker.ts"');
    expect(wrangler).not.toContain('"binding": "DB"');
    expect(wrangler).not.toContain('"binding": "RAW_ARTIFACTS"');
    expect(wrangler).not.toContain('"binding": "APP_CACHE"');
    expect(wrangler).toContain('"workers_dev": false');
    expect(smokeRoute).toContain('runtime: "cloudflare-workers"');
    expect(smokeRoute).toContain("contextStatus");

    const mobileAcceptance = runMobileAcceptanceScenario();
    expect(mobileAcceptance.allChecksPassed).toBe(true);
    expect(mobileAcceptance.coveredAcceptanceMarkers).toEqual(
      expect.arrayContaining([
        "paste-input-target",
        "batch-status-panel",
        "saved-list-review",
        "map-list-detail",
        "comments-reactions-status",
        "review-status-controls",
        "edit-field-controls",
        "detail-expansion",
        "source-link-opening",
        "run-history",
        "focus-states",
        "safe-area-insets",
        "touch-targets",
        "keyboard-behavior",
        "mobile-viewport",
      ]),
    );
    expect(
      mobileAcceptance.checks.every(
        (check) => check.touchTargetPx >= mobileAcceptance.minTouchTargetPx,
      ),
    ).toBe(true);
  });

  it("returns an ok platform smoke payload when Cloudflare context is unavailable locally", () => {
    expect(buildPlatformSmokePayload()).toMatchObject({
      ok: true,
      runtime: "cloudflare-workers",
      contextStatus: "unavailable",
      appEnv: "unknown",
      bindings: {
        db: "missing",
        appCache: "missing",
        assets: "missing",
      },
      rawArtifacts: { storage: "disabled" },
    });

    expect(
      buildPlatformSmokePayload({
        APP_ENV: "local",
        DB: {},
        APP_CACHE: {},
        ASSETS: {},
      }),
    ).toMatchObject({
      ok: true,
      runtime: "cloudflare-workers",
      contextStatus: "available",
      appEnv: "local",
      bindings: {
        db: "bound",
        appCache: "bound",
        assets: "bound",
      },
      rawArtifacts: { storage: "disabled" },
    });
  });

  it("verifies the offline StreetEasy proof fixture/live-proof JSON shape without secrets", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/proof-streeteasy-realtyapi.mjs", "--fixture"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const proofPath = join(
      process.cwd(),
      "tmp/streeteasy-live-proof/realtyapi_resolved_target_details.fixture.json",
    );
    const proof = JSON.parse(readFileSync(proofPath, "utf8")) as {
      mode: string;
      input: {
        url: string;
        locationCandidates: string[];
        parsedStreetEasyPath: {
          address: string;
          borough: string;
          unit: string;
          addressQuery: string;
        };
        matchedPath: string;
      };
      searchMatch: { id: string; urlPath: string; foundInLocation: string; foundOnPage: number };
      detailsSummary: {
        listingId: string;
        status: string;
        price: number;
        availableAt: string;
        address: string;
        beds: number;
        fullBaths: number;
        photoCount: number;
      };
    };

    expect(output).toContain(
      "wrote tmp/streeteasy-live-proof/realtyapi_resolved_target_details.fixture.json",
    );
    expect(proof).toMatchObject({
      mode: "fixture",
      input: {
        url: "https://streeteasy.com/building/152-manhattan-avenue-brooklyn/4b",
        locationCandidates: ["Williamsburg", "Brooklyn", "NYC and NJ"],
        parsedStreetEasyPath: {
          address: "152 Manhattan Avenue",
          borough: "Brooklyn",
          unit: "4B",
          addressQuery: "152 Manhattan Avenue Brooklyn NY",
        },
        matchedPath: "/building/152-manhattan-avenue-brooklyn/4b",
      },
      searchMatch: {
        id: "5062766",
        urlPath: "/building/152-manhattan-avenue-brooklyn/4b",
        foundInLocation: "Williamsburg",
        foundOnPage: 2,
      },
      detailsSummary: {
        listingId: "5062766",
        status: "active",
        price: 10150,
        availableAt: "2026-08-01",
        address: "152 Manhattan Avenue #4B",
        beds: 6,
        fullBaths: 2,
        photoCount: 7,
      },
    });
  });
});

function assertBatchExitShape(batch: StreetEasyBatchResult) {
  expect(batch.run).toMatchObject({
    groupId: defaultSearchGroup.id,
    source: "streeteasy",
    providerRoute: "streeteasy-realtyapi-batch-search",
    cadence: "manual",
    status: "success",
    maxImagesPerListing: MAX_IMAGES_PER_LISTING,
    query: {
      endpoint: "search/rent",
      minBeds: 5,
      maxRent: 15000,
      rentalStatus: "active",
      sort: "newest",
    },
  });
  expect(batch.listings.every((listing) => listing.groupId === defaultSearchGroup.id)).toBe(true);
  expect(
    batch.listings.every((listing) => listing.imageEvidence.length <= MAX_IMAGES_PER_LISTING),
  ).toBe(true);
  expect(batch.listings.map((listing) => listing.triageBucket)).toEqual([
    "confirmed-match",
    "review-needed",
  ]);
}
