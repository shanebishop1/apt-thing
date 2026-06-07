import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { g3cBriefingRunHistoryFixture } from "../lib/agent-contract-fixtures";
import type { BriefingRunHistoryContract, BriefingRunHistoryRun } from "../lib/agent-contracts";
import { fixtureListings } from "../lib/fixtures";
import { defaultSearchGroup } from "../lib/listings";
import {
  LatestBriefingPanel,
  RunHistoryPanel,
  SavedListApp,
  createLatestBriefingPanelModel,
  createRunHistoryPanelModel,
} from "./SavedListApp";
import { runMobileAcceptanceScenario, type MobileAcceptanceMarker } from "../lib/mobile-acceptance";

const savedListingsStorageKey = `apt-thing:v1:groups:${defaultSearchGroup.id}:saved-listings`;

describe("latest briefing dashboard panel", () => {
  it("derives best matches, review-needed candidates, changed listings, counts, coverage, rationale, concerns, and next actions", () => {
    const model = createLatestBriefingPanelModel(g3cBriefingRunHistoryFixture);

    expect(model.bestMatches.map((candidate) => candidate.title)).toContain(
      "New Chelsea five bed batch candidate",
    );
    expect(model.reviewNeeded.map((candidate) => candidate.title)).toContain(
      "Review-needed Williamsburg batch candidate",
    );
    expect(model.changedListings).toEqual([
      "New Chelsea batch candidate added",
      "Seen StreetEasy result skipped",
    ]);
    expect(model.skippedSeenCount).toBe(1);
    expect(model.skippedTriagedCount).toBe(1);
    expect(model.sourceCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "streeteasy", status: "success", checkedCount: 4 }),
        expect.objectContaining({
          source: "fixture-secondary-source",
          status: "failed",
          failureCode: "fixture-source-unavailable",
        }),
      ]),
    );
    expect(model.recommendationRationale).toContain(
      "Confirmed candidate fits price, bedroom, bathroom, and preferred Manhattan criteria.",
    );
    expect(model.concerns.length).toBeGreaterThan(0);
    expect(model.nextActions).toContain("Ask broker for floorplan");
    expect(model.feedbackSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          listingTitle: "New Chelsea five bed batch candidate",
          sourceUrl: "https://streeteasy.com/building/batch-save/3",
          commentCount: 1,
          reactionCount: 0,
          statusChangeCount: 0,
          disagreementCount: 1,
          summaries: expect.arrayContaining([
            "Looks viable if the bedrooms are legal; ask about floorplan.",
            "One roommate wants the floorplan before agreeing this is a real 5BR.",
          ]),
          doesNotMutateRanking: true,
        }),
        expect.objectContaining({
          listingTitle: "Review-needed Williamsburg batch candidate",
          commentCount: 0,
          reactionCount: 1,
          statusChangeCount: 0,
          disagreementCount: 0,
          doesNotMutateRanking: true,
        }),
        expect.objectContaining({
          listingTitle: "Downgraded four bed over ceiling",
          commentCount: 0,
          reactionCount: 0,
          statusChangeCount: 1,
          disagreementCount: 0,
          doesNotMutateRanking: true,
        }),
      ]),
    );
  });

  it("derives compact seen/rejected memory explainer records without promoting them to current briefing candidates", () => {
    const model = createLatestBriefingPanelModel(g3cBriefingRunHistoryFixture);

    expect(model.memoryRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "rejected",
          reason: "Over budget and not a credible 5BR.",
          duplicateKey: "streeteasy.com/building/rejected-downgraded/5",
          groupScopedDuplicateKey: `${g3cBriefingRunHistoryFixture.groupId}:streeteasy.com/building/rejected-downgraded/5`,
          sourceUrl: "https://streeteasy.com/building/rejected-downgraded/5",
          lastSeenLabel: "2026-06-07",
        }),
      ]),
    );
    expect(
      [...model.bestMatches, ...model.reviewNeeded].map((candidate) => candidate.listingId),
    ).not.toContain("listing-rejected-downgraded-fixture");
  });

  it("renders as a secondary panel without replacing listing card markup", () => {
    const markup = renderToStaticMarkup(
      React.createElement(LatestBriefingPanel, { history: g3cBriefingRunHistoryFixture }),
    );

    expect(markup).toContain('aria-label="Latest agent briefing"');
    expect(markup).toContain("New Chelsea five bed batch candidate");
    expect(markup).toContain("Review-needed Williamsburg batch candidate");
    expect(markup).toContain("Changed listings");
    expect(markup).toContain("Skipped / seen memory");
    expect(markup).toContain("Over budget and not a credible 5BR.");
    expect(markup).toContain("Group key");
    expect(markup).toContain("https://streeteasy.com/building/rejected-downgraded/5");
    expect(markup).toContain("Source coverage");
    expect(markup).toContain("Recommendation rationale");
    expect(markup).toContain("Concerns");
    expect(markup).toContain("Next actions");
  });

  it("renders fixture feedback summaries with attribution and no ranking mutation notice", () => {
    const markup = renderToStaticMarkup(
      React.createElement(LatestBriefingPanel, { history: g3cBriefingRunHistoryFixture }),
    );

    expect(markup).toContain("Feedback / disagreement summary");
    expect(markup).toContain("1 comments");
    expect(markup).toContain("0 reactions");
    expect(markup).toContain("1 reactions");
    expect(markup).toContain("0 statuses");
    expect(markup).toContain("1 statuses");
    expect(markup).toContain("1 disagreements");
    expect(markup).toContain("Listing: New Chelsea five bed batch candidate");
    expect(markup).toContain(`Group: ${g3cBriefingRunHistoryFixture.groupId}`);
    expect(markup).toContain("Source: streeteasy");
    expect(markup).toContain("Looks viable if the bedrooms are legal; ask about floorplan.");
    expect(markup).toContain("Briefing-only: does not change ranking or search behavior.");
  });
});

describe("run history panel", () => {
  it("derives compact list/detail rows for manual, daily, and future hourly-compatible runs", () => {
    const history = createHistoryWithCadenceVariants();
    const model = createRunHistoryPanelModel(history);

    expect(model.supportedCadences).toEqual(["manual", "daily", "hourly"]);
    expect(model.runs.map((run) => run.cadence)).toEqual(["hourly", "daily", "manual"]);
    expect(model.runs.map((run) => run.statusLabel)).toEqual(["running", "partial", "success"]);
    expect(model.runs[1]?.sourceCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "streeteasy", status: "success", checkedCount: 4 }),
        expect.objectContaining({
          source: "fixture-secondary-source",
          status: "failed",
          failureCode: "fixture-source-unavailable",
        }),
      ]),
    );
    expect(model.runs[1]?.providerMetadata).toContain("google-direct / gemini-3.5-flash");
    expect(model.runs[1]?.artifactLinks.some((link) => link.ownerLabel === "R2")).toBe(true);
  });

  it("renders timestamps, statuses, source failures, provider/model metadata, counts, and artifact links", () => {
    const history = createHistoryWithCadenceVariants();
    const markup = renderToStaticMarkup(React.createElement(RunHistoryPanel, { history }));

    expect(markup).toContain('aria-label="Agent run history"');
    expect(markup).toContain("Supported cadences: manual, daily, hourly");
    expect(markup).toContain("Manual import catch-up");
    expect(markup).toContain("Daily scheduled search");
    expect(markup).toContain("Hourly-ready smoke run");
    expect(markup).toContain("Candidates found");
    expect(markup).toContain("Candidates triaged");
    expect(markup).toContain("Source coverage");
    expect(markup).toContain("fixture-source-unavailable");
    expect(markup).toContain("Provider/model metadata");
    expect(markup).toContain("google-direct / gemini-3.5-flash");
    expect(markup).toContain("Evidence artifacts");
    expect(markup).toContain("R2 artifact");
  });
});

describe("briefing/history verification guardrails", () => {
  it("keeps briefing and history mobile-first without desktop table markup", () => {
    const markup = renderBriefingHistoryMarkup();
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(markup).toContain('class="briefing-layout"');
    expect(markup).toContain('class="run-history-list"');
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain('role="table"');
    expect(css).toMatch(
      /@media \(max-width: 860px\)[\s\S]*\.briefing-layout,[\s\S]*\.run-history-header,[\s\S]*grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 560px\)[\s\S]*\.briefing-count-grid,[\s\S]*\.run-history-facts,[\s\S]*grid-template-columns: 1fr;/,
    );
    expect(css).not.toMatch(/display:\s*table|table-layout:/);
  });

  it("does not expose a push-notification dependency in briefing/history surfaces", () => {
    const markup = renderBriefingHistoryMarkup();
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");

    expect(markup).not.toMatch(/push notification|email|slack|sms/i);
    expect(componentSource).not.toMatch(
      /\b(Notification|PushManager|pushManager|serviceWorker|showNotification)\b/,
    );
  });
});

describe("T-1.6 mobile-first and accessibility acceptance guardrails", () => {
  it("covers every mobile acceptance marker required by the hardening story", () => {
    const acceptance = runMobileAcceptanceScenario();
    const expectedMarkers: MobileAcceptanceMarker[] = [
      "saved-list-review",
      "paste-input-target",
      "batch-status-panel",
      "map-list-detail",
      "comments-reactions-status",
      "review-status-controls",
      "edit-field-controls",
      "detail-expansion",
      "source-link-opening",
      "briefing-history",
      "focus-states",
      "safe-area-insets",
      "touch-targets",
      "keyboard-behavior",
      "mobile-viewport",
    ];

    expect(acceptance.allChecksPassed).toBe(true);
    expect(acceptance.platform).toBe("ios-safari-equivalent");
    expect(acceptance.viewportFit).toBe("cover");
    expect(acceptance.coveredAcceptanceMarkers).toEqual(expect.arrayContaining(expectedMarkers));
  });

  it("renders mobile-safe labels, live feedback, keyboard hints, and stateful controls", () => {
    const markup = renderToStaticMarkup(React.createElement(SavedListApp));

    expect(markup).toContain('class="dashboard-shell"');
    expect(markup).toContain('aria-label="Saved listing review queue"');
    expect(markup).toContain('aria-label="Map enhanced review"');
    expect(markup).toContain('aria-label="Listing detail panel"');
    expect(markup).toContain('aria-label="Group comments, reactions, and feedback"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('inputMode="url"');
    expect(markup).toContain('enterKeyHint="go"');
    expect(markup).toContain('enterKeyHint="done"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-label="Set review status to');
    expect(markup).toContain('aria-label="React thumbs up to');
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain('role="table"');
  });

  it("locks safe-area, focus-visible, touch-target, map, and viewport CSS for iPhone Safari checks", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const layoutSource = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");

    expect(layoutSource).toContain('viewportFit: "cover"');
    expect(layoutSource).toContain('width: "device-width"');
    expect(css).toMatch(/summary:focus-visible \{[\s\S]*outline:/);
    expect(css).toMatch(/textarea:focus-visible,[\s\S]*summary:focus-visible \{/);
    expect(css).toMatch(
      /\.map-heading,[\s\S]*\.map-review-grid \{[\s\S]*grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(/padding-right: max\(10px, env\(safe-area-inset-right\)\)/);
    expect(css).toMatch(/padding-left: max\(10px, env\(safe-area-inset-left\)\)/);
    expect(css).toMatch(
      /\.memory-source-link,[\s\S]*\.feedback-attribution a,[\s\S]*textarea \{[\s\S]*min-height: 52px;/,
    );
    expect(css).not.toMatch(/hover:[\s\S]*display|display:\s*table|table-layout:/);
  });
});

describe("saved-list persisted data compatibility", () => {
  it("renders older localStorage listings that do not have provider routing metadata", () => {
    const staleListing = { ...fixtureListings[0] } as Record<string, unknown>;
    delete staleListing.providerRouting;
    const storage = new Map<string, string>([
      [
        savedListingsStorageKey,
        JSON.stringify({
          version: "v1",
          groupId: defaultSearchGroup.id,
          listings: [staleListing],
          updatedAt: "2026-06-07T00:00:00.000Z",
        }),
      ],
    ]);
    const originalLocalStorage = globalThis.localStorage;

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });

    try {
      expect(() => renderToStaticMarkup(React.createElement(SavedListApp))).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalLocalStorage,
      });
    }
  });
});

function renderBriefingHistoryMarkup(): string {
  return renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(LatestBriefingPanel, { history: g3cBriefingRunHistoryFixture }),
      React.createElement(RunHistoryPanel, { history: createHistoryWithCadenceVariants() }),
    ),
  );
}

function createHistoryWithCadenceVariants(): BriefingRunHistoryContract {
  const latest = g3cBriefingRunHistoryFixture.latestRun;
  const manual = createRunVariant(latest, {
    runId: "agent-run-log-manual-fixture",
    cadence: "manual",
    trigger: "manual",
    status: "success",
    startedAt: "2026-06-06T14:00:00.000Z",
    completedAt: "2026-06-06T14:02:00.000Z",
    label: "manual",
    candidateCount: 1,
    sourceFailures: 0,
  });
  const hourly = createRunVariant(latest, {
    runId: "agent-run-log-hourly-fixture",
    cadence: "hourly",
    trigger: "fixture",
    status: "running",
    startedAt: "2026-06-07T13:00:00.000Z",
    completedAt: undefined,
    label: "hourly",
    candidateCount: 0,
    sourceFailures: 0,
  });

  return {
    ...g3cBriefingRunHistoryFixture,
    supportedCadences: ["manual", "daily", "hourly"],
    latestRun: latest,
    runs: [manual, latest, hourly],
  };
}

function createRunVariant(
  base: BriefingRunHistoryRun,
  options: {
    runId: string;
    cadence: BriefingRunHistoryRun["cadence"];
    trigger: BriefingRunHistoryRun["trigger"];
    status: BriefingRunHistoryRun["status"];
    startedAt: string;
    completedAt?: string;
    label: string;
    candidateCount: number;
    sourceFailures: number;
  },
): BriefingRunHistoryRun {
  const candidateSummaries = base.candidateSummaries.slice(0, options.candidateCount);
  const sourceCoverage =
    options.sourceFailures > 0
      ? base.sourceCoverage
      : [
          {
            ...base.sourceCoverage[0]!,
            checkedCount: Math.max(1, options.candidateCount),
            candidateCount: options.candidateCount,
            rawArtifactPointers: base.rawArtifactPointers.slice(0, 1),
          },
        ];

  return {
    ...base,
    runId: options.runId,
    cadence: options.cadence,
    trigger: options.trigger,
    status: options.status,
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    counts: {
      candidatesFound: options.candidateCount,
      candidatesSkippedSeen: 0,
      candidatesSkippedTriaged: 0,
      candidatesTriaged: candidateSummaries.length,
      confirmedMatches: candidateSummaries.filter(
        (candidate) => candidate.bucket === "confirmed-match",
      ).length,
      reviewNeeded: candidateSummaries.filter((candidate) => candidate.bucket === "review-needed")
        .length,
      rejected: candidateSummaries.filter((candidate) => candidate.bucket === "rejected").length,
      sourceFailures: options.sourceFailures,
    },
    candidateSummaries,
    sourceCoverage,
    providerMetadata: base.providerMetadata.map((metadata) => ({
      ...metadata,
      attemptId: `${metadata.attemptId}-${options.label}`,
      status: options.status === "running" ? "pending" : metadata.status,
      startedAt: options.startedAt,
      completedAt: options.completedAt,
    })),
    rawArtifactPointers: base.rawArtifactPointers.slice(0, options.candidateCount > 0 ? 1 : 0),
  };
}
