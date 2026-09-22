import { describe, expect, it } from "vitest";
import { createSqliteD1 } from "../../test-support/sqlite-d1";
import { runDailySourceAgentLoop } from "../daily-source-loop";
import { streetEasyBatchFixture } from "../fixtures";
import { createGroupIdentity, defaultSearchGroup } from "../listings";

const identity = createGroupIdentity(defaultSearchGroup.id, "Recovery test")!;
const batch = { ...streetEasyBatchFixture, results: [streetEasyBatchFixture.results[2]!] };

describe("atomic daily-loop persistence", () => {
  it("reconciles abandoned runs and records unexpected history-read failures", async () => {
    const db = createSqliteD1();
    try {
      const options = {
        identity,
        env: { DB: db },
        streeteasyBatch: batch,
        failSecondary: true,
        now: "2026-09-19T12:00:00Z",
      };
      const first = await runDailySourceAgentLoop(options);
      db.sqlite
        .prepare("UPDATE daily_loop_runs SET status = 'running', completed_at = NULL WHERE id = ?")
        .run(first.run.id);
      // Simulates a interrupted old version; fresh work reconciles the old transition.
      await runDailySourceAgentLoop({ ...options, now: "2026-09-19T16:00:00Z" });
      expect(
        db.sqlite.prepare("SELECT status FROM daily_loop_runs WHERE id = ?").get(first.run.id)
          ?.status,
      ).toBe("failed");
      db.sqlite.exec("ALTER TABLE app_seen_rejected_memory RENAME TO unavailable_memory");
      await expect(
        runDailySourceAgentLoop({ ...options, now: "2026-09-19T17:00:00Z" }),
      ).rejects.toThrow();
      expect(
        db.sqlite
          .prepare("SELECT status FROM daily_loop_runs ORDER BY started_at DESC LIMIT 1")
          .get()?.status,
      ).toBe("failed");
    } finally {
      db.close();
    }
  });
  it("rolls back all artifacts, records failure, and permits retry of a failed run", async () => {
    const db = createSqliteD1();
    try {
      db.sqlite.exec(
        "CREATE TRIGGER reject_briefing BEFORE INSERT ON daily_loop_briefings BEGIN SELECT RAISE(FAIL, 'injected-final-write-failure'); END",
      );
      const options = {
        identity,
        env: { DB: db },
        streeteasyBatch: batch,
        failSecondary: true,
        now: "2026-09-19T16:00:00.000Z",
      };
      const result = await runDailySourceAgentLoop(options);
      expect(result.ok).toBe(false);
      expect(result.run.status).toBe("failed");
      expect(result.persistence.outcome.d1).toMatchObject({
        rowsWritten: 0,
        error: expect.stringContaining("injected-final-write-failure"),
      });
      expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM app_saved_listings").get()?.n).toBe(0);
      expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM daily_loop_candidates").get()?.n).toBe(0);
      expect(db.sqlite.prepare("SELECT status FROM daily_loop_runs").get()?.status).toBe("failed");
      db.sqlite.exec("DROP TRIGGER reject_briefing");
      const retry = await runDailySourceAgentLoop(options);
      expect(retry.persistence.outcome.d1.error).toBeUndefined();
      expect(retry.run.counts.candidatesSaved).toBe(1);
      expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM app_saved_listings").get()?.n).toBe(1);
    } finally {
      db.close();
    }
  });

  it("counts real inserts, not refreshed candidates or no-op conflicts", async () => {
    const db = createSqliteD1();
    try {
      const first = await runDailySourceAgentLoop({
        identity,
        env: { DB: db },
        streeteasyBatch: batch,
        failSecondary: true,
        now: "2026-09-19T16:00:00Z",
      });
      const changed = structuredClone(batch);
      changed.results[0]!.details.rent = 12501;
      const second = await runDailySourceAgentLoop({
        identity,
        env: { DB: db },
        streeteasyBatch: changed,
        failSecondary: true,
        now: "2026-09-19T17:00:00Z",
      });
      expect(first.run.counts.candidatesSaved).toBe(1);
      expect(second.listings).toHaveLength(1);
      expect(second.run.counts.candidatesSaved).toBe(0);
      const row = db.sqlite
        .prepare("SELECT counts_json FROM daily_loop_runs WHERE id = ?")
        .get(second.run.id)!;
      expect(JSON.parse(String(row.counts_json)).candidatesSaved).toBe(0);
      expect(second.operatorEvidence.candidateCounts.saved).toBe(0);
    } finally {
      db.close();
    }
  });

  it("does not erase committed history when a completed run is delivered twice", async () => {
    const db = createSqliteD1();
    try {
      const options = {
        identity,
        env: { DB: db },
        streeteasyBatch: batch,
        failSecondary: true,
        now: "2026-09-19T16:00:00Z",
      };
      const first = await runDailySourceAgentLoop(options);
      const before = db.sqlite
        .prepare("SELECT history_contract_json FROM daily_loop_briefings")
        .get();
      await expect(runDailySourceAgentLoop(options)).rejects.toThrow(
        "daily-loop-already-completed",
      );
      expect(
        db.sqlite.prepare("SELECT history_contract_json FROM daily_loop_briefings").get(),
      ).toEqual(before);
      expect(
        db.sqlite.prepare("SELECT status FROM daily_loop_runs WHERE id = ?").get(first.run.id)
          ?.status,
      ).toBe(first.run.status);
    } finally {
      db.close();
    }
  });

  it("rejects a new run while another run for the group is still active", async () => {
    const db = createSqliteD1();
    try {
      const first = await runDailySourceAgentLoop({
        identity,
        env: { DB: db },
        streeteasyBatch: batch,
        failSecondary: true,
        now: "2026-09-19T16:00:00Z",
      });
      db.sqlite
        .prepare("UPDATE daily_loop_runs SET status = 'running', completed_at = NULL WHERE id = ?")
        .run(first.run.id);

      await expect(
        runDailySourceAgentLoop({
          identity,
          env: { DB: db },
          streeteasyBatch: batch,
          failSecondary: true,
          now: "2026-09-19T17:00:00Z",
        }),
      ).rejects.toMatchObject({
        message: "daily-loop-already-running",
        runId: first.run.id,
      });
    } finally {
      db.close();
    }
  });

  it("allows only one simultaneous run to claim the group's active lease", async () => {
    const db = createSqliteD1();
    try {
      const results = await Promise.allSettled([
        runDailySourceAgentLoop({
          identity,
          env: { DB: db },
          streeteasyBatch: batch,
          failSecondary: true,
          now: "2026-09-19T18:00:00.000Z",
        }),
        runDailySourceAgentLoop({
          identity,
          env: { DB: db },
          streeteasyBatch: batch,
          failSecondary: true,
          now: "2026-09-19T18:00:00.001Z",
        }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({
        reason: { message: "daily-loop-already-running" },
      });
    } finally {
      db.close();
    }
  });
});
