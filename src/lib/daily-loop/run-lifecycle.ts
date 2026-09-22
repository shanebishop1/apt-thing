import type { AgentRunLogRecord } from "../agent-contracts";
import type { DailyLoopD1Binding } from "./types";
import { parseJson } from "../utils/json";

export class DailyLoopRunConflict extends Error {
  constructor(
    readonly runId: string,
    readonly status: string,
    readonly counts: Partial<AgentRunLogRecord["counts"]> = {},
  ) {
    super(
      status === "success" || status === "partial"
        ? "daily-loop-already-completed"
        : "daily-loop-already-running",
    );
  }
}

/** Runs that outlive the bounded workload by two hours are recoverable, never successful. */
export async function reconcileInterruptedRuns(
  db: DailyLoopD1Binding,
  groupId: string,
  now: string,
) {
  await db
    .prepare(
      "UPDATE daily_loop_runs SET status = 'failed', completed_at = ?, observability_json = json_set(observability_json, '$.persistenceError', 'interrupted-run-expired') WHERE group_id = ? AND status IN ('queued', 'running') AND julianday(started_at) < julianday(?)",
    )
    .bind(now, groupId, new Date(Date.parse(now) - 2 * 60 * 60 * 1000).toISOString())
    .run();
}

export async function assertRunCanStart(db: DailyLoopD1Binding, groupId: string, runId: string) {
  const row = await db
    .prepare("SELECT status, counts_json FROM daily_loop_runs WHERE id = ?")
    .bind(runId)
    .first<{ status: string; counts_json: string }>();
  if (row && row.status !== "failed" && row.status !== "cancelled") {
    throw new DailyLoopRunConflict(runId, row.status, parseJson(row.counts_json) ?? {});
  }

  const active = await findActiveRun(db, groupId);
  if (active) {
    throw new DailyLoopRunConflict(active.id, active.status, parseJson(active.counts_json) ?? {});
  }
}

export async function findActiveRun(db: DailyLoopD1Binding, groupId: string) {
  return db
    .prepare(
      "SELECT id, status, counts_json FROM daily_loop_runs WHERE group_id = ? AND status IN ('queued', 'running') ORDER BY started_at ASC LIMIT 1",
    )
    .bind(groupId)
    .first<{ id: string; status: string; counts_json: string }>();
}

/** Best effort: a failed database must not hide the original failure or undo a committed run. */
export async function recordRunFailure(
  db: DailyLoopD1Binding | undefined,
  runId: string,
  error: string,
) {
  if (!db) return;
  try {
    await db
      .prepare(
        "UPDATE daily_loop_runs SET status = 'failed', completed_at = ?, observability_json = json_set(observability_json, '$.persistenceError', ?) WHERE id = ? AND status IN ('queued', 'running')",
      )
      .bind(new Date().toISOString(), error, runId)
      .run();
  } catch {
    /* The caller still receives the original error; reconciliation handles a later recovery. */
  }
}

export function changedRows(result: unknown): number {
  if (!result || typeof result !== "object" || !("meta" in result)) return 0;
  const meta = result.meta;
  return meta && typeof meta === "object" && "changes" in meta ? Number(meta.changes) || 0 : 0;
}
