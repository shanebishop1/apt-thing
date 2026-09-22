import type {
  AgentRunLogRecord,
  BriefingRecord,
  BriefingRunHistoryContract,
  ConfidenceTriageMetadata,
  EvidenceStoragePointer,
  SeenRejectedMemoryRecord,
  SourceEvidenceRecord,
} from "../agent-contracts";
import type { Cadence, ListingCandidate, RunStatus } from "../listings";
import { uniqueStrings } from "../utils/text";
import { parseJson } from "../utils/json";
import { stableId } from "./ids";
import {
  changedRows,
  DailyLoopRunConflict,
  findActiveRun,
  recordRunFailure,
} from "./run-lifecycle";
import {
  DAILY_LOOP_RETRY_POLICY,
  type DailyLoopD1Binding,
  type DailyLoopEnv,
  type DailyLoopMode,
  type DailyLoopPersistenceOutcome,
  type DailyLoopResult,
  type DailyLoopSkippedCandidate,
  type DailyLoopSourceCoverage,
  type DailyLoopTrigger,
} from "./types";

/** D1 is authoritative; R2 is unused in the MVP and KV only ever holds a cache hint. */

export async function readDailyLoopHistory(db: DailyLoopD1Binding, groupId: string) {
  const [saved, rejected] = await Promise.all([
    db
      .prepare("SELECT listing_json FROM app_saved_listings WHERE group_id = ?")
      .bind(groupId)
      .all<{ listing_json: string }>(),
    db
      .prepare("SELECT memory_json FROM app_seen_rejected_memory WHERE group_id = ?")
      .bind(groupId)
      .all<{ memory_json: string }>(),
  ]);
  return {
    listings: (saved.results ?? []).flatMap((row) => {
      const listing = parseJson<ListingCandidate>(row.listing_json);
      return listing?.groupId === groupId ? [listing] : [];
    }),
    memory: (rejected.results ?? []).flatMap((row) => {
      const memory = parseJson<SeenRejectedMemoryRecord>(row.memory_json);
      return memory?.groupId === groupId ? [memory] : [];
    }),
  };
}

export async function persistDailyLoopArtifacts(input: {
  env?: DailyLoopEnv;
  mode: DailyLoopMode;
  run: AgentRunLogRecord;
  coverage: DailyLoopSourceCoverage[];
  listings: ListingCandidate[];
  skipped: DailyLoopSkippedCandidate[];
  sourceEvidence: SourceEvidenceRecord[];
  triageMetadata: ConfidenceTriageMetadata[];
  briefing: BriefingRecord;
  history: BriefingRunHistoryContract;
  seenRejectedMemory: SeenRejectedMemoryRecord[];
  rawArtifactPointers: EvidenceStoragePointer[];
  observability: DailyLoopResult["observability"];
  d1TransitionErrors: string[];
}): Promise<DailyLoopPersistenceOutcome> {
  const d1 = await persistD1(input);
  const r2 = persistRawArtifactsDisabled();
  const kv: DailyLoopPersistenceOutcome["kv"] = d1.error
    ? { attempted: false, skippedReason: "persistence-failed", writes: 0, authoritative: false }
    : await persistKV(input);
  return { d1, r2, kv };
}

export async function persistDailyLoopRunTransition(input: {
  env?: DailyLoopEnv;
  mode: DailyLoopMode;
  runId: string;
  groupId: string;
  cadence: Cadence;
  trigger: DailyLoopTrigger;
  status: Extract<RunStatus, "queued" | "running">;
  boundedConcurrency: number;
  startedAt: string;
}): Promise<string | undefined> {
  const db = input.env?.DB;
  if (!db) return undefined;

  try {
    const result = await runD1(
      db,
      "INSERT INTO daily_loop_runs (id, group_id, cadence, trigger, status, mode, bounded_concurrency, retry_policy_json, counts_json, observability_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = NULL, observability_json = excluded.observability_json WHERE daily_loop_runs.status IN ('failed', 'cancelled') OR (daily_loop_runs.status = 'queued' AND excluded.status = 'running')",
      input.runId,
      input.groupId,
      input.cadence,
      input.trigger,
      input.status,
      input.mode,
      input.boundedConcurrency,
      JSON.stringify(DAILY_LOOP_RETRY_POLICY),
      JSON.stringify(createEmptyDailyLoopCounts()),
      JSON.stringify({ statusTransition: input.status }),
      input.startedAt,
      null,
    );
    if (changedRows(result) === 0) throw new DailyLoopRunConflict(input.runId, "running");
    return undefined;
  } catch (error) {
    if (error instanceof DailyLoopRunConflict) throw error;
    if (input.status === "queued") {
      const active = await findActiveRun(db, input.groupId);
      if (active) throw new DailyLoopRunConflict(active.id, active.status);
    }
    return `${input.status}: ${error instanceof Error ? error.message : "d1-transition-failed"}`;
  }
}

function createEmptyDailyLoopCounts(): AgentRunLogRecord["counts"] {
  return {
    candidatesFound: 0,
    candidatesSkippedSeen: 0,
    candidatesSkippedTriaged: 0,
    candidatesAnalyzed: 0,
    candidatesSaved: 0,
    candidatesRejected: 0,
    sourceFailures: 0,
  };
}

async function persistD1(
  input: Parameters<typeof persistDailyLoopArtifacts>[0],
): Promise<DailyLoopPersistenceOutcome["d1"]> {
  const db = input.env?.DB;
  if (!db) return { attempted: false, skippedReason: "missing-binding", rowsWritten: 0 };
  const statements: ReturnType<DailyLoopD1Binding["prepare"]>[] = [];
  const shortlistIndexes: number[] = [];
  const write = (sql: string, ...values: unknown[]) => {
    statements.push(
      db
        .prepare(sql)
        .bind(
          ...values.map((value) =>
            value === undefined ? null : (value as string | number | null),
          ),
        ),
    );
  };
  try {
    if (!db.batch) throw new Error("d1-atomic-batch-required");
    if (input.d1TransitionErrors.length) throw new Error(input.d1TransitionErrors.join("; "));
    write(
      "INSERT INTO daily_loop_runs (id, group_id, cadence, trigger, status, mode, bounded_concurrency, retry_policy_json, counts_json, observability_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, counts_json = excluded.counts_json, observability_json = excluded.observability_json, completed_at = excluded.completed_at",
      input.run.id,
      input.run.groupId,
      input.run.cadence,
      input.run.trigger,
      input.run.status,
      input.mode,
      input.run.boundedConcurrency,
      JSON.stringify(input.run.retryPolicy),
      JSON.stringify(input.run.counts),
      JSON.stringify(input.observability),
      input.run.startedAt,
      input.run.completedAt,
    );
    write(
      "INSERT OR REPLACE INTO agent_run_logs (id, group_id, cadence, trigger, status, bounded_concurrency, retry_policy_json, counts_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      input.run.id,
      input.run.groupId,
      input.run.cadence,
      input.run.trigger,
      input.run.status,
      input.run.boundedConcurrency,
      JSON.stringify(input.run.retryPolicy),
      JSON.stringify(input.run.counts),
      input.run.startedAt,
      input.run.completedAt,
    );
    for (const unit of input.run.units) {
      write(
        "INSERT OR REPLACE INTO agent_run_units (id, run_id, source, source_url, listing_id, status, attempt, max_retries, error_code, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        unit.id,
        input.run.id,
        unit.source,
        unit.sourceUrl,
        unit.listingId,
        unit.status,
        unit.attempt,
        unit.maxRetries,
        unit.errorCode,
        unit.startedAt,
        unit.completedAt,
      );
    }
    for (const source of input.coverage) {
      write(
        "INSERT OR REPLACE INTO daily_loop_sources (id, run_id, group_id, source_key, source, classification, status, checked_count, candidate_count, failure_code, failure_message, query_metadata_json, page_metadata_json, detail_retry_metadata_json, raw_artifact_r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stableId(`${input.run.id}:source:${source.sourceKey}`),
        input.run.id,
        input.run.groupId,
        source.sourceKey,
        source.source,
        source.classification,
        source.status,
        source.checkedCount,
        source.candidateCount,
        source.failureCode,
        source.failureMessage,
        JSON.stringify(source.queryMetadata ?? {}),
        JSON.stringify(source.pageMetadata ?? {}),
        JSON.stringify(source.detailRetryMetadata ?? []),
        input.rawArtifactPointers.find((pointer) => pointer.key.includes(`/${source.source}/`))
          ?.key,
        input.run.completedAt ?? input.run.startedAt,
      );
    }
    for (const listing of input.listings) {
      // A triage-rejected candidate stays fully visible in the run's own tables, but it never
      // reaches the group's shortlist. An earlier shortlist row for the same listing (facts that
      // changed into a hard-constraint failure) is deliberately left in place, not deleted.
      const rejectedByTriage = listing.triageBucket === "rejected";
      if (!rejectedByTriage) {
        shortlistIndexes.push(statements.length);
        write(
          [
            "INSERT INTO app_saved_listings",
            "(id, group_id, url, duplicate_key, group_scoped_duplicate_key, listing_json, created_at, updated_at, discovery_run_id)",
            "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?",
            "WHERE NOT EXISTS (SELECT 1 FROM app_seen_rejected_memory WHERE group_id = ? AND group_scoped_duplicate_key = ?)",
            // Discovery never replaces roommate edits. Changed source facts remain in the run.
            // The conditional insert also protects rejections made while acquisition is in flight.
            "ON CONFLICT DO NOTHING",
          ].join(" "),
          listing.id,
          input.run.groupId,
          listing.url,
          listing.duplicateKey,
          listing.groupScopedDuplicateKey,
          JSON.stringify(listing),
          listing.createdAt,
          listing.updatedAt,
          input.run.id,
          input.run.groupId,
          listing.groupScopedDuplicateKey,
        );
      }
      write(
        "INSERT INTO listing_candidates (id, group_id, source, url, duplicate_key, submitted_by, title, extraction_status, review_status, address, neighborhood, borough, rent, bedrooms, bathrooms, available_at, description, fit_flags_json, evidence_json, concerns_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source = excluded.source, url = excluded.url, duplicate_key = excluded.duplicate_key, submitted_by = excluded.submitted_by, title = excluded.title, extraction_status = excluded.extraction_status, review_status = excluded.review_status, address = excluded.address, neighborhood = excluded.neighborhood, borough = excluded.borough, rent = excluded.rent, bedrooms = excluded.bedrooms, bathrooms = excluded.bathrooms, available_at = excluded.available_at, description = excluded.description, fit_flags_json = excluded.fit_flags_json, evidence_json = excluded.evidence_json, concerns_json = excluded.concerns_json, updated_at = excluded.updated_at",
        listing.id,
        input.run.groupId,
        listing.source,
        listing.url,
        listing.duplicateKey,
        listing.submittedBy,
        listing.title,
        listing.extractionStatus,
        listing.reviewStatus,
        listing.address,
        listing.neighborhood,
        listing.borough,
        listing.rent,
        listing.bedrooms,
        listing.bathrooms,
        listing.availableAt,
        listing.description,
        JSON.stringify(listing.fitFlags),
        JSON.stringify(listing.evidence),
        JSON.stringify(listing.concerns),
        listing.createdAt,
        listing.updatedAt,
      );
      write(
        "INSERT OR REPLACE INTO daily_loop_candidates (id, run_id, group_id, listing_id, source, source_url, source_listing_id, duplicate_key, group_scoped_duplicate_key, triage_bucket, triage_status, review_status, material_change_detected, material_change_reasons_json, normalized_candidate_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stableId(`${input.run.id}:candidate:${listing.id}`),
        input.run.id,
        input.run.groupId,
        listing.id,
        listing.source,
        listing.url,
        listing.sourceListingId,
        listing.duplicateKey,
        listing.groupScopedDuplicateKey,
        listing.triageBucket,
        listing.triageStatus,
        listing.reviewStatus,
        input.skipped.some((item) => item.sourceUrl === listing.url && item.materialChangeDetected)
          ? 1
          : 0,
        JSON.stringify(
          input.skipped.find(
            (item) => item.sourceUrl === listing.url && item.materialChangeDetected,
          )?.materialChangeReasons ?? [],
        ),
        JSON.stringify(listing),
        listing.createdAt,
        listing.updatedAt,
      );
      const material = input.skipped.find(
        (item) => item.sourceUrl === listing.url && item.materialChangeDetected,
      );
      write(
        "INSERT OR REPLACE INTO daily_loop_candidate_status (id, run_id, group_id, source_url, listing_id, status, reason, material_change_detected, material_change_reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stableId(`${input.run.id}:status:${listing.url}:processed`),
        input.run.id,
        input.run.groupId,
        listing.url,
        listing.id,
        material
          ? "material-change-processed"
          : listing.extractionStatus === "failed"
            ? "provider-fallback-review-needed"
            : "processed",
        material
          ? "Processed because material listing details changed."
          : rejectedByTriage
            ? "Rejected by triage; kept out of the group shortlist."
            : "Daily loop processed candidate.",
        material ? 1 : 0,
        JSON.stringify(material?.materialChangeReasons ?? []),
        input.run.completedAt ?? input.run.startedAt,
      );
    }
    for (const skipped of input.skipped.filter((item) => !item.materialChangeDetected)) {
      write(
        "INSERT OR REPLACE INTO daily_loop_candidate_status (id, run_id, group_id, source_url, listing_id, status, reason, material_change_detected, material_change_reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stableId(`${input.run.id}:status:${skipped.sourceUrl}:${skipped.reason}`),
        input.run.id,
        input.run.groupId,
        skipped.sourceUrl,
        skipped.listingId,
        `skipped-${skipped.reason}`,
        `Skipped because candidate was already ${skipped.reason}.`,
        0,
        JSON.stringify([]),
        input.run.completedAt ?? input.run.startedAt,
      );
    }
    for (const memory of input.seenRejectedMemory) {
      write(
        "INSERT OR REPLACE INTO daily_loop_seen_memory (id, group_id, source_url, duplicate_key, group_scoped_duplicate_key, memory_state, reason, last_run_id, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        memory.id,
        memory.groupId,
        memory.sourceUrl,
        memory.duplicateKey,
        memory.groupScopedDuplicateKey,
        memory.memoryState,
        memory.reason,
        input.run.id,
        memory.lastSeenAt,
      );
      if (memory.memoryState !== "rejected") continue;
      // Rejected candidates never land in app_saved_listings, so the app-side memory table is the
      // only place the group can see that the loop already turned this source URL down.
      write(
        [
          "INSERT INTO app_seen_rejected_memory",
          "(id, group_id, source_url, group_scoped_duplicate_key, memory_json, last_seen_at)",
          "VALUES (?, ?, ?, ?, ?, ?)",
          "ON CONFLICT(group_id, group_scoped_duplicate_key) DO UPDATE SET",
          "source_url = excluded.source_url, memory_json = excluded.memory_json,",
          "last_seen_at = excluded.last_seen_at",
        ].join(" "),
        memory.id,
        memory.groupId,
        memory.sourceUrl,
        memory.groupScopedDuplicateKey,
        JSON.stringify(memory),
        memory.lastSeenAt,
      );
    }
    for (const evidence of input.sourceEvidence) {
      write(
        "INSERT OR REPLACE INTO source_evidence_records (id, group_id, listing_id, run_id, source_url, claim, quote, storage_owner, storage_key, content_type, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        evidence.id,
        evidence.groupId,
        evidence.listingId ?? null,
        evidence.runId,
        evidence.sourceUrl,
        evidence.claim,
        evidence.quote,
        evidence.pointer.owner,
        evidence.pointer.key,
        evidence.pointer.contentType,
        evidence.capturedAt,
      );
    }
    for (const triage of input.triageMetadata) {
      write(
        "INSERT OR REPLACE INTO daily_loop_candidate_status (id, run_id, group_id, source_url, listing_id, status, reason, material_change_detected, material_change_reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stableId(`${input.run.id}:triage:${triage.listingId}`),
        input.run.id,
        triage.groupId,
        input.listings.find((listing) => listing.id === triage.listingId)?.url ?? triage.listingId,
        triage.listingId,
        triage.status === "failed" ? "provider-fallback-review-needed" : "processed",
        `Triage ${triage.bucket} with ${triage.schemaValidationResult} schema validation.`,
        0,
        JSON.stringify([]),
        triage.updatedAt,
      );
    }
    write(
      "INSERT OR REPLACE INTO daily_loop_briefings (id, run_id, group_id, briefing_record_json, history_contract_json, generated_at) VALUES (?, ?, ?, ?, ?, ?)",
      input.briefing.id,
      input.run.id,
      input.briefing.groupId,
      JSON.stringify(input.briefing),
      JSON.stringify(input.history),
      input.briefing.generatedAt,
    );
    write(
      "INSERT OR REPLACE INTO briefing_records (id, group_id, run_id, summary, payload_json, generated_at) VALUES (?, ?, ?, ?, ?, ?)",
      input.briefing.id,
      input.briefing.groupId,
      input.run.id,
      input.briefing.summary,
      JSON.stringify(input.briefing),
      input.briefing.generatedAt,
    );
    const savedCount = "(SELECT COUNT(*) FROM app_saved_listings WHERE discovery_run_id = ?)";
    write(
      `UPDATE daily_loop_runs SET counts_json = json_set(counts_json, '$.candidatesSaved', ${savedCount}), observability_json = json_set(observability_json, '$.operatorEvidence.candidateCounts.saved', ${savedCount}) WHERE id = ?`,
      input.run.id,
      input.run.id,
      input.run.id,
    );
    write(
      "UPDATE agent_run_logs SET counts_json = (SELECT counts_json FROM daily_loop_runs WHERE id = ?) WHERE id = ?",
      input.run.id,
      input.run.id,
    );
    write(
      `UPDATE daily_loop_briefings SET history_contract_json = json_set(history_contract_json, '$.latestRun.operatorEvidence.candidateCounts.saved', ${savedCount}, '$.runs[0].operatorEvidence.candidateCounts.saved', ${savedCount}) WHERE run_id = ?`,
      input.run.id,
      input.run.id,
      input.run.id,
    );
    const results = await db.batch(statements);
    return {
      attempted: true,
      rowsWritten: results.reduce<number>((sum, result) => sum + changedRows(result), 0),
      candidatesSaved: shortlistIndexes.reduce(
        (sum, index) => sum + changedRows(results[index]),
        0,
      ),
    };
  } catch (error) {
    const errors = uniqueStrings([
      ...input.d1TransitionErrors,
      error instanceof Error ? error.message : "d1-write-failed",
    ]);
    await recordRunFailure(db, input.run.id, errors.join("; "));
    return {
      attempted: true,
      rowsWritten: 0,
      candidatesSaved: 0,
      error: errors.join("; "),
    };
  }
}

async function runD1(db: DailyLoopD1Binding, sql: string, ...values: unknown[]) {
  return db
    .prepare(sql)
    .bind(
      ...values.map((value) => (value === undefined ? null : (value as string | number | null))),
    )
    .run();
}

function persistRawArtifactsDisabled(): DailyLoopPersistenceOutcome["r2"] {
  return { attempted: false, skippedReason: "disabled-no-r2", objectsWritten: 0 };
}

async function persistKV(
  input: Parameters<typeof persistDailyLoopArtifacts>[0],
): Promise<DailyLoopPersistenceOutcome["kv"]> {
  const cache = input.env?.APP_CACHE;
  if (!cache)
    return {
      attempted: false,
      skippedReason: "missing-binding",
      writes: 0,
      authoritative: false,
    };

  try {
    await cache.put(
      `daily-loop:${input.run.groupId}:latest`,
      JSON.stringify({
        runId: input.run.id,
        status: input.run.status,
        sourceFailures: input.run.counts.sourceFailures,
        generatedAt: input.run.completedAt ?? input.run.startedAt,
      }),
      { expirationTtl: 60 * 60 * 24 * 7 },
    );
    return { attempted: true, writes: 1, authoritative: false };
  } catch (error) {
    return {
      attempted: true,
      writes: 0,
      authoritative: false,
      error: error instanceof Error ? error.message : "kv-cache-write-failed",
    };
  }
}
