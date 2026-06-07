import { describe, expect, it } from "vitest";
import { simulateScheduledWorkflowFanout } from "./workflow-queue";

describe("scheduled workflow and queue-compatible fanout proof", () => {
  it("starts a durable scheduled run, bounds concurrency, records transitions, and isolates one failing unit", async () => {
    const result = await simulateScheduledWorkflowFanout({
      scheduledAt: "2026-06-07T12:00:00.000Z",
      boundedConcurrency: 2,
      maxRetries: 1,
      units: [
        {
          id: "unit-a",
          source: "streeteasy",
          sourceUrl: "https://streeteasy.com/a",
          processingDelayMs: 4,
        },
        {
          id: "unit-b",
          source: "streeteasy",
          sourceUrl: "https://streeteasy.com/b",
          processingDelayMs: 4,
        },
        {
          id: "unit-seen",
          source: "streeteasy",
          sourceUrl: "https://streeteasy.com/seen",
          skipSeen: true,
        },
        {
          id: "unit-fail",
          source: "other",
          sourceUrl: "https://source.invalid/fail",
          shouldFail: true,
        },
      ],
    });

    expect(result.contract).toBe("scheduled-workflow-fanout-v1");
    expect(result.queueCompatible).toBe(true);
    expect(result.simulatedQueueBinding).toBe("AGENT_FANOUT_QUEUE");
    expect(result.maxObservedInFlight).toBeLessThanOrEqual(2);
    expect(result.transitions.map((transition) => transition.status)).toEqual([
      "queued",
      "running",
      "partial",
    ]);
    expect(result.runLog).toMatchObject({
      status: "partial",
      boundedConcurrency: 2,
      retryPolicy: { maxRetries: 1, retryDelayMs: 250 },
      counts: {
        candidatesFound: 4,
        candidatesSkippedSeen: 1,
        candidatesAnalyzed: 3,
        candidatesSaved: 2,
        sourceFailures: 1,
      },
    });
    expect(result.runLog.units.find((unit) => unit.id === "unit-fail")).toMatchObject({
      status: "failed",
      attempt: 2,
      errorCode: "unit-failed-after-retries",
    });
    expect(result.runLog.units.filter((unit) => unit.status === "success")).toHaveLength(2);
  });
});
