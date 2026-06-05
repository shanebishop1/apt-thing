import { describe, expect, it } from "vitest";
import {
  calculateFitFlags,
  classifySource,
  createDuplicateKey,
  createListingFromUrl,
  updateListingField,
  updateReviewStatus,
} from "./listings";

const identity = { inviteCode: "apt-g1", displayName: "Tester" };

describe("listing contracts", () => {
  it("classifies first-class and fallback apartment sources", () => {
    expect(classifySource("https://streeteasy.com/building/example/1")).toBe("streeteasy");
    expect(classifySource("https://www.zillow.com/homedetails/example")).toBe("zillow");
    expect(classifySource("https://newyork.craigslist.org/mnh/apa/example.html")).toBe(
      "craigslist",
    );
    expect(classifySource("https://example.com/listing")).toBe("other");
  });

  it("normalizes duplicate keys across fragments and query order", () => {
    expect(createDuplicateKey("https://www.zillow.com/homedetails/abc/?b=2&a=1#photos")).toBe(
      createDuplicateKey("https://zillow.com/homedetails/abc/?a=1&b=2"),
    );
  });

  it("creates manual-needed stubs for unknown or incomplete listings", () => {
    const listing = createListingFromUrl("https://example.com/private-lead", identity);

    expect(listing.extractionStatus).toBe("manual-needed");
    expect(listing.fitFlags).toContain("missing_required_fields");
    expect(listing.url).toBe("https://example.com/private-lead");
  });

  it("adds light fit flags for G1 constraints", () => {
    expect(
      calculateFitFlags({
        rent: 14999,
        bedrooms: 5,
        bathrooms: 2,
        neighborhood: "Flatiron",
        title: "Test",
      }),
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
    expect(edited.bathrooms).toBe(2);
    expect(edited.fitFlags).toContain("bathrooms_fit");
    expect(edited.fieldProvenance.at(-1)).toMatchObject({
      field: "bathrooms",
      source: "user-confirmed",
      editedValue: "2",
      actor: "Tester",
    });
  });
});
