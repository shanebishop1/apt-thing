import { describe, expect, it } from "vitest";
import {
  BATCH_RUN_STATUSES,
  CADENCES,
  CONTRACT_PERSISTENCE_BOUNDARIES,
  EXTRACTION_STATUSES,
  GEMINI_PROVIDER_METADATA,
  INVITE_IDENTITY_STORAGE_KEY,
  MAX_IMAGES_PER_LISTING,
  REVIEW_STATUSES,
  TRIAGE_STATUSES,
  calculateFitFlags,
  capImageEvidence,
  classifySource,
  createAiProviderAttemptMetadata,
  createDuplicateKey,
  createGroupScopedDuplicateKey,
  createGroupScopedListingState,
  createInviteIdentity,
  createInviteLinkPath,
  createListingFromUrl,
  createProviderRoutingMetadata,
  createStreetEasyBatchRun,
  createStreetEasyUrlResolutionJob,
  createSubmittedUrl,
  defaultSearchGroup,
  intakePastedListingUrl,
  getProviderRoute,
  getSourceTarget,
  hasMinimumRowFields,
  resolveSearchGroup,
  resolveSearchGroupInvite,
  updateListingField,
  updateReviewStatus,
} from "./listings";

const identity = createInviteIdentity(defaultSearchGroup.inviteCode, "Tester")!;

const streetEasyQuery = {
  endpoint: "search/rent" as const,
  areas: ["chelsea", "flatiron"],
  minBeds: 5,
  maxRent: 15000,
  rentalStatus: "active" as const,
  sort: "newest" as const,
};

describe("listing contracts", () => {
  it("classifies first-class and fallback apartment sources", () => {
    expect(classifySource("https://streeteasy.com/building/example/1")).toBe("streeteasy");
    expect(classifySource("https://www.zillow.com/homedetails/example")).toBe("zillow");
    expect(classifySource("https://newyork.craigslist.org/mnh/apa/example.html")).toBe(
      "craigslist",
    );
    expect(classifySource("https://example.com/listing")).toBe("other");
    expect(getSourceTarget("streeteasy")).toBe("first-class");
    expect(getSourceTarget("zillow")).toBe("first-class");
    expect(getSourceTarget("other")).toBe("fallback");
  });

  it("routes pasted and batch sources through fixture-compatible provider contracts", () => {
    expect(getProviderRoute("streeteasy", "pasted-url")).toBe(
      "streeteasy-realtyapi-url-resolution",
    );
    expect(getProviderRoute("streeteasy", "batch-search")).toBe(
      "streeteasy-realtyapi-batch-search",
    );
    expect(getProviderRoute("zillow", "pasted-url")).toBe("zillow-provider-or-manual-fallback");
    expect(getProviderRoute("other", "pasted-url")).toBe("generic-source-or-manual-fallback");
  });

  it("captures any-apartment-URL intake as user-qualified and group-scoped", () => {
    const submitted = createSubmittedUrl(
      "https://www.zillow.com/homedetails/abc/#photos",
      identity,
    );

    expect(submitted).toMatchObject({
      groupId: defaultSearchGroup.id,
      source: "zillow",
      sourceTarget: "first-class",
      providerRoute: "zillow-provider-or-manual-fallback",
      userQualified: true,
      intakeKind: "pasted-url",
    });
    expect(submitted.normalizedUrl).toBe("https://www.zillow.com/homedetails/abc/");
    expect(submitted.groupScopedDuplicateKey).toBe(
      createGroupScopedDuplicateKey(defaultSearchGroup.id, submitted.normalizedUrl),
    );
  });

  it("normalizes duplicate keys across fragments and query order while preserving group scope", () => {
    expect(createDuplicateKey("https://www.zillow.com/homedetails/abc/?b=2&a=1#photos")).toBe(
      createDuplicateKey("https://zillow.com/homedetails/abc/?a=1&b=2"),
    );
    expect(
      createGroupScopedDuplicateKey("group-a", "https://zillow.com/homedetails/abc/"),
    ).not.toBe(createGroupScopedDuplicateKey("group-b", "https://zillow.com/homedetails/abc/"));
  });

  it("resolves only hardcoded search groups and models localStorage invite identity for G1", () => {
    expect(resolveSearchGroup(defaultSearchGroup.inviteCode)).toEqual(defaultSearchGroup);
    expect(resolveSearchGroup("unknown-group")).toBeUndefined();
    expect(identity).toMatchObject({
      groupId: defaultSearchGroup.id,
      displayName: "Tester",
      persistedIn: "localStorage",
      storageKey: INVITE_IDENTITY_STORAGE_KEY,
    });
    expect(identity.identityToken).toMatch(/^actor_nyc-5br-2026_/);
  });

  it("resolves invite code and invite link inputs without enabling self-serve groups", () => {
    const invitePath = createInviteLinkPath(defaultSearchGroup.inviteCode);

    expect(invitePath).toBe("/invite/apt-g1");
    expect(resolveSearchGroupInvite(" apt-g1 ")).toMatchObject({
      status: "valid",
      resolvedFrom: "invite-code",
      group: defaultSearchGroup,
    });
    expect(resolveSearchGroupInvite(`https://apt-thing.test${invitePath}`)).toMatchObject({
      status: "valid",
      resolvedFrom: "invite-link",
      group: defaultSearchGroup,
      inviteCode: defaultSearchGroup.inviteCode,
    });
    expect(resolveSearchGroupInvite("https://apt-thing.test/invite/self-serve-group")).toEqual({
      status: "invalid",
      resolvedFrom: "invite-link",
      inviteCode: "self-serve-group",
      feedback: "Enter a valid invite code before saving group records.",
    });
  });

  it("creates manual-needed stubs for unknown or incomplete listings", () => {
    const listing = createListingFromUrl("https://example.com/private-lead", identity);

    expect(listing.extractionStatus).toBe("manual-needed");
    expect(listing.triageBucket).toBe("review-needed");
    expect(listing.groupId).toBe(defaultSearchGroup.id);
    expect(listing.fitFlags).toContain("missing_required_fields");
    expect(listing.url).toBe("https://example.com/private-lead");
    expect(listing.display).toMatchObject({
      url: listing.url,
      title: listing.title,
      source: "other",
      reviewStatus: "new",
    });
  });

  it("rejects invalid pasted URLs with user-facing feedback", () => {
    expect(intakePastedListingUrl({ rawUrl: "", identity, existingListings: [] })).toMatchObject({
      status: "rejected",
      errorCode: "empty-url",
      feedback: "Paste a valid apartment listing URL before saving.",
    });

    expect(
      intakePastedListingUrl({ rawUrl: "not a URL", identity, existingListings: [] }),
    ).toMatchObject({
      status: "rejected",
      errorCode: "invalid-url",
      feedback: "Enter a valid apartment listing URL, including http:// or https://.",
    });

    expect(
      intakePastedListingUrl({ rawUrl: "javascript:alert(1)", identity, existingListings: [] }),
    ).toMatchObject({
      status: "rejected",
      errorCode: "unsupported-protocol",
      feedback: "Only http:// and https:// apartment listing URLs can be saved.",
    });
  });

  it("accepts supported apartment URLs and opens group-scoped duplicates instead of creating new records", () => {
    const existing = createListingFromUrl(
      "https://www.zillow.com/homedetails/abc/#photos",
      identity,
    );
    const duplicate = intakePastedListingUrl({
      rawUrl: "https://zillow.com/homedetails/abc/",
      identity,
      existingListings: [existing],
    });
    const accepted = intakePastedListingUrl({
      rawUrl: "http://example-rentals.test/listings/new-5br",
      identity,
      existingListings: [existing],
    });

    expect(duplicate).toMatchObject({
      status: "duplicate",
      existingListing: existing,
      feedback: "Duplicate listing found. Opening the existing saved record instead.",
    });
    expect(accepted).toMatchObject({
      status: "accepted",
      listing: {
        source: "other",
        extractionStatus: "manual-needed",
        providerRoute: "generic-source-or-manual-fallback",
      },
      feedback: "Saved an editable manual-needed stub for this source.",
    });
  });

  it("records first-class StreetEasy and Zillow provider-routing metadata without automation", () => {
    const streetEasy = intakePastedListingUrl({
      rawUrl: "https://streeteasy.com/building/42-west-21-street-new_york/5",
      identity,
      existingListings: [],
    });
    const zillow = intakePastedListingUrl({
      rawUrl: "https://www.zillow.com/homedetails/100-W-14th-St-New-York-NY/fixture_zpid/",
      identity,
      existingListings: [],
    });

    expect(streetEasy).toMatchObject({
      status: "accepted",
      feedback: "Saved StreetEasy URL. RealtyAPI/NYC GeoSearch resolution is pending.",
      listing: {
        source: "streeteasy",
        sourceTarget: "first-class",
        providerRoute: "streeteasy-realtyapi-url-resolution",
        providerRouting: {
          primaryProvider: "realtyapi",
          fallback: "editable-manual-needed-stub",
          prohibitedAutomation: [
            "credential-theft",
            "captcha-bypass",
            "login-automation",
            "abusive-traffic",
          ],
        },
      },
      streetEasyResolutionJob: {
        detailsEndpoint: "rental_detailsbyid",
        provenance: {
          parsedUrlPath: "/building/42-west-21-street-new_york/5",
          nycGeoSearch: {
            status: "pending",
            strategy: "infer-location-candidates-from-streeteasy-url-slug",
          },
        },
      },
    });
    expect(
      streetEasy.status === "accepted" ? streetEasy.listing.providerRouting.resolutionSteps : [],
    ).toEqual([
      "parse-streeteasy-url-path",
      "infer-location-candidates-with-nyc-geosearch",
      "scan-realtyapi-search-rent-for-exact-urlpath",
      "fetch-realtyapi-rental_detailsbyid",
    ]);

    expect(zillow).toMatchObject({
      status: "accepted",
      feedback: "Saved Zillow URL. Provider proof or manual fallback is pending.",
      listing: {
        source: "zillow",
        sourceTarget: "first-class",
        providerRoute: "zillow-provider-or-manual-fallback",
        extractionStatus: "manual-needed",
        providerRouting: {
          primaryProvider: "provider-proof-pending",
          fallback: "editable-manual-needed-stub",
          manualFallbackRequired: true,
        },
      },
    });
  });

  it("creates provider-routing metadata for unsupported sources as editable manual fallbacks", () => {
    expect(createProviderRoutingMetadata("craigslist", "pasted-url")).toMatchObject({
      source: "craigslist",
      providerRoute: "generic-source-or-manual-fallback",
      sourceTarget: "fallback",
      primaryProvider: "none",
      fallback: "editable-manual-needed-stub",
      manualFallbackRequired: true,
      prohibitedAutomation: [
        "credential-theft",
        "captcha-bypass",
        "login-automation",
        "abusive-traffic",
      ],
    });
  });

  it("requires URL, title, rent, and beds as the minimum saved-list row fields", () => {
    expect(
      hasMinimumRowFields({
        url: "https://streeteasy.com/building/example/1",
        title: "Example",
        rent: 14000,
        bedrooms: 5,
      }),
    ).toBe(true);
    expect(hasMinimumRowFields({ title: "Example", rent: 14000, bedrooms: 5 })).toBe(false);
    expect(hasMinimumRowFields({ url: "https://x.test", title: "Example", bedrooms: 5 })).toBe(
      false,
    );
    expect(hasMinimumRowFields({ url: "https://x.test", title: "Example", rent: 14000 })).toBe(
      false,
    );
  });

  it("adds light fit flags for G1 constraints", () => {
    expect(
      calculateFitFlags(
        {
          rent: 14999,
          bedrooms: 5,
          bathrooms: 2,
          neighborhood: "Flatiron",
          title: "Test",
        },
        "https://example.com/test",
      ),
    ).toEqual(["price_fit", "beds_fit", "bathrooms_fit", "location_fit"]);
  });

  it("records status updates and manual edit provenance", () => {
    const listing = createListingFromUrl("https://streeteasy.com/building/example/1", identity, {
      title: "Example",
      rent: 14000,
      bedrooms: 5,
    });
    const touring = updateReviewStatus(listing, "touring");
    const edited = updateListingField(touring, "bathrooms", 2, "Tester");

    expect(edited.reviewStatus).toBe("touring");
    expect(edited.display.reviewStatus).toBe("touring");
    expect(edited.bathrooms).toBe(2);
    expect(edited.fitFlags).toContain("bathrooms_fit");
    expect(edited.fieldProvenance.at(-1)).toMatchObject({
      field: "bathrooms",
      source: "user-confirmed",
      editedValue: "2",
      actorDisplayName: "Tester",
    });
  });

  it("defines StreetEasy RealtyAPI URL-resolution and batch run metadata", () => {
    const resolution = createStreetEasyUrlResolutionJob(
      defaultSearchGroup.id,
      "https://streeteasy.com/building/42-west-21-street-new_york/5",
      streetEasyQuery,
    );
    const run = createStreetEasyBatchRun(defaultSearchGroup.id, streetEasyQuery, "manual");

    expect(resolution).toMatchObject({
      groupId: defaultSearchGroup.id,
      status: "pending",
      detailsEndpoint: "rental_detailsbyid",
      provenance: {
        parsedUrlPath: "/building/42-west-21-street-new_york/5",
        exactUrlPathMatch: false,
        query: streetEasyQuery,
      },
    });
    expect(run).toMatchObject({
      groupId: defaultSearchGroup.id,
      source: "streeteasy",
      providerRoute: "streeteasy-realtyapi-batch-search",
      cadence: "manual",
      status: "queued",
      maxImagesPerListing: MAX_IMAGES_PER_LISTING,
      counts: {
        candidatesFound: 0,
        candidatesSkippedSeen: 0,
        candidatesSkippedTriaged: 0,
      },
    });
  });

  it("tracks statuses, cadence, and skipped seen/triaged state", () => {
    expect(CADENCES).toEqual(["manual", "daily", "hourly"]);
    expect(EXTRACTION_STATUSES).toContain("manual-needed");
    expect(TRIAGE_STATUSES).toContain("skipped-seen");
    expect(BATCH_RUN_STATUSES).toEqual([
      "queued",
      "running",
      "success",
      "partial",
      "failed",
      "cancelled",
    ]);
    expect(REVIEW_STATUSES).toEqual([
      "review",
      "new",
      "interested",
      "touring",
      "unavailable",
      "gone",
      "rejected",
    ]);

    const state = createGroupScopedListingState(
      "group-a",
      "https://streeteasy.com/building/example/1",
      {
        triaged: true,
        triageBucket: "rejected",
        reviewStatus: "rejected",
      },
    );

    expect(state).toMatchObject({
      groupId: "group-a",
      seen: true,
      triaged: true,
      triageBucket: "rejected",
      reviewStatus: "rejected",
    });
    expect(state.groupScopedDuplicateKey).not.toBe(
      createGroupScopedListingState("group-b", "https://streeteasy.com/building/example/1")
        .groupScopedDuplicateKey,
    );
  });

  it("caps image evidence per listing for Gemini analysis", () => {
    const capped = capImageEvidence(
      Array.from({ length: MAX_IMAGES_PER_LISTING + 2 }, (_, index) => ({
        url: `https://images.test/${index}.jpg`,
        role: index === 0 ? ("primary" as const) : ("supporting" as const),
        sentToAi: false,
      })),
    );

    expect(capped).toHaveLength(MAX_IMAGES_PER_LISTING);
    expect(capped[0]).toMatchObject({ role: "primary", sentToAi: true });
    expect(capped.every((image) => image.sentToAi)).toBe(true);
  });

  it("records selected Gemini 3.5 Flash provider metadata without live secrets", () => {
    const metadata = createAiProviderAttemptMetadata("fit-triage", MAX_IMAGES_PER_LISTING + 10);

    expect(GEMINI_PROVIDER_METADATA).toEqual({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      apiKeyEnv: "GEMINI_API_KEY",
    });
    expect(metadata).toMatchObject({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      apiKeyEnv: "GEMINI_API_KEY",
      purpose: "fit-triage",
      status: "pending",
      imageCount: MAX_IMAGES_PER_LISTING,
      maxImagesPerListing: MAX_IMAGES_PER_LISTING,
    });
  });

  it("documents near-term D1/KV ownership boundaries in local-compatible shapes", () => {
    expect(CONTRACT_PERSISTENCE_BOUNDARIES.savedListings).toMatchObject({
      owner: "d1",
      scope: "authoritative-relational",
      groupScoped: true,
    });
    expect(CONTRACT_PERSISTENCE_BOUNDARIES.rawEvidence).toMatchObject({
      owner: "d1",
      scope: "authoritative-relational",
      groupScoped: true,
    });
    expect(CONTRACT_PERSISTENCE_BOUNDARIES.cacheConfig).toMatchObject({
      owner: "kv",
      scope: "cache-config",
      groupScoped: false,
    });
  });
});
