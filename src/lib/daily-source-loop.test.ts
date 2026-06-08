import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../../app/api/platform/daily-loop/route";
import {
  createDailyLoopCronPayload,
  createDailyLoopProviderFailureAnalyzer,
  runDailySourceAgentLoop,
} from "./daily-source-loop";
import { streetEasyBatchFixture } from "./fixtures";
import {
  createGroupScopedListingState,
  createInviteIdentity,
  defaultSearchGroup,
} from "./listings";
import { validateBriefingRunHistoryContract } from "./agent-contracts";
import {
  DAILY_SOURCE_AGENT_LOOP_WORKFLOW_BINDING,
  createDailyLoopWorkerHandler,
  scheduledDailySourceAgentLoop,
} from "./daily-source-worker";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: {} }),
}));

const identity = createInviteIdentity(defaultSearchGroup.inviteCode, "Daily Loop Test")!;

describe("runDailySourceAgentLoop", () => {
  it("runs fixture-mode manual/daily-compatible loop with StreetEasy and Zillow manual fixture", async () => {
    const result = await runDailySourceAgentLoop({
      identity,
      cadence: "daily",
      trigger: "cron",
      now: "2026-06-07T15:00:00.000Z",
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
            reviewStatus: "rejected",
          },
        ),
      ],
      concurrencyLimit: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("fixture");
    expect(result.run.cadence).toBe("daily");
    expect(result.run.trigger).toBe("cron");
    expect(result.run.status).toBe("success");
    expect(result.sourceCoverage.map((coverage) => coverage.source)).toEqual([
      "streeteasy",
      "zillow",
    ]);
    expect(result.sourceCoverage[0]?.queryMetadata).toMatchObject({ endpoint: "search/rent" });
    expect(result.sourceCoverage[0]?.detailRetryMetadata?.length).toBe(
      streetEasyBatchFixture.results.length,
    );
    expect(result.skipped.map((item) => item.reason).sort()).toEqual(["seen", "triaged"]);
    expect(result.listings.length).toBe(3);
    expect(result.listings.every((listing) => listing.imageEvidence.length <= 5)).toBe(true);
    expect(result.observability.fanOut.maxObservedInFlight).toBeLessThanOrEqual(2);
    expect(result.persistence.d1.authoritativeTables).toContain("daily_loop_runs");
    expect(result.persistence.rawArtifacts.rawArtifactPointers.length).toBeGreaterThan(0);
    expect(result.persistence.rawArtifacts.storage).toBe("disabled-no-r2");
    expect(result.persistence.kv.authoritative).toBe(false);
    expect(result.persistence.outcome).toMatchObject({
      d1: { attempted: false, skippedReason: "missing-binding", rowsWritten: 0 },
      r2: { attempted: false, skippedReason: "disabled-no-r2", objectsWritten: 0 },
    });
    expect(validateBriefingRunHistoryContract(result.history)).toEqual([]);
  });

  it("isolates source and provider failures into partial/review-needed outputs", async () => {
    const result = await runDailySourceAgentLoop({
      identity,
      now: "2026-06-07T16:00:00.000Z",
      failSecondary: true,
      analyzer: createDailyLoopProviderFailureAnalyzer(),
      concurrencyLimit: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.run.status).toBe("partial");
    expect(result.run.counts.sourceFailures).toBe(1);
    expect(result.sourceCoverage.find((coverage) => coverage.source === "zillow")?.status).toBe(
      "failed",
    );
    expect(result.listings.length).toBeGreaterThan(0);
    expect(
      result.listings.filter((listing) => listing.triageBucket === "review-needed").length,
    ).toBeGreaterThan(0);
    expect(result.run.units.some((unit) => unit.status === "failed")).toBe(true);
    expect(validateBriefingRunHistoryContract(result.history)).toEqual([]);
  });

  it("converts thrown or invalid Gemini analyzer outputs into visible review-needed fallbacks", async () => {
    const throwingResult = await runDailySourceAgentLoop({
      identity,
      now: "2026-06-07T16:15:00.000Z",
      failSecondary: true,
      analyzer: () => {
        throw new Error("gemini-provider-timeout");
      },
    });

    expect(throwingResult.ok).toBe(true);
    expect(throwingResult.listings).toHaveLength(streetEasyBatchFixture.results.length);
    expect(
      throwingResult.listings.every((listing) => listing.triageBucket !== "confirmed-match"),
    ).toBe(true);
    expect(
      throwingResult.listings.every((listing) => listing.triageBucket === "review-needed"),
    ).toBe(true);
    expect(
      throwingResult.history.latestRun.providerMetadata.every(
        (metadata) =>
          metadata.status === "failed" && metadata.failureCode === "gemini-provider-timeout",
      ),
    ).toBe(true);
    expect(
      throwingResult.run.units.filter(
        (unit) => unit.status === "failed" && unit.source === "gemini",
      ),
    ).toHaveLength(streetEasyBatchFixture.results.length);

    const invalidOutputResult = await runDailySourceAgentLoop({
      identity,
      now: "2026-06-07T16:30:00.000Z",
      failSecondary: true,
      analyzer: async (input) => {
        const fallback = await createDailyLoopProviderFailureAnalyzer("unused")(input);
        return {
          status: "success",
          triage: {
            schemaVersion: "wrong-schema",
            bucket: "confirmed-match",
            confidence: { overall: 1, factors: {} },
            evidence: [],
            reasons: ["invalid fixture should not confirm"],
            concerns: [],
            suggestedAction: "confirm",
          } as any,
          providerMetadata: {
            ...fallback.providerMetadata,
            status: "success" as const,
            failureCode: undefined,
          },
        };
      },
    });

    expect(invalidOutputResult.ok).toBe(true);
    expect(
      invalidOutputResult.listings.every((listing) => listing.triageBucket !== "confirmed-match"),
    ).toBe(true);
    expect(
      invalidOutputResult.history.latestRun.providerMetadata.every(
        (metadata) =>
          metadata.status === "failed" &&
          metadata.schemaValidation === "failed" &&
          metadata.failureCode === "gemini-output-schema-invalid",
      ),
    ).toBe(true);
  });

  it("emits operator evidence with coverage, skips, retries, provider metadata, artifacts, and debug identifiers", async () => {
    const result = await runDailySourceAgentLoop({
      identity,
      cadence: "daily",
      trigger: "cron",
      now: "2026-06-07T16:30:00.000Z",
      priorStates: [
        createGroupScopedListingState(
          defaultSearchGroup.id,
          streetEasyBatchFixture.results[0]!.sourceUrl,
          { seen: true, triaged: false },
        ),
      ],
      failSecondary: true,
      analyzer: createDailyLoopProviderFailureAnalyzer("gemini-observability-test-failure"),
      concurrencyLimit: 2,
    });

    expect(result.operatorEvidence).toMatchObject({
      runId: result.run.id,
      groupId: defaultSearchGroup.id,
      status: "partial",
      retryPolicy: { maxRetries: 1, retryDelayMs: 250 },
      candidateCounts: expect.objectContaining({
        found: streetEasyBatchFixture.results.length + 1,
        skippedSeen: 1,
        triaged: result.listings.length,
        saved: result.listings.length,
      }),
    });
    expect(result.run.operatorEvidence).toEqual(result.operatorEvidence);
    expect(result.observability.operatorEvidence).toEqual(result.operatorEvidence);
    expect(result.history.latestRun.operatorEvidence).toEqual(result.operatorEvidence);
    expect(result.operatorEvidence.sourceCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: "streeteasy",
          status: "success",
          checkedCount: streetEasyBatchFixture.results.length,
          identifiers: expect.objectContaining({
            sourceListingIds: expect.arrayContaining([
              streetEasyBatchFixture.results[1]!.listingId,
            ]),
            sourceUrls: expect.arrayContaining([streetEasyBatchFixture.results[1]!.sourceUrl]),
          }),
        }),
        expect.objectContaining({
          sourceKey: "zillow-manual-fixture",
          status: "failed",
          failureCode: "zillow-manual-fixture-failed",
        }),
      ]),
    );
    expect(result.operatorEvidence.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: "zillow-manual-fixture",
          failureCode: "zillow-manual-fixture-failed",
        }),
      ]),
    );
    expect(result.operatorEvidence.skips.byReason).toMatchObject({ seen: 1 });
    expect(result.operatorEvidence.skips.candidates[0]).toMatchObject({
      reason: "seen",
      sourceUrl: streetEasyBatchFixture.results[0]!.sourceUrl,
    });
    expect(result.operatorEvidence.retryAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "zillow",
          status: "failed",
          maxRetries: 1,
          errorCode: "zillow-manual-fixture-failed",
        }),
      ]),
    );
    expect(result.operatorEvidence.detailRetries.length).toBe(
      streetEasyBatchFixture.results.length,
    );
    expect(result.operatorEvidence.providerAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "google-direct",
          model: "gemini-3.5-flash",
          status: "failed",
          failureCode: "gemini-observability-test-failure",
        }),
      ]),
    );
    expect(result.operatorEvidence.artifactPointers).toEqual(
      expect.arrayContaining([expect.objectContaining({ owner: "d1", groupScoped: true })]),
    );
    expect(result.operatorEvidence.debugIdentifiers.listingIds.length).toBeGreaterThan(0);
    expect(result.operatorEvidence.debugIdentifiers.sourceListingIds.length).toBeGreaterThan(0);
    expect(result.operatorEvidence.debugIdentifiers.sourceUrls).toEqual(
      expect.arrayContaining(result.listings.map((listing) => listing.url)),
    );
  });

  it("processes material changes instead of skipping saved listings", async () => {
    const changedFixture = structuredClone(streetEasyBatchFixture);
    changedFixture.results = [streetEasyBatchFixture.results[2]!];
    const staleListing = (
      await runDailySourceAgentLoop({
        identity,
        streeteasyFixture: changedFixture,
        failSecondary: true,
        now: "2026-06-07T17:00:00.000Z",
      })
    ).listings[0]!;
    changedFixture.results[0]!.details.rent = (staleListing.rent ?? 0) + 100;

    const result = await runDailySourceAgentLoop({
      identity,
      streeteasyFixture: changedFixture,
      existingListings: [staleListing],
      failSecondary: true,
      now: "2026-06-07T18:00:00.000Z",
    });

    expect(result.materialChanges).toHaveLength(1);
    expect(result.materialChanges[0]?.materialChangeReasons).toContain("rent-changed");
    expect(result.listings).toHaveLength(1);
    expect(result.run.counts.candidatesSkippedSeen).toBe(0);
    expect(result.run.units.find((unit) => unit.sourceUrl === staleListing.url)?.status).toBe(
      "success",
    );
    expect(
      result.skipped.some(
        (item) => !item.materialChangeDetected && item.sourceUrl === staleListing.url,
      ),
    ).toBe(false);
  });

  it("exposes a workflow/cron-compatible payload with hourly future cadence", () => {
    expect(createDailyLoopCronPayload()).toMatchObject({
      workflowCompatible: true,
      cronCompatible: true,
      cadence: "daily",
      supportedCadences: ["manual", "daily", "hourly"],
      scheduledRoute: "/api/platform/daily-loop?cadence=daily&trigger=cron",
      workflowHandler: "handleDailyLoopWorkflowPayload",
    });
  });

  it("persists D1 rows and keeps raw artifacts disabled without R2", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async run() {
                statements.push({ sql, values });
              },
            };
          },
        };
      },
    };

    const result = await runDailySourceAgentLoop({
      identity,
      now: "2026-06-07T19:00:00.000Z",
      env: { DB: db },
    });

    expect(result.persistence.outcome.d1).toMatchObject({ attempted: true });
    expect(result.persistence.outcome.d1.rowsWritten).toBeGreaterThan(0);
    expect(result.persistence.outcome.r2).toMatchObject({
      attempted: false,
      skippedReason: "disabled-no-r2",
      objectsWritten: 0,
    });
    expect(statements.some((statement) => statement.sql.includes("daily_loop_runs"))).toBe(true);
    const runTransitions = statements.filter((statement) =>
      statement.sql.includes("daily_loop_runs"),
    );
    expect(runTransitions.slice(0, 3).map((statement) => statement.values[4])).toEqual([
      "queued",
      "running",
      result.run.status,
    ]);
    const finalRunObservability = JSON.parse(String(runTransitions[2]?.values[9] ?? "{}")) as {
      operatorEvidence?: {
        runId?: string;
        providerAttempts?: unknown[];
        artifactPointers?: unknown[];
      };
    };
    expect(finalRunObservability.operatorEvidence).toMatchObject({ runId: result.run.id });
    expect(finalRunObservability.operatorEvidence?.providerAttempts?.length).toBeGreaterThan(0);
    expect(finalRunObservability.operatorEvidence?.artifactPointers?.length).toBeGreaterThan(0);
    expect(
      statements.some((statement) => statement.sql.includes("daily_loop_candidate_status")),
    ).toBe(true);
    const authoritativeListingRows = statements.filter((statement) =>
      statement.sql.includes("listing_candidates"),
    );
    const candidateRows = statements.filter((statement) =>
      statement.sql.includes("daily_loop_candidates"),
    );
    expect(authoritativeListingRows).toHaveLength(result.listings.length);
    expect(authoritativeListingRows.map((statement) => statement.values[0]).sort()).toEqual(
      result.listings.map((listing) => listing.id).sort(),
    );
    expect(candidateRows.map((statement) => statement.values[3]).sort()).toEqual(
      result.listings.map((listing) => listing.id).sort(),
    );
    for (const listing of result.listings) {
      const listingUpsertIndex = statements.findIndex(
        (statement) =>
          statement.sql.includes("listing_candidates") && statement.values[0] === listing.id,
      );
      const dependentInsertIndex = statements.findIndex(
        (statement) =>
          statement.sql.includes("daily_loop_candidates") && statement.values[3] === listing.id,
      );
      expect(listingUpsertIndex).toBeGreaterThanOrEqual(0);
      expect(dependentInsertIndex).toBeGreaterThan(listingUpsertIndex);
    }
    const evidenceRows = statements.filter((statement) =>
      statement.sql.includes("source_evidence_records"),
    );
    expect(evidenceRows.some((statement) => result.listings[0]?.id === statement.values[2])).toBe(
      true,
    );
    const firstListingEvidenceIndex = statements.findIndex(
      (statement) =>
        statement.sql.includes("source_evidence_records") &&
        statement.values[2] === result.listings[0]?.id,
    );
    const firstListingUpsertIndex = statements.findIndex(
      (statement) =>
        statement.sql.includes("listing_candidates") &&
        statement.values[0] === result.listings[0]?.id,
    );
    expect(firstListingEvidenceIndex).toBeGreaterThan(firstListingUpsertIndex);
    expect(result.persistence.rawArtifacts.rawArtifactPointers).toEqual(
      expect.arrayContaining([expect.objectContaining({ owner: "d1", groupScoped: true })]),
    );
  });

  it("surfaces D1 and KV persistence failures without dropping run outputs", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind(..._values: unknown[]) {
            return {
              async run() {
                throw new Error(
                  sql.includes("daily_loop_runs") ? "d1-transition-failed" : "d1-write-failed",
                );
              },
            };
          },
        };
      },
    };
    const kv = {
      put: vi.fn(async () => {
        throw new Error("kv-cache-failed");
      }),
    };

    const result = await runDailySourceAgentLoop({
      identity,
      now: "2026-06-07T19:30:00.000Z",
      env: { DB: db, APP_CACHE: kv } as any,
    });

    expect(result.ok).toBe(true);
    expect(result.listings.length).toBeGreaterThan(0);
    expect(result.history.latestRun.candidateSummaries.length).toBe(result.listings.length);
    expect(result.persistence.outcome.d1).toMatchObject({
      attempted: true,
      rowsWritten: 0,
      error: expect.stringContaining("d1-transition-failed"),
    });
    expect(result.persistence.outcome.r2).toMatchObject({
      attempted: false,
      skippedReason: "disabled-no-r2",
      objectsWritten: 0,
    });
    expect(result.persistence.outcome.kv).toMatchObject({
      attempted: true,
      writes: 0,
      authoritative: false,
      error: "kv-cache-failed",
    });
  });

  it("normalizes recognized live-safe StreetEasy payloads into candidate processing", async () => {
    const liveListing = {
      listing_id: "live-1",
      url: "https://streeteasy.com/building/live-building/5a",
      title: "Live Safe 5BR",
      address: "1 Live St, New York, NY",
      neighborhood: "Chelsea",
      borough: "Manhattan",
      rent: 12000,
      bedrooms: 5,
      bathrooms: 2,
      available_at: "2026-08-01",
      description: "Whole apartment with five bedrooms.",
      amenities: ["Laundry"],
      photos: ["https://images.example/live.jpg"],
    };
    const fetchImpl = vi.fn(async (url: string) =>
      Response.json(
        url.includes("search/rent") ? { results: [liveListing] } : { listing: liveListing },
      ),
    );

    const result = await runDailySourceAgentLoop({
      identity,
      mode: "live-safe",
      failSecondary: true,
      env: { REALTYAPI_KEY: "test-key", REALTYAPI_BASE_URL: "https://realty.test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.sourceCoverage[0]?.classification).toBe("success");
    expect(result.sourceCoverage[0]?.queryMetadata).toMatchObject({
      liveSafe: { liveAttempted: true },
    });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.sourceListingId).toBe("live-1");
  });

  it("marks non-2xx and missing live-safe detail metadata without capping detail coverage", async () => {
    const liveListings = ["live-1", "live-2", "live-3"].map((id, index) => ({
      listing_id: id,
      url: `https://streeteasy.com/building/live-building/${index + 1}a`,
      title: `Live Safe 5BR ${index + 1}`,
      address: `${index + 1} Live St, New York, NY`,
      neighborhood: "Chelsea",
      borough: "Manhattan",
      rent: 12000 + index,
      bedrooms: 5,
      bathrooms: 2,
      available_at: "2026-08-01",
      description: "Whole apartment with five bedrooms.",
      amenities: ["Laundry"],
      photos: [`https://images.example/live-${index + 1}.jpg`],
    }));
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("search/rent")) return Response.json({ results: liveListings });
      const body = JSON.parse(String(init?.body ?? "{}")) as { listing_id?: string };
      if (body.listing_id === "live-2")
        return Response.json({ error: "not found" }, { status: 404 });
      if (body.listing_id === "live-3") return Response.json({});
      return Response.json({ listing: liveListings[0] });
    });

    const result = await runDailySourceAgentLoop({
      identity,
      mode: "live-safe",
      failSecondary: true,
      env: { REALTYAPI_KEY: "test-key", REALTYAPI_BASE_URL: "https://realty.test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(result.sourceCoverage[0]?.classification).toBe("partial");
    expect(result.sourceCoverage[0]?.queryMetadata).toMatchObject({
      liveSafe: { failureCode: "streeteasy-live-safe-detail-partial" },
    });
    expect(result.sourceCoverage[0]?.detailRetryMetadata).toEqual([
      expect.objectContaining({ listingId: "live-1", status: "success", fetched: true }),
      expect.objectContaining({
        listingId: "live-2",
        status: "failed",
        fetched: false,
        httpStatus: 404,
      }),
      expect.objectContaining({ listingId: "live-3", status: "missing", fetched: false }),
    ]);
    expect(result.listings).toHaveLength(3);
  });

  it("uses the Workflow binding for scheduled runs when present", async () => {
    const created: Array<Record<string, any>> = [];
    const workflow = {
      create: vi.fn(async (options?: Record<string, any>) => {
        created.push(options ?? {});
        return { id: options?.id ?? "workflow-instance" };
      }),
    };

    const result = await scheduledDailySourceAgentLoop(
      { cron: "0 10 * * *", scheduledTime: Date.parse("2026-06-07T10:00:00.000Z") },
      { [DAILY_SOURCE_AGENT_LOOP_WORKFLOW_BINDING]: workflow },
    );

    expect(workflow.create).toHaveBeenCalledTimes(1);
    expect(created[0]).toMatchObject({
      id: "daily-source-agent-loop-1780826400000-0-10-",
      params: {
        cadence: "daily",
        trigger: "cron",
        mode: "live-safe",
        cron: "0 10 * * *",
        scheduledTime: Date.parse("2026-06-07T10:00:00.000Z"),
      },
    });
    expect(result).toMatchObject({
      dispatchedToWorkflow: true,
      fallback: false,
      workflowBinding: DAILY_SOURCE_AGENT_LOOP_WORKFLOW_BINDING,
      workflowInstanceId: "daily-source-agent-loop-1780826400000-0-10-",
    });
  });

  it("skips scheduled dispatches when DAILY_LOOP_ENABLED is explicitly disabled", async () => {
    const disabledValues = ["false", "0", "off"];

    for (const value of disabledValues) {
      const workflow = {
        create: vi.fn(async () => ({ id: "workflow-instance" })),
      };

      const result = await scheduledDailySourceAgentLoop(
        { cron: "0 10 * * *", scheduledTime: Date.parse("2026-06-07T10:00:00.000Z") },
        { DAILY_LOOP_ENABLED: value, [DAILY_SOURCE_AGENT_LOOP_WORKFLOW_BINDING]: workflow },
      );

      expect(workflow.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: true,
        disabled: true,
        dispatchedToWorkflow: false,
        fallback: false,
        reason: "daily-loop-disabled",
        envVar: "DAILY_LOOP_ENABLED",
        configuredValue: value,
        payload: { cadence: "daily", trigger: "cron", mode: "live-safe" },
      });
    }
  });

  it("logs disabled scheduled runs from the Worker scheduled handler", async () => {
    const waited: Promise<unknown>[] = [];
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const worker = createDailyLoopWorkerHandler({
      fetch: async () => Response.json({ ok: true, source: "opennext" }),
    });

    worker.scheduled!(
      { cron: "0 10 * * *", scheduledTime: Date.parse("2026-06-07T10:00:00.000Z") } as any,
      { DAILY_LOOP_ENABLED: "off" },
      { waitUntil: (promise: Promise<unknown>) => waited.push(promise) } as any,
    );

    await expect(waited[0]).resolves.toMatchObject({
      disabled: true,
      reason: "daily-loop-disabled",
    });
    expect(log).toHaveBeenCalledWith(
      "daily-source-agent-loop-disabled",
      expect.objectContaining({ disabled: true, reason: "daily-loop-disabled" }),
    );
    log.mockRestore();
  });

  it("falls back visibly when scheduled Workflow dispatch fails", async () => {
    const workflow = {
      create: vi.fn(async () => {
        throw new Error("workflow-create-failed");
      }),
    };

    const result = await scheduledDailySourceAgentLoop(
      { cron: "0 10 * * *", scheduledTime: Date.parse("2026-06-07T10:00:00.000Z") },
      { [DAILY_SOURCE_AGENT_LOOP_WORKFLOW_BINDING]: workflow },
    );

    expect(workflow.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      dispatchedToWorkflow: false,
      fallback: true,
      fallbackReason: "workflow-dispatch-failed",
      scheduleFailure: {
        code: "workflow-dispatch-failed",
        message: "workflow-create-failed",
      },
      run: { cadence: "daily", trigger: "cron" },
    });
  });

  it("runs an actual scheduled Worker fallback while preserving OpenNext fetch delegation", async () => {
    const waited: Promise<unknown>[] = [];
    const db = {
      prepare() {
        return { bind: () => ({ run: async () => undefined }) };
      },
    };
    const result = await scheduledDailySourceAgentLoop(
      { cron: "0 10 * * *", scheduledTime: Date.parse("2026-06-07T10:00:00.000Z") },
      { DB: db },
    );
    const worker = createDailyLoopWorkerHandler({
      fetch: async () => Response.json({ ok: true, source: "opennext" }),
    });
    const response = await worker.fetch!(
      new Request("http://localhost/") as any,
      {} as any,
      {} as any,
    );
    worker.scheduled!(
      { cron: "0 10 * * *", scheduledTime: Date.parse("2026-06-07T10:00:00.000Z") } as any,
      { DB: db },
      { waitUntil: (promise: Promise<unknown>) => waited.push(promise) } as any,
    );

    expect(result).toMatchObject({
      run: { cadence: "daily", trigger: "cron" },
      dispatchedToWorkflow: false,
      fallback: true,
      fallbackReason: "missing-workflow-binding",
      persistence: { outcome: { d1: { attempted: true } } },
    });
    expect(await response.json()).toMatchObject({ ok: true, source: "opennext" });
    expect(waited).toHaveLength(1);
    await expect(waited[0]).resolves.toMatchObject({ ok: true, fallback: true });
  });

  it("declares the dedicated Cloudflare Workflows binding in Wrangler config", () => {
    const wranglerConfig = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");

    expect(wranglerConfig).toContain('"workflows"');
    expect(wranglerConfig).toContain('"binding": "DAILY_SOURCE_AGENT_LOOP_WORKFLOW"');
    expect(wranglerConfig).toContain('"name": "daily-source-agent-loop"');
    expect(wranglerConfig).toContain('"class_name": "DailySourceAgentLoopWorkflow"');
    expect(wranglerConfig).toContain('"crons": ["0 10 * * *"]');
    expect(wranglerConfig).toContain('"DAILY_LOOP_ENABLED": "true"');
  });

  it("falls back to fixture analyzer without a Gemini key and uses direct analyzer with a mocked key", async () => {
    const fixtureFallback = await runDailySourceAgentLoop({
      identity,
      failSecondary: true,
      now: "2026-06-07T20:00:00.000Z",
      env: {},
    });
    expect(
      fixtureFallback.history.latestRun.providerMetadata.every(
        (metadata) => metadata.schemaValidation === "passed",
      ),
    ).toBe(true);

    const mockedGeminiOutput = {
      schemaVersion: "g2c-fit-evidence-v1",
      bucket: "review-needed",
      confidence: { overall: 0.7, factors: { bedrooms: 0.9 } },
      evidence: [
        {
          factor: "source",
          claim: "Mocked Gemini reviewed source evidence.",
          quote: fixtureFallback.listings[0]!.url,
          sourceUrl: fixtureFallback.listings[0]!.url,
        },
      ],
      reasons: ["Mocked Gemini direct analyzer responded."],
      concerns: ["Keep deterministic hard constraints authoritative."],
      suggestedAction: "Review mocked Gemini output.",
    };
    const geminiBodies: Array<Record<string, any>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      geminiBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, any>);
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(mockedGeminiOutput) }],
            },
          },
        ],
      });
    });
    const direct = await runDailySourceAgentLoop({
      identity,
      failSecondary: true,
      now: "2026-06-07T21:00:00.000Z",
      env: { GEMINI_API_KEY: "gemini-test-key" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalled();
    expect(direct.history.latestRun.providerMetadata.length).toBeGreaterThan(0);
    expect(
      direct.history.latestRun.providerMetadata.every((metadata) => metadata.status === "success"),
    ).toBe(true);

    const firstRequestParts = geminiBodies[0]?.contents?.[0]?.parts ?? [];
    const structuredTextParts = firstRequestParts.filter(
      (part: Record<string, unknown>) => typeof part.text === "string",
    );
    const serializedParts = structuredTextParts.map((part: Record<string, string>) => part.text);
    const imageEvidenceText = serializedParts.find((part: string) =>
      part.includes("cappedImageEvidence"),
    );
    expect(imageEvidenceText).toBeDefined();
    const imageEvidencePayload = JSON.parse(imageEvidenceText!) as {
      cappedImageEvidence: Array<{ url: string; role: string }>;
      imageCap: number;
    };
    expect(imageEvidencePayload.imageCap).toBe(5);
    expect(imageEvidencePayload.cappedImageEvidence.length).toBeLessThanOrEqual(5);
    expect(imageEvidencePayload.cappedImageEvidence).toEqual(
      direct.listings[0]!.imageEvidence.slice(0, 5).map((image) => ({
        url: image.url,
        role: image.role,
      })),
    );
  });

  it("serves cron-compatible route payloads for daily trigger requests", async () => {
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "";
    const response = await GET(
      new NextRequest("http://localhost/api/platform/daily-loop?cadence=daily&trigger=cron"),
    );
    process.env.GEMINI_API_KEY = previousGeminiKey;
    const body = (await response.json()) as Record<string, any>;

    expect(body.ok).toBe(true);
    expect(body.contract).toBe("g4-daily-source-loop-v1");
    expect(body.historyContract).toBe("g3c-briefing-run-history-v1");
    expect(body.cron).toMatchObject({
      cadence: "daily",
      cronCompatible: true,
      scheduledRoute: "/api/platform/daily-loop?cadence=daily&trigger=cron",
    });
    expect(body.run).toMatchObject({ cadence: "daily", trigger: "cron" });
    expect(body.operatorEvidence).toMatchObject({
      runId: body.run.id,
      groupId: defaultSearchGroup.id,
      retryPolicy: { maxRetries: 1, retryDelayMs: 250 },
      candidateCounts: expect.objectContaining({
        found: expect.any(Number),
        triaged: expect.any(Number),
      }),
    });
    expect(body.observability.operatorEvidence).toEqual(body.operatorEvidence);
    expect(body.persistence.d1.skippedReason).toBe("missing-binding");
  });
});
