import type {
  AgentRunLogRecord,
  BriefingRecord,
  BriefingRunHistoryContract,
  BriefingRunHistoryRun,
  EvidenceStoragePointer,
  SourceCoverageSummary,
} from "./agent-contracts";
import type { Cadence, ListingCandidate, RunStatus } from "./listings";
import type { D1DatabaseLike } from "./shared-listing-store";
import { parseJson } from "./utils/json";

export const RUN_HISTORY_LIMIT = 25;

export type PersistedRunSkipCounts = {
  seen: number;
  saved: number;
  rejected: number;
  triaged: number;
};

export type PersistedRunHistoryRun = BriefingRunHistoryRun & {
  mode: "fixture" | "live-safe";
  skipped: PersistedRunSkipCounts;
  materialChanges: number;
  memoryUpdates: number;
  briefingSummary?: string;
};

export type PersistedRunHistory = {
  groupId: string;
  generatedAt: string;
  runs: PersistedRunHistoryRun[];
};

type RunRow = {
  id: string;
  cadence: Cadence;
  trigger: AgentRunLogRecord["trigger"];
  status: RunStatus;
  mode: "fixture" | "live-safe";
  counts_json: string;
  started_at: string;
  completed_at: string | null;
};

type SourceRow = {
  run_id: string;
  source: string;
  status: SourceCoverageSummary["status"];
  checked_count: number;
  candidate_count: number;
  failure_code: string | null;
  failure_message: string | null;
  raw_artifact_r2_key: string | null;
};

type CandidateRow = {
  run_id: string;
  triage_bucket: ListingCandidate["triageBucket"];
};

type StatusRow = {
  run_id: string;
  status: string;
  total: number;
};

type MemoryRow = {
  last_run_id: string;
  total: number;
};

type BriefingRow = {
  run_id: string;
  briefing_record_json: string;
  history_contract_json: string;
};

export async function readPersistedRunHistory(
  db: D1DatabaseLike,
  groupId: string,
  { limit = RUN_HISTORY_LIMIT, now = new Date().toISOString() } = {},
): Promise<PersistedRunHistory> {
  const runRows =
    (
      await db
        .prepare(
          "SELECT id, cadence, trigger, status, mode, counts_json, started_at, completed_at FROM daily_loop_runs WHERE group_id = ? ORDER BY started_at DESC LIMIT ?",
        )
        .bind(groupId, limit)
        .all<RunRow>()
    ).results ?? [];

  if (runRows.length === 0) return { groupId, generatedAt: now, runs: [] };

  const runIds = runRows.map((row) => row.id);
  const placeholders = runIds.map(() => "?").join(", ");
  const scoped = <T>(sql: string) =>
    db
      .prepare(sql.replace("(:runIds)", `(${placeholders})`))
      .bind(groupId, ...runIds)
      .all<T>()
      .then((result) => result.results ?? []);

  const [sourceRows, candidateRows, statusRows, memoryRows, briefingRows] = await Promise.all([
    scoped<SourceRow>(
      "SELECT run_id, source, status, checked_count, candidate_count, failure_code, failure_message, raw_artifact_r2_key FROM daily_loop_sources WHERE group_id = ? AND run_id IN (:runIds) ORDER BY source_key",
    ),
    scoped<CandidateRow>(
      "SELECT run_id, triage_bucket FROM daily_loop_candidates WHERE group_id = ? AND run_id IN (:runIds)",
    ),
    scoped<StatusRow>(
      "SELECT run_id, status, COUNT(*) AS total FROM daily_loop_candidate_status WHERE group_id = ? AND run_id IN (:runIds) GROUP BY run_id, status",
    ),
    scoped<MemoryRow>(
      "SELECT last_run_id, COUNT(*) AS total FROM daily_loop_seen_memory WHERE group_id = ? AND last_run_id IN (:runIds) GROUP BY last_run_id",
    ),
    scoped<BriefingRow>(
      "SELECT run_id, briefing_record_json, history_contract_json FROM daily_loop_briefings WHERE group_id = ? AND run_id IN (:runIds) ORDER BY generated_at DESC",
    ),
  ]);

  return {
    groupId,
    generatedAt: now,
    runs: runRows.map((row) =>
      assembleRun(row, {
        sources: sourceRows.filter((source) => source.run_id === row.id),
        candidates: candidateRows.filter((candidate) => candidate.run_id === row.id),
        statuses: statusRows.filter((status) => status.run_id === row.id),
        memoryUpdates: Number(
          memoryRows.find((memory) => memory.last_run_id === row.id)?.total ?? 0,
        ),
        briefing: briefingRows.find((briefing) => briefing.run_id === row.id),
      }),
    ),
  };
}

function assembleRun(
  row: RunRow,
  related: {
    sources: SourceRow[];
    candidates: CandidateRow[];
    statuses: StatusRow[];
    memoryUpdates: number;
    briefing?: BriefingRow;
  },
): PersistedRunHistoryRun {
  const runCounts = parseJson<Partial<AgentRunLogRecord["counts"]>>(row.counts_json) ?? {};
  const briefingRecord = related.briefing
    ? parseJson<BriefingRecord>(related.briefing.briefing_record_json)
    : undefined;
  const briefingRun = related.briefing
    ? findBriefingRun(
        parseJson<BriefingRunHistoryContract>(related.briefing.history_contract_json),
        row.id,
      )
    : undefined;
  const statusCount = (status: string) =>
    Number(related.statuses.find((item) => item.status === status)?.total ?? 0);
  const bucketCount = (bucket: ListingCandidate["triageBucket"]) =>
    related.candidates.filter((candidate) => candidate.triage_bucket === bucket).length;
  const sourceCoverage = related.sources.map(toSourceCoverage);

  return {
    runId: row.id,
    cadence: row.cadence,
    trigger: row.trigger,
    status: row.status,
    mode: row.mode,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    counts: {
      candidatesFound: Number(runCounts.candidatesFound ?? 0),
      candidatesSkippedSeen: Number(runCounts.candidatesSkippedSeen ?? 0),
      candidatesSkippedTriaged: Number(runCounts.candidatesSkippedTriaged ?? 0),
      candidatesTriaged: Number(runCounts.candidatesAnalyzed ?? 0),
      confirmedMatches: bucketCount("confirmed-match"),
      reviewNeeded: bucketCount("review-needed"),
      rejected: bucketCount("rejected"),
      sourceFailures: sourceCoverage.filter((source) => source.status === "failed").length,
    },
    skipped: {
      seen: statusCount("skipped-seen"),
      saved: statusCount("skipped-saved"),
      rejected: statusCount("skipped-rejected"),
      triaged: statusCount("skipped-triaged"),
    },
    materialChanges: statusCount("material-change-processed"),
    memoryUpdates: related.memoryUpdates,
    sourceCoverage,
    candidateSummaries: briefingRun?.candidateSummaries ?? [],
    providerMetadata: briefingRun?.providerMetadata ?? [],
    rawArtifactPointers: briefingRun?.rawArtifactPointers ?? [],
    briefingSummary: briefingRecord?.summary,
  };
}

function findBriefingRun(
  history: BriefingRunHistoryContract | undefined,
  runId: string,
): BriefingRunHistoryRun | undefined {
  if (!history) return undefined;
  return (
    history.runs?.find((run) => run.runId === runId) ??
    (history.latestRun?.runId === runId ? history.latestRun : undefined)
  );
}

function toSourceCoverage(row: SourceRow): SourceCoverageSummary {
  const pointers: EvidenceStoragePointer[] = row.raw_artifact_r2_key
    ? [{ owner: "d1", key: row.raw_artifact_r2_key, groupScoped: true }]
    : [];

  return {
    source: row.source,
    status: row.status,
    checkedCount: Number(row.checked_count),
    candidateCount: Number(row.candidate_count),
    failureCode: row.failure_code ?? undefined,
    failureMessage: row.failure_message ?? undefined,
    rawArtifactPointers: pointers,
  };
}
