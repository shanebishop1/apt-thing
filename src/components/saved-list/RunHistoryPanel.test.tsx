import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { briefingRunHistoryFixture } from "@/lib/agent-contract-fixtures";
import { RunHistoryPanel } from "./RunHistoryPanel";
import { describeRequestError } from "./saved-list-state";

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

  it("shows load errors in plain language with a retry action", async () => {
    const onRefresh = vi.fn();
    render(
      <RunHistoryPanel
        state={{
          status: "error",
          error: describeRequestError(
            new Error("d1-binding-missing"),
            "Could not load this group's run history.",
          ),
        }}
        onRefresh={onRefresh}
      />,
    );

    const alertText = screen.getByRole("alert").textContent ?? "";
    expect(alertText).toContain("The shared database is not set up on the server yet.");
    expect(alertText).not.toContain("d1-binding-missing");
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
                ...briefingRunHistoryFixture.latestRun,
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
