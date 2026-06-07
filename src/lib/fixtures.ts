import type { ListingCandidate } from "./listings";
import {
  createListingFromUrl,
  defaultSearchGroup,
  updateListingField,
  updateReviewStatus,
} from "./listings";

const identity = {
  groupId: defaultSearchGroup.id,
  inviteCode: defaultSearchGroup.inviteCode,
  displayName: "Shane",
};

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

export const fixtureListings: ListingCandidate[] = [
  updateReviewStatus(streeteasy, "interested"),
  updateReviewStatus(zillow, "touring"),
  updateListingField(manualNeeded, "rent", 13250, "Shane"),
];
