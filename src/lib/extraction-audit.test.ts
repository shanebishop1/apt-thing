import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteD1 } from "../test-support/sqlite-d1";
import { createGroupIdentity, defaultSearchGroup } from "./listings";
import { createListingFromSharedApi } from "./shared-listing-api";

afterEach(() => vi.unstubAllGlobals());
const identity = createGroupIdentity(defaultSearchGroup.id, "Audit")!;

describe("persisted extraction provider audit", () => {
  it("records RealtyAPI without inventing a Gemini model", async () => {
    const db = createSqliteD1();
    const url = "https://streeteasy.com/building/123-east-10-street-new_york/1";
    vi.stubGlobal("fetch", async (input: string | URL) =>
      String(input).includes("geosearch")
        ? Response.json({ features: [] })
        : Response.json([
            {
              id: "123",
              url,
              address: "123 East 10th Street",
              bedrooms: 5,
              bathrooms: 2,
              price: 12000,
            },
          ]),
    );
    try {
      const result = await createListingFromSharedApi({
        db,
        identity,
        rawUrl: url,
        env: { REALTYAPI_KEY: "test" },
      });
      expect(result.kind).toBe("created");
      const row = db.sqlite.prepare("SELECT job_json FROM app_extraction_jobs").get()!;
      const job = JSON.parse(String(row.job_json));
      expect(job.provider).toBe("realtyapi");
      expect(job.model).toBeUndefined();
      expect(job.requestAttempts.length).toBeGreaterThan(0);
      expect(
        job.requestAttempts.map((attempt: { operation?: string }) => attempt.operation),
      ).toEqual(expect.arrayContaining(["geosearch", "rental-search"]));
    } finally {
      db.close();
    }
  });

  it.each([false, true])("records the actual Gemini model after fallback=%s", async (fallback) => {
    const db = createSqliteD1();
    vi.stubGlobal("fetch", async (input: string | URL) => {
      if (!String(input).includes("generativelanguage"))
        return new Response(
          "<title>Five bedroom apartment</title><p>123 Main Street, 5 bedrooms, 2 bathrooms, $12000</p>",
        );
      if (fallback && String(input).includes("gemini-2.5-flash"))
        return Response.json({}, { status: 404 });
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    title: "Five bedroom apartment",
                    address: "123 Main Street",
                    bedrooms: 5,
                    bathrooms: 2,
                    rent: 12000,
                    evidence: [],
                    concerns: [],
                    confidence: 0.9,
                  }),
                },
              ],
            },
          },
        ],
      });
    });
    try {
      await createListingFromSharedApi({
        db,
        identity,
        rawUrl: "https://listing.example/apartment",
        env: { GEMINI_API_KEY: "test" },
      });
      const row = db.sqlite.prepare("SELECT job_json FROM app_extraction_jobs").get()!;
      const job = JSON.parse(String(row.job_json));
      expect(job).toMatchObject({
        provider: "google-direct",
        model: fallback ? "gemini-3.5-flash" : "gemini-2.5-flash",
      });
      expect(job.requestAttempts).toHaveLength(fallback ? 2 : 1);
    } finally {
      db.close();
    }
  });
});
