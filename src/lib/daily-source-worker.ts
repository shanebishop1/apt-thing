import {
  runDailySourceAgentLoop,
  type DailyLoopEnv,
  type DailyLoopMode,
} from "./daily-source-loop";
import type { Cadence } from "./listings";

export const DAILY_SOURCE_AGENT_LOOP_WORKFLOW_BINDING = "DAILY_SOURCE_AGENT_LOOP_WORKFLOW" as const;
export const DAILY_LOOP_DISABLED_VALUES = new Set(["false", "0", "off"]);

export type DailyLoopWorkflowTrigger = "cron" | "fixture";

export type DailyLoopWorkflowPayload = {
  cadence: Extract<Cadence, "daily" | "hourly">;
  trigger: DailyLoopWorkflowTrigger;
  mode: DailyLoopMode;
  cron?: string;
  scheduledTime?: number;
  fallback?: boolean;
};

type DailyLoopWorkflowBinding = {
  create(options?: {
    id?: string;
    params?: DailyLoopWorkflowPayload;
    retention?: {
      successRetention?: string | number;
      errorRetention?: string | number;
    };
  }): Promise<{ id: string }>;
};

export type DailyLoopScheduledEnv = DailyLoopEnv &
  Partial<Record<"APP_ENV", string>> &
  Partial<Record<typeof DAILY_SOURCE_AGENT_LOOP_WORKFLOW_BINDING, DailyLoopWorkflowBinding>>;

export type DailyLoopScheduledEvent = Pick<ScheduledEvent, "cron" | "scheduledTime">;
export type DailyLoopExecutionContext = Pick<ExecutionContext, "waitUntil">;

export type DailyLoopScheduledDispatch =
  | {
      ok: true;
      disabled: true;
      dispatchedToWorkflow: false;
      fallback: false;
      reason: "daily-loop-disabled";
      envVar: "DAILY_LOOP_ENABLED";
      configuredValue: string;
      payload: DailyLoopWorkflowPayload;
    }
  | {
      disabled?: false;
      dispatchedToWorkflow: true;
      fallback: false;
      workflowBinding: typeof DAILY_SOURCE_AGENT_LOOP_WORKFLOW_BINDING;
      workflowInstanceId: string;
      payload: DailyLoopWorkflowPayload;
    }
  | (Awaited<ReturnType<typeof runDailySourceAgentLoop>> & {
      disabled?: false;
      dispatchedToWorkflow: false;
      fallback: true;
      fallbackReason: "missing-workflow-binding" | "workflow-dispatch-failed";
      scheduleFailure?: {
        code: "workflow-dispatch-failed";
        message: string;
      };
      payload: DailyLoopWorkflowPayload;
    });

type FetchOnlyWorker = {
  fetch?: ExportedHandlerFetchHandler<DailyLoopScheduledEnv>;
};

export function createDailyLoopWorkflowPayload(
  event: DailyLoopScheduledEvent,
): DailyLoopWorkflowPayload {
  return {
    cadence: "daily",
    trigger: "cron",
    mode: "live-safe",
    cron: event.cron,
    scheduledTime: event.scheduledTime,
  };
}

export async function scheduledDailySourceAgentLoop(
  event: DailyLoopScheduledEvent,
  env: DailyLoopScheduledEnv,
): Promise<DailyLoopScheduledDispatch> {
  const payload = createDailyLoopWorkflowPayload(event);
  const disabledValue = getDailyLoopDisabledValue(env.DAILY_LOOP_ENABLED);
  if (disabledValue) {
    return {
      ok: true,
      disabled: true,
      dispatchedToWorkflow: false,
      fallback: false,
      reason: "daily-loop-disabled",
      envVar: "DAILY_LOOP_ENABLED",
      configuredValue: disabledValue,
      payload,
    };
  }

  const workflow = env[DAILY_SOURCE_AGENT_LOOP_WORKFLOW_BINDING];
  if (workflow) {
    try {
      const instance = await workflow.create({
        id: createWorkflowInstanceId(event),
        params: payload,
        retention: { successRetention: "30 days", errorRetention: "90 days" },
      });
      return {
        disabled: false,
        dispatchedToWorkflow: true,
        fallback: false,
        workflowBinding: DAILY_SOURCE_AGENT_LOOP_WORKFLOW_BINDING,
        workflowInstanceId: instance.id,
        payload,
      };
    } catch (error) {
      const result = await runDailySourceAgentLoop({
        mode: "live-safe",
        cadence: payload.cadence,
        trigger: payload.trigger,
        env,
        now: new Date(event.scheduledTime).toISOString(),
      });
      return {
        ...result,
        disabled: false,
        dispatchedToWorkflow: false,
        fallback: true,
        fallbackReason: "workflow-dispatch-failed",
        scheduleFailure: {
          code: "workflow-dispatch-failed",
          message: error instanceof Error ? error.message : "workflow-dispatch-failed",
        },
        payload: { ...payload, fallback: true },
      };
    }
  }

  const result = await runDailySourceAgentLoop({
    mode: "live-safe",
    cadence: payload.cadence,
    trigger: payload.trigger,
    env,
    now: new Date(event.scheduledTime).toISOString(),
  });
  return {
    ...result,
    disabled: false,
    dispatchedToWorkflow: false,
    fallback: true,
    fallbackReason: "missing-workflow-binding",
    payload: { ...payload, fallback: true },
  };
}

export function createDailyLoopWorkerHandler(
  openNextWorker: FetchOnlyWorker,
): ExportedHandler<DailyLoopScheduledEnv> {
  return {
    fetch(request, env, ctx) {
      if (!openNextWorker.fetch) {
        return new Response("OpenNext fetch handler unavailable", { status: 500 });
      }

      return openNextWorker.fetch(request, env, ctx);
    },
    scheduled(event, env, ctx) {
      ctx.waitUntil(
        scheduledDailySourceAgentLoop(event, env).then((result) => {
          if (result.disabled) {
            console.info("daily-source-agent-loop-disabled", result);
          }

          return result;
        }),
      );
    },
  };
}

function createWorkflowInstanceId(event: DailyLoopScheduledEvent) {
  return `daily-source-agent-loop-${event.scheduledTime}-${event.cron.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

function getDailyLoopDisabledValue(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && DAILY_LOOP_DISABLED_VALUES.has(normalized) ? value : undefined;
}
