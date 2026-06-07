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
    expect(model.attribution).toContain("No paid/proprietary data");
    expect(model.mobileModes).toEqual(["map", "list", "detail"]);

    const williamsburg = model.candidates.find(
      (candidate) => candidate.listing.id === selected?.id,
    );

    expect(williamsburg).toMatchObject({
      pinState: "review",
      zoneKind: "exceptional-fallback",
      boroughFallback: "Brooklyn fallback",
      confidenceLabel: "Needs roommate review",
    });
    expect(williamsburg?.subway[0]).toMatchObject({
      station: expect.any(String),
      routes: expect.any(Array),
    });
    expect(williamsburg?.contextAmenities[0]).toMatchObject({ kind: "grocery" });
    expect(williamsburg?.evidenceSummary).toContain(":");
    expect(williamsburg?.sourceLinks).toContain(williamsburg?.listing.url);
  });

  it("keeps missing-coordinate listings reviewable in the synchronized list/detail flow", () => {
    const unmapped = {
      ...fixtureListings[0]!,
      id: "fixture-unmapped",
      title: "Fixture listing without map context",
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
});
