import { describe, expect, it } from "vitest";
import { briefingRunHistoryFixture } from "@/test-support/agent-contract-fixtures";
import type { PersistedRunHistoryRun } from "@/lib/run-history-store";
import { withDefined } from "@/lib/utils/records";
import { createRunHistoryPanelModel } from "./run-history-model";

const baseRun: PersistedRunHistoryRun = {
  ...briefingRunHistoryFixture.latestRun,
  mode: "live-safe",
  skipped: { seen: 1, saved: 1, rejected: 0, triaged: 2 },
  materialChanges: 1,
  memoryUpdates: 3,
  briefingSummary: "Two listings need review.",
};

describe("createRunHistoryPanelModel", () => {
  it("orders persisted runs newest-first and derives counts without hiding coverage", () => {
    const realCoverage = baseRun.sourceCoverage[0]!;
    // withDefined drops completedAt entirely, as a still-running persisted run does.
    const olderRun = withDefined<PersistedRunHistoryRun>({
      ...baseRun,
      runId: "older-run",
      mode: "fixture",
      startedAt: "2026-06-06T10:00:00.000Z",
      completedAt: undefined,
      counts: { ...baseRun.counts, candidatesFound: 3, sourceFailures: 99 },
      sourceCoverage: [
        { ...realCoverage, checkedCount: 4, candidateCount: 3 },
        { ...realCoverage, source: "zillow", status: "failed", checkedCount: 0 },
      ],
    });

    const model = createRunHistoryPanelModel({
      groupId: briefingRunHistoryFixture.groupId,
      generatedAt: "2026-09-16T00:00:00.000Z",
      runs: [olderRun, baseRun],
    });
    const [latest, older] = model.runs;

    expect(model.runs.map((run) => run.runId)).toEqual([baseRun.runId, "older-run"]);
    expect(latest).toMatchObject({
      isLatest: true,
      modeLabel: "Live-safe mode",
      aiAttemptsLabel: "AI attempt(s) recorded",
      skippedCount: 4,
      briefingSummary: "Two listings need review.",
    });
    expect(older).toMatchObject({
      isLatest: false,
      modeLabel: "Fixture mode",
      aiAttemptsLabel: "simulated AI attempt(s), fixture mode",
      checkedOrScrapedCount: 4,
      apiMatchedCount: 3,
      completedLabel: "Still running",
    });
    expect(older?.counts.sourceFailures).toBe(1);
    expect(latest?.aiFailureCount).toBe(0);
    expect(older?.sourceCoverage).toHaveLength(2);
  });

  it("returns no runs for an empty persisted history", () => {
    expect(
      createRunHistoryPanelModel({
        groupId: "g",
        generatedAt: "2026-09-16T00:00:00.000Z",
        runs: [],
      }).runs,
    ).toEqual([]);
  });
});

describe("createRunHistoryPanelModel AI attempt failures", () => {
  it("counts failed provider attempts and says so in the attempts label", () => {
    const failedRun: PersistedRunHistoryRun = {
      ...baseRun,
      runId: "failed-ai-run",
      providerMetadata: [
        { ...baseRun.providerMetadata[0]!, status: "failed", failureCode: "schema-invalid" },
        { ...baseRun.providerMetadata[0]!, status: "failed", failureCode: "gemini-http-429" },
        { ...baseRun.providerMetadata[0]!, status: "success" },
      ],
    };

    const [run] = createRunHistoryPanelModel({
      groupId: "nyc-5br-2026",
      generatedAt: "2026-09-17T00:00:00.000Z",
      runs: [failedRun],
    }).runs;

    expect(run).toMatchObject({
      aiCallCount: 3,
      aiFailureCount: 2,
      aiAttemptsLabel: "AI attempt(s) recorded, 2 failed",
    });
  });
});
