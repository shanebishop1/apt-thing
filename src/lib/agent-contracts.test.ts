import { describe, expect, it } from "vitest";
import {
  createG3CBriefingRunHistoryFixture,
  createGeminiBriefingDraftFixture,
  createHallucinatedGeminiBriefingDraftFixture,
  g2bAgentContractFixtureBundle,
} from "./agent-contract-fixtures";
import {
  G2B_STABLE_CONTRACTS,
  validateBriefingRunHistoryContract,
  validateGeminiBriefingDraftContract,
  validateSharedAgentContractBundle,
} from "./agent-contracts";

describe("G2B shared agent contracts and fixtures", () => {
  it("names stable downstream contracts for platform, agent, AI, group review, run logs, and briefings", () => {
    expect(Object.keys(G2B_STABLE_CONTRACTS)).toEqual([
      "listing-candidate-v1",
      "source-evidence-v1",
      "confidence-triage-v1",
      "group-access-v1",
      "group-action-v1",
      "seen-rejected-memory-v1",
      "agent-run-log-v1",
      "briefing-record-v1",
      "g3c-briefing-run-history-v1",
      "gemini-briefing-draft-v1",
      "gemini-provider-metadata-v1",
      "cloudflare-binding-proof-v1",
      "scheduled-workflow-fanout-v1",
    ]);
  });

  it("parses and validates fixtures for required story cases", () => {
    const bundle = JSON.parse(
      JSON.stringify(g2bAgentContractFixtureBundle),
    ) as typeof g2bAgentContractFixtureBundle;
    const errors = validateSharedAgentContractBundle(bundle);

    expect(errors).toEqual([]);
    expect(bundle.groupId).toBe("nyc-5br-2026");
    expect(bundle.groupAccess[0]).toMatchObject({
      contract: "group-access-v1",
      groupId: "nyc-5br-2026",
      credentialSource: "server-configured-invite",
      resolvedFrom: "invite-link",
      actorDisplayName: "G2B Fixture",
      identityPersistence: "localStorage",
    });
    expect(bundle.groupAccess[0]!.actorIdentityToken).toMatch(/^actor_nyc-5br-2026_/);
    expect(bundle.listingCandidates.pastedIntake.userQualified).toBe(true);
    expect(bundle.listingCandidates.streetEasyBatchCandidate.providerRoute).toBe(
      "streeteasy-realtyapi-batch-search",
    );
    expect(bundle.listingCandidates.confirmedMatch.triageBucket).toBe("confirmed-match");
    expect(bundle.listingCandidates.reviewNeeded.triageBucket).toBe("review-needed");
    expect(bundle.listingCandidates.rejectedDowngraded.triageBucket).toBe("rejected");
    expect(bundle.groupActions.map((action) => action.actionType)).toEqual([
      "comment",
      "reaction",
      "status-change",
      "source-link-open",
      "feedback",
    ]);
    expect(bundle.groupActions.every((action) => action.actorIdentityToken)).toBe(true);
    expect(bundle.groupActions[0]).toMatchObject({
      actor: { displayName: "Shane" },
      sourceUrl: bundle.listingCandidates.confirmedMatch.url,
      provenance: { source: "user-entered", visibleToGroup: true },
    });
    expect(
      bundle.groupActions.find((action) => action.actionType === "source-link-open"),
    ).toMatchObject({
      sourceUrl: bundle.listingCandidates.confirmedMatch.url,
      provenance: { source: "original-listing-source-link" },
    });
    expect(bundle.groupActions.find((action) => action.actionType === "feedback")).toMatchObject({
      feedback: {
        category: "evidence",
        disagreement: true,
        doesNotMutateRanking: true,
      },
    });
    expect(bundle.seenRejectedMemory[0]).toMatchObject({ memoryState: "rejected" });
    expect(bundle.runLogs[0]).toMatchObject({ status: "partial" });
    expect(bundle.runLogs[0]!.units.some((unit) => unit.status === "skipped-seen")).toBe(true);
    expect(bundle.runLogs[0]!.units.some((unit) => unit.status === "failed")).toBe(true);
    expect(bundle.briefingRecords[0]!.summary).toContain("strong Chelsea candidate");
  });

  it("keeps evidence pointers group-scoped in D1 metadata", () => {
    expect(g2bAgentContractFixtureBundle.sourceEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pointer: expect.objectContaining({ owner: "d1", groupScoped: true }),
        }),
      ]),
    );
    expect(
      g2bAgentContractFixtureBundle.sourceEvidence
        .filter((evidence) => evidence.pointer.owner === "d1")
        .every((evidence) => evidence.pointer.groupScoped === true),
    ).toBe(true);
  });

  it("rejects cross-group group access and listing action leakage", () => {
    const leakedBundle = JSON.parse(
      JSON.stringify(g2bAgentContractFixtureBundle),
    ) as typeof g2bAgentContractFixtureBundle;

    leakedBundle.groupAccess[0]!.groupId = "other-group";
    leakedBundle.groupActions[0]!.groupId = "other-group";
    leakedBundle.groupActions[1]!.listingId = "listing-owned-by-another-group";

    expect(validateSharedAgentContractBundle(leakedBundle)).toEqual(
      expect.arrayContaining([
        "groupAccess.0.groupId must match bundle.groupId",
        "groupActions.0.groupId must match bundle.groupId",
        "groupActions.1.listingId must reference a listing in the same bundle group",
      ]),
    );
  });

  it("builds a G3C briefing/run-history contract from G2A/G2B/G2C fixture outputs", () => {
    const history = createG3CBriefingRunHistoryFixture(g2bAgentContractFixtureBundle);
    const errors = validateBriefingRunHistoryContract(history);

    expect(errors).toEqual([]);
    expect(history.contract).toBe("g3c-briefing-run-history-v1");
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

  it("validates deterministic Gemini briefing drafts and rejects hallucinated listings or sources", () => {
    const history = createG3CBriefingRunHistoryFixture(g2bAgentContractFixtureBundle);
    const validDraft = createGeminiBriefingDraftFixture(history);
    const hallucinatedDraft = createHallucinatedGeminiBriefingDraftFixture(history);
    const unsupportedCountDraft = createGeminiBriefingDraftFixture(history);

    unsupportedCountDraft.sourceCoverageClaims[0]!.checkedCount += 1;

    expect(validateGeminiBriefingDraftContract(validDraft, history)).toEqual([]);
    expect(validateGeminiBriefingDraftContract(hallucinatedDraft, history)).toEqual(
      expect.arrayContaining([
        "geminiDraft.listingReferences.0.listingId must reference a candidate in briefing history",
        "geminiDraft.sourceCoverageClaims.0.source must match checked source coverage",
        "geminiDraft.sourceCoverageClaims.0.failureCode must match the recorded source failure",
      ]),
    );
    expect(validateGeminiBriefingDraftContract(unsupportedCountDraft, history)).toEqual(
      expect.arrayContaining([
        "geminiDraft.sourceCoverageClaims.0.checkedCount must match recorded source coverage count",
      ]),
    );
  });
});
