import type { AgentRunLogRecord, RunUnitLogRecord } from "./agent-contracts";
import { defaultSearchGroup } from "./listings";

export type ScheduledFanoutUnitInput = {
  id: string;
  source: RunUnitLogRecord["source"];
  sourceUrl?: string;
  listingId?: string;
  shouldFail?: boolean;
  skipSeen?: boolean;
  processingDelayMs?: number;
};

export type ScheduledWorkflowFanoutResult = {
  contract: "scheduled-workflow-fanout-v1";
  durableRunId: string;
  scheduledAt: string;
  queueCompatible: true;
  simulatedQueueBinding: "AGENT_FANOUT_QUEUE";
  maxObservedInFlight: number;
  transitions: Array<{ status: AgentRunLogRecord["status"]; at: string }>;
  runLog: AgentRunLogRecord;
};

export async function simulateScheduledWorkflowFanout({
  groupId = defaultSearchGroup.id,
  scheduledAt = new Date().toISOString(),
  units = defaultScheduledFanoutUnits(),
  boundedConcurrency = 2,
  maxRetries = 1,
  retryDelayMs = 250,
}: {
  groupId?: string;
  scheduledAt?: string;
  units?: ScheduledFanoutUnitInput[];
  boundedConcurrency?: number;
  maxRetries?: number;
  retryDelayMs?: number;
} = {}): Promise<ScheduledWorkflowFanoutResult> {
  const concurrency = normalizeConcurrency(boundedConcurrency);
  const durableRunId = createDurableRunId(groupId, scheduledAt);
  const transitions: ScheduledWorkflowFanoutResult["transitions"] = [
    { status: "queued", at: scheduledAt },
    { status: "running", at: new Date().toISOString() },
  ];
  const processed = await mapWithBoundedConcurrency(units, concurrency, (unit) =>
    processUnit({ unit, maxRetries, retryDelayMs }),
  );
  const runUnits = processed.results;
  const sourceFailures = runUnits.filter((unit) => unit.status === "failed").length;
  const skippedSeen = runUnits.filter((unit) => unit.status === "skipped-seen").length;
  const successes = runUnits.filter((unit) => unit.status === "success").length;
  const status: AgentRunLogRecord["status"] =
    sourceFailures > 0 && successes > 0 ? "partial" : sourceFailures > 0 ? "failed" : "success";
  const completedAt = new Date().toISOString();

  transitions.push({ status, at: completedAt });

  return {
    contract: "scheduled-workflow-fanout-v1",
    durableRunId,
    scheduledAt,
    queueCompatible: true,
    simulatedQueueBinding: "AGENT_FANOUT_QUEUE",
    maxObservedInFlight: processed.maxObservedInFlight,
    transitions,
    runLog: {
      id: durableRunId,
      contract: "agent-run-log-v1",
      groupId,
      cadence: "daily",
      trigger: "cron",
      status,
      startedAt: scheduledAt,
      completedAt,
      counts: {
        candidatesFound: units.length,
        candidatesSkippedSeen: skippedSeen,
        candidatesAnalyzed: successes + sourceFailures,
        candidatesSaved: successes,
        candidatesRejected: 0,
        sourceFailures,
      },
      boundedConcurrency: concurrency,
      retryPolicy: { maxRetries, retryDelayMs },
      units: runUnits,
    },
  };
}

export function defaultScheduledFanoutUnits(): ScheduledFanoutUnitInput[] {
  return [
    {
      id: "streeteasy-confirmed-unit",
      source: "streeteasy",
      sourceUrl: "https://streeteasy.com/building/batch-save/3",
      listingId: "batch-save-1",
      processingDelayMs: 1,
    },
    {
      id: "streeteasy-review-unit",
      source: "streeteasy",
      sourceUrl: "https://streeteasy.com/building/batch-review/4",
      listingId: "batch-review-1",
      processingDelayMs: 1,
    },
    {
      id: "seen-skip-unit",
      source: "streeteasy",
      sourceUrl: "https://streeteasy.com/building/batch-seen/1",
      listingId: "batch-seen-1",
      skipSeen: true,
      processingDelayMs: 1,
    },
    {
      id: "isolated-source-failure-unit",
      source: "other",
      sourceUrl: "https://fixture-source.invalid/listings/failing-source",
      shouldFail: true,
      processingDelayMs: 1,
    },
  ];
}

async function processUnit({
  unit,
  maxRetries,
  retryDelayMs,
}: {
  unit: ScheduledFanoutUnitInput;
  maxRetries: number;
  retryDelayMs: number;
}): Promise<RunUnitLogRecord> {
  const startedAt = new Date().toISOString();

  if (unit.skipSeen) {
    return {
      id: unit.id,
      source: unit.source,
      sourceUrl: unit.sourceUrl,
      listingId: unit.listingId,
      status: "skipped-seen",
      attempt: 0,
      maxRetries,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    await wait(unit.processingDelayMs ?? 0);

    if (!unit.shouldFail) {
      return {
        id: unit.id,
        source: unit.source,
        sourceUrl: unit.sourceUrl,
        listingId: unit.listingId,
        status: "success",
        attempt,
        maxRetries,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    if (attempt <= maxRetries) {
      await wait(retryDelayMs > 10 ? 1 : retryDelayMs);
    }
  }

  return {
    id: unit.id,
    source: unit.source,
    sourceUrl: unit.sourceUrl,
    listingId: unit.listingId,
    status: "failed",
    attempt: maxRetries + 1,
    maxRetries,
    errorCode: "unit-failed-after-retries",
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

async function mapWithBoundedConcurrency<T, R>(
  items: T[],
  concurrencyLimit: number,
  worker: (item: T, index: number) => Promise<R> | R,
): Promise<{ results: R[]; maxObservedInFlight: number }> {
  const results: R[] = [];
  results.length = items.length;
  let nextIndex = 0;
  let inFlight = 0;
  let maxObservedInFlight = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index]!;

      inFlight += 1;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      try {
        results[index] = await worker(item, index);
      } finally {
        inFlight -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrencyLimit, items.length) }, runWorker));

  return { results, maxObservedInFlight };
}

function normalizeConcurrency(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.floor(value);
}

function createDurableRunId(groupId: string, scheduledAt: string): string {
  const normalized = `${groupId}:${scheduledAt}`.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();

  return `workflow-run-${normalized}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
