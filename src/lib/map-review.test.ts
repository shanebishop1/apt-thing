import { describe, expect, it } from "vitest";
import { fixtureListings } from "./fixtures";
import type { ListingCandidate } from "./listings";
import { createMapReviewModel } from "./map-review";
import { withDefined } from "./utils/records";

describe("G3A map-enhanced review model", () => {
  it("synchronizes selected listing, pins, detail evidence, context, and source links", () => {
    const selected = fixtureListings.find((listing) => listing.title.includes("Williamsburg"));
    const model = createMapReviewModel(fixtureListings, selected?.id);

    expect(model.selected?.listing.id).toBe(selected?.id);
    expect(model.locatedCandidates.length).toBeGreaterThan(0);
    expect(model.bounds).toMatchObject({ north: expect.any(Number), south: expect.any(Number) });
    expect(model.attribution).toContain("OpenStreetMap contributors");
    expect(model.mobileModes).toEqual(["map", "list", "detail"]);
    expect("pois" in model).toBe(false);

    const williamsburg = model.candidates.find(
      (candidate) => candidate.listing.id === selected?.id,
    );

    expect(williamsburg).toMatchObject({
      pinState: "review",
      zoneKind: "exceptional-fallback",
      boroughFallback: "Brooklyn fallback",
      confidenceLabel: "Needs roommate review",
    });
    expect(williamsburg?.mapPosition).toMatchObject({
      left: expect.any(Number),
      top: expect.any(Number),
    });
    expect(williamsburg?.mapPosition?.left).toBeGreaterThan(0);
    expect(williamsburg?.mapPosition?.top).toBeGreaterThan(0);
    expect(williamsburg?.subway[0]).toMatchObject({
      station: expect.any(String),
      routes: expect.any(Array),
    });
    expect(williamsburg?.contextAmenities).toHaveLength(0);
    expect(williamsburg?.evidenceSummary).toContain(":");
    expect(williamsburg?.sourceLinks).toContain(williamsburg?.listing.url);
  });

  it("keeps missing-coordinate listings reviewable in the synchronized list/detail flow", () => {
    const unmapped = withDefined<ListingCandidate>({
      ...fixtureListings[0]!,
      id: "fixture-unmapped",
      title: "Fixture listing without map context",
      address: "Unknown fixture address",
      neighborhood: undefined,
      borough: undefined,
    });
    const model = createMapReviewModel([unmapped], unmapped.id);

    expect(model.locatedCandidates).toHaveLength(0);
    expect(model.missingLocationCandidates).toHaveLength(1);
    expect(model.selected).toMatchObject({
      pinState: "missing-location",
      zoneLabel: "Location pending",
      boroughFallback: "Borough pending",
      subway: [],
    });
  });

  it("derives subway context from listing coordinates", () => {
    const listing = withDefined<ListingCandidate>({
      ...fixtureListings[0]!,
      id: "realtyapi-union-square",
      title: "Live listing near Union Square",
      address: "1 Irving Place",
      neighborhood: "Union Square",
      borough: "Manhattan",
      location: { latitude: 40.7347, longitude: -73.9905 },
    });

    const model = createMapReviewModel([listing], listing.id);
    const subway = model.selected?.subway ?? [];

    expect(subway).toHaveLength(3);
    expect(subway[0]?.station).toBe("14 St-Union Sq");
    expect(subway[0]?.routes).toEqual(expect.arrayContaining(["4", "5", "6", "L", "N", "Q", "R"]));
    expect(subway[0]?.distanceMeters).toBeLessThan(300);
    expect(subway[0]!.distanceMeters % 10).toBe(0);
    expect(subway[0]!.distanceMeters).toBeLessThanOrEqual(subway[1]!.distanceMeters);
    expect(model.selected).toMatchObject({
      zoneLabel: "Union Square",
      zoneKind: "preferred-manhattan",
      boroughFallback: "Manhattan preferred zone",
    });
  });

  it("labels outer-borough listings from the listing borough", () => {
    const listing = withDefined<ListingCandidate>({
      ...fixtureListings[0]!,
      id: "realtyapi-bushwick",
      title: "Live listing near the Jefferson St L",
      address: "10 Wyckoff Avenue",
      neighborhood: "Bushwick",
      borough: "Brooklyn",
      location: { latitude: 40.7065, longitude: -73.9229 },
    });

    const model = createMapReviewModel([listing], listing.id);

    expect(model.selected).toMatchObject({
      zoneLabel: "Bushwick",
      zoneKind: "exceptional-fallback",
      boroughFallback: "Brooklyn fallback",
    });
    expect(model.selected?.subway[0]?.routes).toContain("L");
  });

  it("geocodes known fixture addresses even when the listing title changes", () => {
    const retitled = {
      ...fixtureListings[0]!,
      id: "fixture-retitled-known-address",
      title: "Retitled broker copy should still map",
      address: "42 W 21st St, New York, NY 10010",
    };

    const model = createMapReviewModel([retitled], retitled.id);

    expect(model.locatedCandidates).toHaveLength(1);
    expect(model.missingLocationCandidates).toHaveLength(0);
    expect(model.selected).toMatchObject({
      pinState: "confirmed",
      coordinates: { latitude: 40.7412, longitude: -73.9927 },
      zoneLabel: "Flatiron / Chelsea",
      zoneKind: "preferred-manhattan",
    });
    expect(model.selected?.mapPosition).toMatchObject({
      left: expect.any(Number),
      top: expect.any(Number),
    });
  });

  it("uses provider coordinates from saved listings before fixture lookup", () => {
    const listing = {
      ...fixtureListings[0]!,
      id: "streeteasy-live-geopoint",
      title: "58 2nd Avenue 1F",
      address: "58 2nd Avenue 1F",
      neighborhood: "East Village",
      borough: "Manhattan",
      location: { latitude: 40.7251, longitude: -73.9912 },
    };

    const model = createMapReviewModel([listing], listing.id);

    expect(model.locatedCandidates).toHaveLength(1);
    expect(model.missingLocationCandidates).toHaveLength(0);
    expect(model.selected).toMatchObject({
      pinState: "confirmed",
      coordinates: { latitude: 40.7251, longitude: -73.9912 },
      zoneLabel: "East Village",
      zoneKind: "preferred-manhattan",
    });
  });

  it("geocodes StreetEasy addresses when the saved address includes unit text", () => {
    const listing = withDefined<ListingCandidate>({
      ...fixtureListings[0]!,
      id: "streeteasy-325-east-14-phd",
      title: "325 EAST 14 STREET PH-D, NEW YORK, NY 10003",
      address: "325 East 14 Street PHD",
      neighborhood: undefined,
      borough: "Manhattan",
    });

    const model = createMapReviewModel([listing], listing.id);

    expect(model.locatedCandidates).toHaveLength(1);
    expect(model.missingLocationCandidates).toHaveLength(0);
    expect(model.selected).toMatchObject({
      pinState: "confirmed",
      coordinates: { latitude: 40.7317, longitude: -73.9841 },
      zoneLabel: "East Village",
      zoneKind: "preferred-manhattan",
    });
  });

  it("geocodes Avenue A StreetEasy addresses with unit text", () => {
    const listing = withDefined<ListingCandidate>({
      ...fixtureListings[0]!,
      id: "streeteasy-205-avenue-a-5a",
      title: "205 AVENUE A 5A, NEW YORK, NY 10009",
      address: "205 AVENUE A 5A, NEW YORK, NY 10009",
      neighborhood: undefined,
      borough: "Manhattan",
    });

    const model = createMapReviewModel([listing], listing.id);

    expect(model.locatedCandidates).toHaveLength(1);
    expect(model.missingLocationCandidates).toHaveLength(0);
    expect(model.selected).toMatchObject({
      pinState: "confirmed",
      coordinates: { latitude: 40.7301, longitude: -73.9834 },
      zoneLabel: "East Village",
      zoneKind: "preferred-manhattan",
    });
  });

  it("geocodes current live StreetEasy saved-list addresses with unit text", () => {
    const addressFixtures: readonly (readonly [address: string, neighborhood: string])[] = [
      ["58 2nd Avenue 1F", "East Village"],
      ["54 2nd Avenue 3", "East Village"],
      ["176 Stanton Street 1A", "Lower East Side"],
      ["171 Attorney Street 4A", "Lower East Side"],
      ["247 Mulberry Street SW", "Nolita"],
      ["171 6th Avenue 3B", "Hudson Square"],
    ];
    const listings = addressFixtures.map(([address, neighborhood]) => ({
      ...fixtureListings[0]!,
      id: `streeteasy-${address}`,
      title: "StreetEasy listing",
      address,
      neighborhood,
      borough: "Manhattan",
    }));

    const model = createMapReviewModel(listings, listings[0]?.id);

    expect(model.locatedCandidates).toHaveLength(listings.length);
    expect(model.missingLocationCandidates).toHaveLength(0);
    expect(model.candidates.map((candidate) => candidate.zoneKind)).toEqual(
      listings.map(() => "preferred-manhattan"),
    );
  });
});
