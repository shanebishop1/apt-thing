import { describe, expect, it } from "vitest";
import { fixtureListings } from "./fixtures";
import { createMapReviewModel } from "./map-review";

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
    const unmapped = {
      ...fixtureListings[0]!,
      id: "fixture-unmapped",
      title: "Fixture listing without map context",
      address: "Unknown fixture address",
      neighborhood: undefined,
      borough: undefined,
    };
    const model = createMapReviewModel([unmapped], unmapped.id);

    expect(model.locatedCandidates).toHaveLength(0);
    expect(model.missingLocationCandidates).toHaveLength(1);
    expect(model.selected).toMatchObject({
      pinState: "missing-location",
      zoneLabel: "Location pending",
      boroughFallback: "Borough pending",
    });
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

  it("geocodes StreetEasy addresses when the saved address includes unit text", () => {
    const listing = {
      ...fixtureListings[0]!,
      id: "streeteasy-325-east-14-phd",
      title: "325 EAST 14 STREET PH-D, NEW YORK, NY 10003",
      address: "325 East 14 Street PHD",
      neighborhood: undefined,
      borough: "Manhattan",
    };

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
    const listing = {
      ...fixtureListings[0]!,
      id: "streeteasy-205-avenue-a-5a",
      title: "205 AVENUE A 5A, NEW YORK, NY 10009",
      address: "205 AVENUE A 5A, NEW YORK, NY 10009",
      neighborhood: undefined,
      borough: "Manhattan",
    };

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
});
