import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runDailySourceAgentLoop } from "./lib/daily-source-loop";
import { DailyLoopRunConflict } from "./lib/daily-loop/run-lifecycle";
import { AiRunsDisabled } from "./lib/ai-runs";
import {
  createDailyLoopWorkerHandler,
  type DailyLoopScheduledEnv,
  type DailyLoopWorkflowPayload,
} from "./lib/daily-source-worker";

// OpenNext generates this module during `pnpm cf:build`; Wrangler bundles this wrapper
// for deploy/dry-run so the app fetch route remains delegated while Cron can call the
// actual daily source loop entrypoint.
// @ts-expect-error generated Worker output is intentionally outside TypeScript sources.
import openNextWorker from "../.open-next/worker.js";

export class DailySourceAgentLoopWorkflow extends WorkflowEntrypoint<
  DailyLoopScheduledEnv,
  DailyLoopWorkflowPayload
> {
  override async run(event: Readonly<WorkflowEvent<DailyLoopWorkflowPayload>>, step: WorkflowStep) {
    return step.do("run daily source agent loop", async () => {
      let result;
      try {
        result = await runDailySourceAgentLoop({
          mode: event.payload.mode ?? "live-safe",
          cadence: event.payload.cadence ?? "daily",
          trigger: event.payload.trigger ?? (event.schedule ? "cron" : "fixture"),
          env: this.env,
          now: workflowEventTimestamp(event),
        });
      } catch (error) {
        if (error instanceof AiRunsDisabled) {
          return { ok: true, disabled: true, reason: error.message };
        }
        if (
          error instanceof DailyLoopRunConflict &&
          error.message === "daily-loop-already-completed"
        ) {
          return { ok: true, runId: error.runId, status: error.status, replayed: true };
        }
        throw error;
      }
      if (!result.ok) {
        throw new Error(
          result.persistence.outcome.d1.error
            ? "daily-loop-persistence-failed"
            : "daily-loop-source-failed",
        );
      }
      return {
        ok: result.ok,
        runId: result.run.id,
        status: result.run.status,
        sourceFailures: result.observability.sourceFailures,
        rowsWritten: result.persistence.outcome.d1.rowsWritten,
        objectsWritten: result.persistence.outcome.r2.objectsWritten,
      };
    });
  }
}

export default createDailyLoopWorkerHandler(openNextWorker);

function workflowEventTimestamp(event: Readonly<WorkflowEvent<DailyLoopWorkflowPayload>>) {
  if (event.schedule?.scheduledTime) return new Date(event.schedule.scheduledTime).toISOString();
  if (event.payload.scheduledTime) return new Date(event.payload.scheduledTime).toISOString();
  return event.timestamp.toISOString();
}
