import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as runsGET } from "../../app/api/group/runs/route";
import { createSqliteD1, type SqliteD1 } from "../test-support/sqlite-d1";
import { runDailySourceAgentLoop } from "./daily-source-loop";
import { createInviteIdentity, defaultSearchGroup } from "./listings";
import { readPersistedRunHistory, type PersistedRunHistory } from "./run-history-store";

const mockState = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: mockState.env }),
}));

const identity = createInviteIdentity(defaultSearchGroup.inviteCode, "Run History Test")!;
let db: SqliteD1;

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "");
  db = createSqliteD1();
  mockState.env = { DB: db };
});

afterEach(() => {
  vi.unstubAllEnvs();
  db.close();
});

describe("readPersistedRunHistory", () => {
  it("returns an empty history when no operational run was persisted", async () => {
    const history = await readPersistedRunHistory(db, defaultSearchGroup.id);

    expect(history).toMatchObject({ groupId: defaultSearchGroup.id, runs: [] });
  });

  it("assembles runs from the persisted daily-loop tables, newest first", async () => {
    const first = await runDailySourceAgentLoop({
      identity,
      env: { DB: db },
      cadence: "manual",
      trigger: "manual",
      now: "2026-09-10T12:00:00.000Z",
    });
    const second = await runDailySourceAgentLoop({
      identity,
      env: { DB: db },
      cadence: "daily",
      trigger: "cron",
      now: "2026-09-11T12:00:00.000Z",
      failSecondary: true,
    });
    expect(first.persistence.outcome.d1.error).toBeUndefined();
    expect(second.persistence.outcome.d1.error).toBeUndefined();

    const history = await readPersistedRunHistory(db, defaultSearchGroup.id);
    const [latest, older] = history.runs;

    expect(history.runs.map((run) => run.runId)).toEqual([second.run.id, first.run.id]);
    expect(latest).toMatchObject({
      cadence: "daily",
      trigger: "cron",
      mode: "fixture",
      status: second.run.status,
      startedAt: second.run.startedAt,
      completedAt: second.run.completedAt,
      briefingSummary: second.briefing.summary,
    });
    expect(latest!.sourceCoverage.map((coverage) => [coverage.source, coverage.status])).toEqual(
      second.sourceCoverage.map((coverage) => [coverage.source, coverage.status]),
    );
    expect(latest!.counts.sourceFailures).toBe(1);
    expect(latest!.sourceCoverage.find((coverage) => coverage.status === "failed")).toMatchObject({
      failureCode: expect.any(String),
    });
    expect(older!.counts.candidatesFound).toBe(first.run.counts.candidatesFound);
    expect(
      older!.counts.confirmedMatches + older!.counts.reviewNeeded + older!.counts.rejected,
    ).toBe(first.listings.filter((listing) => listing.triageBucket !== "untriaged").length);
    expect(older!.candidateSummaries.map((candidate) => candidate.listingId).sort()).toEqual(
      first.history.latestRun.candidateSummaries.map((candidate) => candidate.listingId).sort(),
    );
    expect(older!.providerMetadata).toEqual(first.history.latestRun.providerMetadata);
    expect(older!.memoryUpdates).toBeGreaterThanOrEqual(0);
  });

  it("shows in-flight runs without inventing briefing data and scopes rows by group", async () => {
    db.sqlite.exec(`
      INSERT INTO search_groups (id, invite_code, name, created_at, updated_at)
      VALUES ('other-group', 'server-configured:other-group', 'Other', '2026-01-01', '2026-01-01');
      INSERT INTO daily_loop_runs (id, group_id, cadence, trigger, status, mode, bounded_concurrency, retry_policy_json, counts_json, observability_json, started_at, completed_at)
      VALUES
        ('running-run', '${defaultSearchGroup.id}', 'daily', 'cron', 'running', 'live-safe', 2, '{}', '{}', '{}', '2026-09-12T00:00:00.000Z', NULL),
        ('other-run', 'other-group', 'daily', 'cron', 'success', 'live-safe', 2, '{}', '{}', '{}', '2026-09-13T00:00:00.000Z', NULL);
    `);

    const history = await readPersistedRunHistory(db, defaultSearchGroup.id);

    expect(history.runs).toHaveLength(1);
    expect(history.runs[0]).toMatchObject({
      runId: "running-run",
      status: "running",
      mode: "live-safe",
      completedAt: undefined,
      candidateSummaries: [],
      providerMetadata: [],
      sourceCoverage: [],
      briefingSummary: undefined,
    });
  });
});

describe("GET /api/group/runs", () => {
  it("rejects unauthenticated requests before reading D1", async () => {
    const prepare = vi.spyOn(db, "prepare");
    const response = await runsGET(new NextRequest("http://localhost/api/group/runs"));

    expect([401, 403]).toContain(response.status);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("returns persisted history for the authenticated group", async () => {
    const run = await runDailySourceAgentLoop({ identity, env: { DB: db } });
    const response = await runsGET(
      new NextRequest("http://localhost/api/group/runs", {
        headers: { "X-Invite-Code": defaultSearchGroup.inviteCode },
      }),
    );
    const body = (await response.json()) as { ok: boolean; history: PersistedRunHistory };

    expect(response.status).toBe(200);
    expect(body.history.runs.map((item) => item.runId)).toEqual([run.run.id]);
  });
});
