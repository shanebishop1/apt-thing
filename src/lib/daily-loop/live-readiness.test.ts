import { describe, expect, it, vi } from "vitest";
import { createSqliteD1 } from "../../test-support/sqlite-d1";
import { runDailySourceAgentLoop } from "../daily-source-loop";
import { createDailyLoopProviderFailureAnalyzer } from "./gemini-analyzer";
import {
  createGroupIdentity,
  createGroupScopedDuplicateKey,
  defaultSearchGroup,
} from "../listings";
import { readSharedListingSnapshot } from "../shared-listing-store";

const identity = createGroupIdentity(defaultSearchGroup.id, "Live readiness")!;
const sourceUrl = "https://streeteasy.com/building/live-readiness/5";

function providerFetch(rent = 12000): typeof fetch {
  return async () =>
    Response.json([
      {
        id: "live-readiness",
        url: sourceUrl,
        address: "55 Example Street",
        bedrooms: 5,
        bathrooms: 2,
        rent,
        description: "Whole apartment with five bedrooms and two bathrooms.",
      },
    ]);
}

describe("live source-loop readiness", () => {
  it("reports AI failures as partial and records elapsed acquisition time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T10:00:00Z"));
    try {
      const result = await runDailySourceAgentLoop({
        identity,
        mode: "live-safe",
        env: { REALTYAPI_KEY: "test" },
        analyzer: createDailyLoopProviderFailureAnalyzer("gemini-http-503"),
        fetchImpl: async (...args) => {
          vi.setSystemTime(Date.now() + 2000);
          return providerFetch()(...args);
        },
      });
      expect(result.run.status).toBe("partial");
      expect(
        Date.parse(result.run.completedAt!) - Date.parse(result.run.startedAt),
      ).toBeGreaterThan(1000);
    } finally {
      vi.useRealTimers();
    }
  });
  it("loads persisted history for live URLs and preserves roommate edits across repeated runs", async () => {
    const db = createSqliteD1();
    try {
      const options = {
        identity,
        mode: "live-safe" as const,
        env: { DB: db, REALTYAPI_KEY: "test", GEMINI_API_KEY: "" },
        fetchImpl: providerFetch(),
      };
      const first = await runDailySourceAgentLoop({ ...options, now: "2026-09-19T10:00:00Z" });
      expect(first.persistence.outcome.d1.error).toBeUndefined();
      const saved = (await readSharedListingSnapshot(db)).listings[0]!;
      expect(saved).toBeDefined();
      const edited = { ...saved, reviewStatus: "touring", title: "Roommates' chosen title" };
      await db
        .prepare("UPDATE app_saved_listings SET listing_json = ?, revision = 2 WHERE id = ?")
        .bind(JSON.stringify(edited), saved.id)
        .run();
      const second = await runDailySourceAgentLoop({ ...options, now: "2026-09-19T11:00:00Z" });
      expect(second.listings).toHaveLength(0);
      expect(second.skipped).toEqual(
        expect.arrayContaining([expect.objectContaining({ sourceUrl })]),
      );
      expect((await readSharedListingSnapshot(db)).listings[0]).toMatchObject({
        reviewStatus: "touring",
        title: edited.title,
        revision: 2,
      });
      // Changed source facts can be analyzed, but must not replace the shared review record.
      const changed = await runDailySourceAgentLoop({
        ...options,
        fetchImpl: providerFetch(12100),
        now: "2026-09-19T12:00:00Z",
      });
      expect(changed.materialChanges).toHaveLength(1);
      expect(changed.persistence.outcome.d1.error).toBeUndefined();
      expect((await readSharedListingSnapshot(db)).listings[0]).toMatchObject({
        reviewStatus: "touring",
        title: edited.title,
        rent: 12000,
        revision: 2,
      });
    } finally {
      db.close();
    }
  });

  it("does not resurrect a rejected listing even if rejection happens during acquisition", async () => {
    const db = createSqliteD1();
    try {
      let rejected = false;
      const fetchImpl: typeof fetch = async (...args) => {
        if (!rejected) {
          rejected = true;
          const key = createGroupScopedDuplicateKey(identity.groupId, sourceUrl);
          await db
            .prepare(
              "INSERT INTO app_seen_rejected_memory (id, group_id, source_url, group_scoped_duplicate_key, memory_json, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(
              "rejected-during-run",
              identity.groupId,
              sourceUrl,
              key,
              JSON.stringify({
                groupId: identity.groupId,
                sourceUrl,
                groupScopedDuplicateKey: key,
                memoryState: "rejected",
              }),
              "2026-09-19T10:00:00Z",
            )
            .run();
        }
        return providerFetch()(...args);
      };
      const result = await runDailySourceAgentLoop({
        identity,
        mode: "live-safe",
        env: { DB: db, REALTYAPI_KEY: "test", GEMINI_API_KEY: "" },
        fetchImpl,
      });
      expect(result.persistence.outcome.d1.error).toBeUndefined();
      expect((await readSharedListingSnapshot(db)).listings).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it.each([401, 429, 500])(
    "reports provider HTTP %s as failed coverage rather than successful empty discovery",
    async (status) => {
      const result = await runDailySourceAgentLoop({
        identity,
        mode: "live-safe",
        env: { REALTYAPI_KEY: "test", GEMINI_API_KEY: "" },
        fetchImpl: async () => Response.json({}, { status }),
      });
      expect(result.sourceCoverage[0]).toMatchObject({
        status: "failed",
        failureCode: `streeteasy-live-safe-search-http-${status}`,
      });
      expect(result.run.status).not.toBe("success");
      expect(result.run.counts.sourceFailures).toBe(1);
    },
  );
});
