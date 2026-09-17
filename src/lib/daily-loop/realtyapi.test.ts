import { describe, expect, it } from "vitest";
import { realtyApiRecordToListingDraft } from "./realtyapi";

describe("realtyApiRecordToListingDraft", () => {
  it("maps RealtyAPI's postal city onto the borough the triage rubric expects", () => {
    const draft = realtyApiRecordToListingDraft({
      propertyDetails: {
        address: { street: "228 Thompson Street", unit: "1A", city: "NEW YORK" },
        geoPoint: { latitude: 40.7289, longitude: -73.9989 },
      },
      pricing: { price: 15000 },
    });

    expect(draft.borough).toBe("Manhattan");
    expect(draft.location).toEqual({ latitude: 40.7289, longitude: -73.9989 });
  });

  it("keeps real borough names and unknown cities as they are", () => {
    expect(realtyApiRecordToListingDraft({ borough: "brooklyn" }).borough).toBe("Brooklyn");
    expect(realtyApiRecordToListingDraft({ city: "Hoboken" }).borough).toBe("Hoboken");
    expect(realtyApiRecordToListingDraft({}).borough).toBeUndefined();
  });
});
