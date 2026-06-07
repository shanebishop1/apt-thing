import {
  runStreetEasyBatchFixture,
  type ManualProviderFixture,
  type StreetEasyBatchFixture,
  type StreetEasyPastedExtractionFixture,
} from "./extraction";
import type { ListingCandidate } from "./listings";
import {
  createGroupScopedListingState,
  createInviteIdentity,
  createListingFromUrl,
  defaultSearchGroup,
  updateListingField,
  updateReviewStatus,
} from "./listings";

const identity = createInviteIdentity(defaultSearchGroup.inviteCode, "Shane")!;

const streeteasy = createListingFromUrl(
  "https://streeteasy.com/building/42-west-21-street-new_york/5",
  identity,
  {
    title: "42 West 21st Street #5",
    address: "42 West 21st Street",
    neighborhood: "Flatiron",
    borough: "Manhattan",
    rent: 14500,
    bedrooms: 5,
    bathrooms: 2.5,
    availableAt: "2026-08-01",
    description:
      "Fixture listing for the first saved-list flow. Real extraction will replace this scaffold.",
  },
);

const zillow = createListingFromUrl(
  "https://www.zillow.com/homedetails/100-W-14th-St-New-York-NY/fixture_zpid/",
  identity,
  {
    title: "100 West 14th Street",
    address: "100 West 14th Street",
    neighborhood: "Chelsea",
    borough: "Manhattan",
    rent: 15000,
    bedrooms: 5,
    bathrooms: 3,
    availableAt: "2026-08-01",
  },
);

const manualNeeded = createListingFromUrl(
  "https://example-rentals.test/listings/private-5br-lead",
  identity,
);

const streetEasyPhotoUrls = Array.from(
  { length: 7 },
  (_, index) => `https://fixtures.test/streeteasy/152-manhattan/${index + 1}.jpg`,
);

export const streetEasyPastedFixture: StreetEasyPastedExtractionFixture = {
  kind: "streeteasy-realtyapi-url-resolution-fixture",
  sourceUrl: "https://streeteasy.com/building/152-manhattan-avenue-brooklyn/4b",
  query: {
    endpoint: "search/rent",
    areas: ["williamsburg", "brooklyn"],
    minBeds: 5,
    maxRent: 15000,
    rentalStatus: "active",
    sort: "newest",
  },
  locationCandidates: ["Williamsburg", "Brooklyn", "NYC and NJ"],
  pagesScanned: [1, 2],
  searchResults: [
    {
      listingId: "5062766",
      sourceUrl: "https://streeteasy.com/building/152-manhattan-avenue-brooklyn/4b",
      urlPath: "/building/152-manhattan-avenue-brooklyn/4b",
      page: 2,
      location: "Williamsburg",
      details: {
        listingId: "5062766",
        sourceUrl: "https://streeteasy.com/building/152-manhattan-avenue-brooklyn/4b",
        urlPath: "/building/152-manhattan-avenue-brooklyn/4b",
        title: "152 Manhattan Avenue #4B",
        address: "152 Manhattan Avenue #4B",
        neighborhood: "Williamsburg",
        borough: "Brooklyn",
        rent: 10150,
        bedrooms: 6,
        fullBathrooms: 2,
        availableAt: "2026-08-01",
        description: "RealtyAPI fixture for a user-qualified pasted StreetEasy listing.",
        amenities: ["Laundry in building", "Dishwasher"],
        photos: streetEasyPhotoUrls,
        status: "active",
      },
    },
  ],
};

const batchPhotoUrls = Array.from(
  { length: 6 },
  (_, index) => `https://fixtures.test/streeteasy/batch/${index + 1}.jpg`,
);

export const streetEasyBatchFixture: StreetEasyBatchFixture = {
  kind: "streeteasy-batch-fixture",
  query: {
    endpoint: "search/rent",
    areas: ["chelsea", "flatiron"],
    minBeds: 5,
    maxRent: 15000,
    rentalStatus: "active",
    sort: "newest",
  },
  results: [
    {
      listingId: "batch-seen-1",
      sourceUrl: "https://streeteasy.com/building/batch-seen/1",
      urlPath: "/building/batch-seen/1",
      page: 1,
      location: "Chelsea",
      details: {
        listingId: "batch-seen-1",
        sourceUrl: "https://streeteasy.com/building/batch-seen/1",
        urlPath: "/building/batch-seen/1",
        title: "Already seen Chelsea five bed",
        address: "10 Seen Street",
        neighborhood: "Chelsea",
        borough: "Manhattan",
        rent: 14000,
        bedrooms: 5,
        bathrooms: 2,
        photos: batchPhotoUrls,
      },
    },
    {
      listingId: "batch-triaged-1",
      sourceUrl: "https://streeteasy.com/building/batch-triaged/2",
      urlPath: "/building/batch-triaged/2",
      page: 1,
      location: "Flatiron",
      details: {
        listingId: "batch-triaged-1",
        sourceUrl: "https://streeteasy.com/building/batch-triaged/2",
        urlPath: "/building/batch-triaged/2",
        title: "Already triaged Flatiron five bed",
        address: "20 Triaged Street",
        neighborhood: "Flatiron",
        borough: "Manhattan",
        rent: 14800,
        bedrooms: 5,
        bathrooms: 2,
        photos: batchPhotoUrls,
      },
    },
    {
      listingId: "batch-save-1",
      sourceUrl: "https://streeteasy.com/building/batch-save/3",
      urlPath: "/building/batch-save/3",
      page: 2,
      location: "Chelsea",
      details: {
        listingId: "batch-save-1",
        sourceUrl: "https://streeteasy.com/building/batch-save/3",
        urlPath: "/building/batch-save/3",
        title: "New Chelsea five bed batch candidate",
        address: "30 Batch Street",
        neighborhood: "Chelsea",
        borough: "Manhattan",
        rent: 14950,
        bedrooms: 5,
        bathrooms: 2,
        availableAt: "2026-08-01",
        photos: batchPhotoUrls,
      },
    },
    {
      listingId: "batch-review-1",
      sourceUrl: "https://streeteasy.com/building/batch-review/4",
      urlPath: "/building/batch-review/4",
      page: 2,
      location: "Williamsburg",
      details: {
        listingId: "batch-review-1",
        sourceUrl: "https://streeteasy.com/building/batch-review/4",
        urlPath: "/building/batch-review/4",
        title: "Review-needed Williamsburg batch candidate",
        address: "40 Batch Review Avenue",
        neighborhood: "Williamsburg",
        borough: "Brooklyn",
        rent: 11200,
        bedrooms: 5,
        bathrooms: 2,
        availableAt: "2026-08-01",
        photos: batchPhotoUrls,
      },
    },
  ],
};

export const zillowManualFixture: ManualProviderFixture = {
  kind: "zillow-manual-fixture",
  sourceUrl: "https://www.zillow.com/homedetails/100-W-14th-St-New-York-NY/fixture_zpid/",
  status: "partial",
  title: "Zillow manual fixture — 100 West 14th Street",
  address: "100 West 14th Street",
  neighborhood: "Chelsea",
  borough: "Manhattan",
  rent: 15000,
  bedrooms: 5,
  bathrooms: 3,
  availableAt: "2026-08-01",
  evidence: [
    {
      claim: "Zillow fixture fields captured",
      quote: "Manual fixture preserves minimum row fields while provider proof is pending.",
      sourceUrl: "https://www.zillow.com/homedetails/100-W-14th-St-New-York-NY/fixture_zpid/",
    },
  ],
  concerns: ["Zillow structured provider not proven; manual/provider fixture requires review."],
  triageBucket: "review-needed",
  triageStatus: "partial",
  manualReviewRequired: true,
};

export const nonFirstClassApartmentFixture: ManualProviderFixture = {
  kind: "fallback-apartment-fixture",
  sourceUrl: "https://nybits.example/listings/nybits-style-fallback-fixture",
  status: "manual-needed",
  title: "NYBits-style fallback fixture",
  address: "321 Fixture Avenue",
  neighborhood: "Lower East Side",
  borough: "Manhattan",
  rent: 13250,
  bedrooms: 5,
  bathrooms: 2,
  availableAt: "2026-08-01",
  evidence: [
    {
      claim: "Fallback source link captured",
      quote: "A non-first-class apartment URL can still produce a saved manual-needed row.",
      sourceUrl: "https://nybits.example/listings/nybits-style-fallback-fixture",
    },
  ],
  concerns: ["Fallback source requires manual verification before relying on extracted fields."],
  triageBucket: "review-needed",
  triageStatus: "partial",
  manualReviewRequired: true,
  extractionFailureCode: "fallback-provider-not-implemented",
};

const streetEasyBatchReviewResult = runStreetEasyBatchFixture({
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

export const fixtureBatchRun = streetEasyBatchReviewResult.run;
export const fixtureBatchSkipped = streetEasyBatchReviewResult.skipped;

export const fixtureListings: ListingCandidate[] = [
  ...streetEasyBatchReviewResult.listings,
  updateReviewStatus(streeteasy, "interested"),
  updateReviewStatus(zillow, "touring"),
  updateListingField(manualNeeded, "rent", 13250, "Shane"),
];
