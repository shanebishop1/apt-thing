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
import { stableId } from "./ids";
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
  const kv = await persistKV(input);
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
    await runD1(
      db,
      "INSERT OR REPLACE INTO daily_loop_runs (id, group_id, cadence, trigger, status, mode, bounded_concurrency, retry_policy_json, counts_json, observability_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    return undefined;
  } catch (error) {
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
  try {
    let rowsWritten = 0;
    await runD1(
      db,
      "INSERT OR REPLACE INTO daily_loop_runs (id, group_id, cadence, trigger, status, mode, bounded_concurrency, retry_policy_json, counts_json, observability_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    rowsWritten += 1;
    await runD1(
      db,
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
    rowsWritten += 1;
    for (const unit of input.run.units) {
      await runD1(
        db,
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
      rowsWritten += 1;
    }
    for (const source of input.coverage) {
      await runD1(
        db,
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
      rowsWritten += 1;
    }
    for (const listing of input.listings) {
      await runD1(
        db,
        [
          "INSERT INTO app_saved_listings",
          "(id, group_id, url, duplicate_key, group_scoped_duplicate_key, listing_json, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          "ON CONFLICT(id) DO UPDATE SET",
          "url = excluded.url, duplicate_key = excluded.duplicate_key,",
          "group_scoped_duplicate_key = excluded.group_scoped_duplicate_key,",
          "listing_json = excluded.listing_json, updated_at = excluded.updated_at,",
          "revision = app_saved_listings.revision + 1",
        ].join(" "),
        listing.id,
        input.run.groupId,
        listing.url,
        listing.duplicateKey,
        listing.groupScopedDuplicateKey,
        JSON.stringify(listing),
        listing.createdAt,
        listing.updatedAt,
      );
      rowsWritten += 1;
      await runD1(
        db,
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
      rowsWritten += 1;
      await runD1(
        db,
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
      rowsWritten += 1;
      const material = input.skipped.find(
        (item) => item.sourceUrl === listing.url && item.materialChangeDetected,
      );
      await runD1(
        db,
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
          : "Daily loop processed candidate.",
        material ? 1 : 0,
        JSON.stringify(material?.materialChangeReasons ?? []),
        input.run.completedAt ?? input.run.startedAt,
      );
      rowsWritten += 1;
    }
    for (const skipped of input.skipped.filter((item) => !item.materialChangeDetected)) {
      await runD1(
        db,
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
      rowsWritten += 1;
    }
    for (const memory of input.seenRejectedMemory) {
      await runD1(
        db,
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
      rowsWritten += 1;
    }
    for (const evidence of input.sourceEvidence) {
      await runD1(
        db,
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
      rowsWritten += 1;
    }
    for (const triage of input.triageMetadata) {
      await runD1(
        db,
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
      rowsWritten += 1;
    }
    await runD1(
      db,
      "INSERT OR REPLACE INTO daily_loop_briefings (id, run_id, group_id, briefing_record_json, history_contract_json, generated_at) VALUES (?, ?, ?, ?, ?, ?)",
      input.briefing.id,
      input.run.id,
      input.briefing.groupId,
      JSON.stringify(input.briefing),
      JSON.stringify(input.history),
      input.briefing.generatedAt,
    );
    rowsWritten += 1;
    await runD1(
      db,
      "INSERT OR REPLACE INTO briefing_records (id, group_id, run_id, summary, payload_json, generated_at) VALUES (?, ?, ?, ?, ?, ?)",
      input.briefing.id,
      input.briefing.groupId,
      input.run.id,
      input.briefing.summary,
      JSON.stringify(input.briefing),
      input.briefing.generatedAt,
    );
    rowsWritten += 1;
    return input.d1TransitionErrors.length > 0
      ? { attempted: true, rowsWritten, error: input.d1TransitionErrors.join("; ") }
      : { attempted: true, rowsWritten };
  } catch (error) {
    const errors = uniqueStrings([
      ...input.d1TransitionErrors,
      error instanceof Error ? error.message : "d1-write-failed",
    ]);
    return {
      attempted: true,
      rowsWritten: 0,
      error: errors.join("; "),
    };
  }
}

async function runD1(db: DailyLoopD1Binding, sql: string, ...values: unknown[]) {
  await db
    .prepare(sql)
    .bind(...values.map((value) => (value === undefined ? null : value)))
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
