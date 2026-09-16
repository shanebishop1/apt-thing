// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { g3cBriefingRunHistoryFixture } from "../../lib/agent-contract-fixtures";
import { RunHistoryPanel } from "./RunHistoryPanel";

afterEach(cleanup);

const emptyHistory = { groupId: "nyc-5br-2026", generatedAt: "2026-09-16T00:00:00.000Z", runs: [] };

describe("RunHistoryPanel", () => {
  it("renders an honest empty state when no run is persisted", () => {
    render(
      <RunHistoryPanel state={{ status: "ready", history: emptyHistory }} onRefresh={vi.fn()} />,
    );

    expect(screen.getByText("No runs recorded yet")).toBeTruthy();
    expect(screen.queryByLabelText("Agent runs table")).toBeNull();
  });

  it("shows load errors with a retry action", async () => {
    const onRefresh = vi.fn();
    render(
      <RunHistoryPanel
        state={{ status: "error", error: "d1-binding-missing" }}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("d1-binding-missing");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders persisted run rows with their mode and briefing", () => {
    render(
      <RunHistoryPanel
        state={{
          status: "ready",
          history: {
            ...emptyHistory,
            runs: [
              {
                ...g3cBriefingRunHistoryFixture.latestRun,
                runId: "persisted-run",
                mode: "live-safe",
                skipped: { seen: 0, saved: 0, rejected: 0, triaged: 0 },
                materialChanges: 0,
                memoryUpdates: 0,
                briefingSummary: "Persisted briefing summary.",
              },
            ],
          },
        }}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Agent runs table")).toBeTruthy();
    expect(screen.getByText(/Latest run · Live-safe mode/)).toBeTruthy();
    expect(screen.getByText("Persisted briefing summary.")).toBeTruthy();
  });
});
