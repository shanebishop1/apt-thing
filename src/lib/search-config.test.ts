import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => vi.resetModules());

// A different search must propagate through real consumers, not just config exports.
vi.mock("./search-config", () => ({
  SEARCH_CONFIG: {
    minBedrooms: 3,
    minBathrooms: 3,
    maxRent: 9000,
    flexHighConfidenceThreshold: 0.85,
    moveIn: { target: "2027-02-01", acceptableMonths: ["2027-02", "2027-03"] },
    preferredNeighborhoods: ["Harlem"],
    exceptionalFallback: { boroughs: ["Bronx"], maxRent: 7500 },
  },
}));

import {
  calculateFitFlags,
  createListingFromUrl,
  createGroupIdentity,
  defaultSearchGroup,
} from "./listings";
import { DEFAULT_STREETEASY_URL_RESOLUTION_QUERY } from "./listings/config";
import { streetEasyBatchFixture } from "./fixtures";
import { buildConcerns } from "./extraction/normalization";
import { createTriageCandidateFromListing } from "./extraction/triage-candidates";
import { evaluateDeterministicHardConstraints } from "./triage/rules";
import { FIT_EVIDENCE_RUBRIC } from "./triage/rubric";
import { runDailySourceAgentLoop } from "./daily-source-loop";
import { toTriageMetadata } from "./daily-loop/candidates";

const identity = createGroupIdentity(defaultSearchGroup.id, "Config test")!;
const draft = {
  title: "Configured apartment",
  rent: 8000,
  bedrooms: 3,
  bathrooms: 3,
  neighborhood: "Harlem",
  borough: "Manhattan",
  availableAt: "2027-02-15",
  description: "Entire apartment rental",
};

describe("shared search configuration", () => {
  it("uses the configured live discovery filter and sends the same criteria to Gemini", async () => {
    const urls: URL[] = [];
    let instructions = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.hostname === "generativelanguage.googleapis.com") {
        instructions = JSON.parse(String(init?.body)).contents[0].parts[0].text;
        return Response.json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
      }
      return Response.json([
        {
          id: "config-test",
          url: "https://streeteasy.com/building/config-test/1",
          address: "1 Example Street",
          ...draft,
        },
      ]);
    };
    const result = await runDailySourceAgentLoop({
      identity,
      mode: "live-safe",
      env: { AI_RUNS_ENABLED: "true", REALTYAPI_KEY: "test", GEMINI_API_KEY: "test" },
      fetchImpl,
    });
    expect(result.listings).toHaveLength(1); // A hardcoded 5BR filter would discard this 3BR.
    expect(
      urls
        .filter((url) => url.pathname === "/search/rent")
        .every((url) => url.searchParams.get("location") === "harlem"),
    ).toBe(true);
    expect(instructions).toContain("3-bedroom apartment search");
    expect(instructions).toContain("at least 3 bathrooms");
    expect(instructions).toContain("$9000");
    expect(instructions).toContain("2027-02-01");
    expect(instructions).toContain("Harlem");
    const scores = toTriageMetadata(result.listings[0]!, new Date().toISOString()).confidence;
    expect(scores).toMatchObject({ realFiveBedroom: 0.9, twoPlusBathrooms: 0.9, priceFit: 0.95 });
  });
  it("updates provider defaults and the default batch query", () => {
    expect(DEFAULT_STREETEASY_URL_RESOLUTION_QUERY).toMatchObject({ minBeds: 3, maxRent: 9000 });
    expect(streetEasyBatchFixture.query).toMatchObject({
      minBeds: 3,
      maxRent: 9000,
      areas: ["harlem"],
    });
  });
  it("updates fit flags and extraction concerns at the new boundaries", () => {
    expect(calculateFitFlags(draft)).toEqual([
      "price_fit",
      "beds_fit",
      "bathrooms_fit",
      "location_fit",
    ]);
    expect(buildConcerns(draft, false)).toEqual([]);
    expect(buildConcerns({ ...draft, bedrooms: 2, bathrooms: 2, rent: 9001 }, false)).toEqual([
      "Rent is above the $9,000 ceiling.",
      "Bedroom count is below the 3BR target.",
      "Bathroom count is below the 3 bath target.",
    ]);
  });
  it("updates deterministic rules, date windows and the AI rubric together", () => {
    const listing = createListingFromUrl(
      "https://streeteasy.com/building/configured/1",
      identity,
      draft,
    );
    const checks = evaluateDeterministicHardConstraints(
      createTriageCandidateFromListing(listing, "test-run"),
    );
    for (const factor of ["bedrooms", "bathrooms", "rent", "moveIn", "location"]) {
      expect(checks.find((check) => check.factor === factor)?.status, factor).toBe("pass");
    }
    expect(checks.find((check) => check.factor === "bedrooms")?.reason).toContain("3BR");
    expect(checks.find((check) => check.factor === "rent")?.reason).toContain("$9,000");
    expect(FIT_EVIDENCE_RUBRIC.hardConstraints).toMatchObject({
      bedroom: { minimum: 3 },
      bathrooms: { minimum: 3 },
      maxRent: 9000,
      moveIn: { target: "2027-02-01" },
    });
  });
  it("uses configured fallback boroughs, budget and bedroom minimum", () => {
    const fallback = createListingFromUrl("https://streeteasy.com/building/fallback/1", identity, {
      ...draft,
      borough: "Bronx",
      rent: 7500,
    });
    expect(createTriageCandidateFromListing(fallback, "test-run").exceptionalFallbackEvidence).toBe(
      true,
    );
    expect(
      createTriageCandidateFromListing({ ...fallback, rent: 7501 }, "test-run")
        .exceptionalFallbackEvidence,
    ).toBe(false);
  });
});
