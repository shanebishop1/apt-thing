import { describe, expect, it } from "vitest";
import { createBriefingRunHistoryFixture } from "../test-support/agent-contract-fixtures";
import { validateBriefingRunHistoryContract } from "./agent-contracts";

describe("briefing run-history contract", () => {
  it("validates a run history assembled from extraction, triage, and feedback fixtures", () => {
    const history = createBriefingRunHistoryFixture();
    const errors = validateBriefingRunHistoryContract(history);

    expect(errors).toEqual([]);
    expect(history.contract).toBe("briefing-run-history-v1");
    expect(history.latestRun).toMatchObject({
      cadence: "daily",
      status: "partial",
      counts: expect.objectContaining({
        candidatesFound: 4,
        candidatesSkippedSeen: 1,
        candidatesTriaged: 3,
        sourceFailures: 1,
      }),
    });
    expect(history.latestRun.candidateSummaries.map((candidate) => candidate.bucket)).toEqual(
      expect.arrayContaining(["confirmed-match", "review-needed", "rejected"]),
    );
    expect(history.latestRun.sourceCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "streeteasy", status: "success" }),
        expect.objectContaining({
          source: "fixture-secondary-source",
          status: "failed",
          failureCode: "fixture-source-unavailable",
        }),
      ]),
    );
    expect(history.latestRun.providerMetadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "google-direct",
          model: "gemini-3.5-flash",
          purpose: "briefing",
          schemaValidation: "passed",
        }),
      ]),
    );
    expect(history.latestRun.rawArtifactPointers).toEqual(
      expect.arrayContaining([expect.objectContaining({ owner: "d1", groupScoped: true })]),
    );
    expect(history.seenRejectedMemory).toEqual(
      expect.arrayContaining([expect.objectContaining({ memoryState: "rejected" })]),
    );
    expect(history.feedbackSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          listingId: history.latestRun.candidateSummaries[0]!.listingId,
          doesNotMutateRanking: true,
        }),
      ]),
    );
    expect(history.latestBriefing.suggestedActions.length).toBeGreaterThan(0);
  });

  it("keeps evidence pointers group-scoped in D1 metadata", () => {
    const history = createBriefingRunHistoryFixture();

    expect(history.latestRun.rawArtifactPointers.length).toBeGreaterThan(0);
    expect(
      history.latestRun.rawArtifactPointers
        .filter((pointer) => pointer.owner === "d1")
        .every((pointer) => pointer.groupScoped === true),
    ).toBe(true);
  });

  it("reports briefing summaries that reference unknown candidates or source coverage", () => {
    const history = createBriefingRunHistoryFixture();
    history.latestBriefing.bestNewListingIds = ["hallucinated-listing-id"];
    history.latestBriefing.sourceCoverage = [
      { ...history.latestBriefing.sourceCoverage[0]!, source: "made-up-source" },
    ];

    expect(validateBriefingRunHistoryContract(history)).toEqual(
      expect.arrayContaining([
        "history.latestBriefing.bestNewListingIds.0 must reference candidateSummaries",
        "history.latestBriefing.sourceCoverage.0 must match latestRun source coverage",
      ]),
    );
  });
});
