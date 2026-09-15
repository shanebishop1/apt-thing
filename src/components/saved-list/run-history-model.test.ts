import { describe, expect, it } from "vitest";
import { g3cBriefingRunHistoryFixture } from "../../lib/agent-contract-fixtures";
import { createRunHistoryPanelModel } from "./run-history-model";

describe("createRunHistoryPanelModel", () => {
  it("orders runs newest-first, filters fixture coverage, and derives counts", () => {
    const baseRun = g3cBriefingRunHistoryFixture.latestRun;
    const realCoverage = baseRun.sourceCoverage[0]!;
    const olderRun = {
      ...baseRun,
      runId: "older-run",
      startedAt: "2026-06-06T10:00:00.000Z",
      completedAt: "2026-06-06T10:02:00.000Z",
      counts: {
        ...baseRun.counts,
        candidatesFound: 3,
        candidatesSkippedSeen: 2,
        candidatesSkippedTriaged: 1,
        sourceFailures: 99,
      },
      sourceCoverage: [
        { ...realCoverage, checkedCount: 4, candidateCount: 3 },
        { ...realCoverage, source: "fixture-secondary-source", checkedCount: 50 },
      ],
    };
    const history = {
      ...g3cBriefingRunHistoryFixture,
      latestRun: baseRun,
      runs: [olderRun, baseRun],
    };

    const model = createRunHistoryPanelModel(history);
    const [latest, older] = model.runs;

    expect(model.runs.map((run) => run.runId)).toEqual([baseRun.runId, "older-run"]);
    expect(latest?.isLatest).toBe(true);
    expect(older?.checkedOrScrapedCount).toBe(4);
    expect(older?.skippedCount).toBe(3);
    expect(older?.apiMatchedCount).toBe(3);
    expect(older?.counts.sourceFailures).toBe(0);
    expect(older?.sourceCoverage.some((coverage) => coverage.source.startsWith("fixture-"))).toBe(
      false,
    );
  });
});
