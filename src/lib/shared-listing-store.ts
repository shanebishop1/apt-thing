import type { GroupActionRecord, SeenRejectedMemoryRecord } from "./agent-contracts";
import { defaultSearchGroup, type ListingCandidate } from "./listings";
import { parseJson } from "./utils/json";

export type SharedListingSnapshot = {
  groupId: string;
  listings: ListingCandidate[];
  actions: GroupActionRecord[];
  memory: SeenRejectedMemoryRecord[];
  updatedAt: string;
};

export type StoredExtractionJob = {
  id: string;
  groupId: string;
  listingId?: string;
  sourceUrl: string;
  status: ListingCandidate["extractionStatus"];
  provider?: string;
  model?: string;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
};

type D1Value = string | number | null;
type D1PreparedStatementLike = {
  bind(...values: D1Value[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};
export type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatementLike;
  batch?(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
};

type ListingRow = {
  listing_json: string;
  revision: number;
  updated_at: string;
};

export type ConditionalWriteResult =
  | { ok: true; listing: ListingCandidate }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "conflict"; current: ListingCandidate };

type ActionRow = {
  action_json: string;
};

type MemoryRow = {
  memory_json: string;
};

export async function readSharedListingSnapshot(
  db: D1DatabaseLike,
  groupId = defaultSearchGroup.id,
): Promise<SharedListingSnapshot> {
  const [listingRows, actionRows, memoryRows] = await Promise.all([
    db
      .prepare(
        "SELECT listing_json, revision, updated_at FROM app_saved_listings WHERE group_id = ? ORDER BY updated_at DESC",
      )
      .bind(groupId)
      .all<ListingRow>(),
    db
      .prepare(
        "SELECT action_json FROM app_group_actions WHERE group_id = ? ORDER BY created_at DESC",
      )
      .bind(groupId)
      .all<ActionRow>(),
    db
      .prepare(
        "SELECT memory_json FROM app_seen_rejected_memory WHERE group_id = ? ORDER BY last_seen_at DESC",
      )
      .bind(groupId)
      .all<MemoryRow>(),
  ]);
  const listings = (listingRows.results ?? [])
    .map(parseListingRow)
    .filter((listing): listing is ListingCandidate =>
      Boolean(listing && listing.groupId === groupId),
    );
  const actions = (actionRows.results ?? [])
    .map((row) => parseJson<GroupActionRecord>(row.action_json))
    .filter((action): action is GroupActionRecord => Boolean(action && action.groupId === groupId));
  const memory = (memoryRows.results ?? [])
    .map((row) => parseJson<SeenRejectedMemoryRecord>(row.memory_json))
    .filter((record): record is SeenRejectedMemoryRecord =>
      Boolean(record && record.groupId === groupId),
    );

  return {
    groupId,
    listings,
    actions,
    memory,
    updatedAt: listings[0]?.updatedAt ?? new Date().toISOString(),
  };
}

export async function findListingByDuplicateKey(
  db: D1DatabaseLike,
  groupId: string,
  groupScopedDuplicateKey: string,
): Promise<ListingCandidate | undefined> {
  const row = await db
    .prepare(
      "SELECT listing_json, revision FROM app_saved_listings WHERE group_id = ? AND group_scoped_duplicate_key = ? LIMIT 1",
    )
    .bind(groupId, groupScopedDuplicateKey)
    .first<Omit<ListingRow, "updated_at">>();

  return row ? parseListingRow(row) : undefined;
}

/**
 * Creation path only: a plain INSERT that never overwrites an existing row. A concurrent
 * create of the same URL loses the unique-index race and resolves to the stored duplicate.
 */
export async function insertSavedListing(
  db: D1DatabaseLike,
  listing: ListingCandidate,
): Promise<{ kind: "created" | "duplicate"; listing: ListingCandidate }> {
  try {
    await db
      .prepare(
        [
          "INSERT INTO app_saved_listings",
          "(id, group_id, url, duplicate_key, group_scoped_duplicate_key, listing_json, created_at, updated_at, revision)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
        ].join(" "),
      )
      .bind(
        listing.id,
        listing.groupId,
        listing.url,
        listing.duplicateKey,
        listing.groupScopedDuplicateKey,
        serializeListing(listing),
        listing.createdAt,
        listing.updatedAt,
      )
      .run();
  } catch (error) {
    const existing =
      (await readSavedListing(db, listing.groupId, listing.id)) ??
      (await findListingByDuplicateKey(db, listing.groupId, listing.groupScopedDuplicateKey));
    if (existing) return { kind: "duplicate", listing: existing };
    throw error;
  }

  return { kind: "created", listing: { ...listing, revision: 1 } };
}

export async function updateSavedListingAtRevision(
  db: D1DatabaseLike,
  listing: ListingCandidate,
  expectedRevision: number,
): Promise<ConditionalWriteResult> {
  const result = await db
    .prepare(
      [
        "UPDATE app_saved_listings SET",
        "url = ?, duplicate_key = ?, group_scoped_duplicate_key = ?, listing_json = ?, updated_at = ?,",
        "revision = revision + 1",
        "WHERE id = ? AND group_id = ? AND revision = ?",
      ].join(" "),
    )
    .bind(
      listing.url,
      listing.duplicateKey,
      listing.groupScopedDuplicateKey,
      serializeListing(listing),
      listing.updatedAt,
      listing.id,
      listing.groupId,
      expectedRevision,
    )
    .run();

  if (readChanges(result) === 1) {
    return { ok: true, listing: { ...listing, revision: expectedRevision + 1 } };
  }
  return explainFailedConditionalWrite(db, listing.groupId, listing.id);
}

export async function deleteSavedListingAtRevision(
  db: D1DatabaseLike,
  groupId: string,
  listingId: string,
  expectedRevision: number,
): Promise<ConditionalWriteResult> {
  const current = await readSavedListing(db, groupId, listingId);
  if (!current) return { ok: false, reason: "not-found" };

  const result = await db
    .prepare("DELETE FROM app_saved_listings WHERE id = ? AND group_id = ? AND revision = ?")
    .bind(listingId, groupId, expectedRevision)
    .run();

  if (readChanges(result) === 1) return { ok: true, listing: current };
  return explainFailedConditionalWrite(db, groupId, listingId);
}

export async function readSavedListing(
  db: D1DatabaseLike,
  groupId: string,
  listingId: string,
): Promise<ListingCandidate | undefined> {
  const row = await db
    .prepare(
      "SELECT listing_json, revision FROM app_saved_listings WHERE group_id = ? AND id = ? LIMIT 1",
    )
    .bind(groupId, listingId)
    .first<Omit<ListingRow, "updated_at">>();

  return row ? parseListingRow(row) : undefined;
}

async function explainFailedConditionalWrite(
  db: D1DatabaseLike,
  groupId: string,
  listingId: string,
): Promise<ConditionalWriteResult> {
  const current = await readSavedListing(db, groupId, listingId);
  return current ? { ok: false, reason: "conflict", current } : { ok: false, reason: "not-found" };
}

export async function appendSharedGroupAction(
  db: D1DatabaseLike,
  action: GroupActionRecord,
): Promise<GroupActionRecord> {
  if (action.actionType === "reaction" && action.actorIdentityToken) {
    await db
      .prepare(
        "DELETE FROM app_group_actions WHERE group_id = ? AND listing_id = ? AND action_type = 'reaction' AND actor_identity_token = ?",
      )
      .bind(action.groupId, action.listingId, action.actorIdentityToken)
      .run();
  }

  await db
    .prepare(
      "INSERT OR REPLACE INTO app_group_actions (id, group_id, listing_id, action_type, actor_identity_token, action_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      action.id,
      action.groupId,
      action.listingId,
      action.actionType,
      action.actorIdentityToken ?? null,
      JSON.stringify(action),
      action.createdAt,
    )
    .run();

  return action;
}

export async function upsertSeenRejectedMemoryRecord(
  db: D1DatabaseLike,
  record: SeenRejectedMemoryRecord,
): Promise<SeenRejectedMemoryRecord> {
  await db
    .prepare(
      [
        "INSERT INTO app_seen_rejected_memory",
        "(id, group_id, source_url, group_scoped_duplicate_key, memory_json, last_seen_at)",
        "VALUES (?, ?, ?, ?, ?, ?)",
        "ON CONFLICT(group_id, group_scoped_duplicate_key) DO UPDATE SET",
        "source_url = excluded.source_url, memory_json = excluded.memory_json, last_seen_at = excluded.last_seen_at",
      ].join(" "),
    )
    .bind(
      record.id,
      record.groupId,
      record.sourceUrl,
      record.groupScopedDuplicateKey,
      JSON.stringify(record),
      record.lastSeenAt,
    )
    .run();

  return record;
}

export async function recordExtractionJob(
  db: D1DatabaseLike,
  job: StoredExtractionJob,
): Promise<StoredExtractionJob> {
  await db
    .prepare(
      [
        "INSERT INTO app_extraction_jobs",
        "(id, group_id, listing_id, source_url, status, job_json, created_at, updated_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        "ON CONFLICT(id) DO UPDATE SET",
        "listing_id = excluded.listing_id, status = excluded.status, job_json = excluded.job_json, updated_at = excluded.updated_at",
      ].join(" "),
    )
    .bind(
      job.id,
      job.groupId,
      job.listingId ?? null,
      job.sourceUrl,
      job.status,
      JSON.stringify(job),
      job.createdAt,
      job.updatedAt,
    )
    .run();

  return job;
}

function parseListingRow(
  row: Pick<ListingRow, "listing_json" | "revision">,
): ListingCandidate | undefined {
  const listing = parseJson<ListingCandidate>(row.listing_json);
  return listing ? { ...listing, revision: Number(row.revision) } : undefined;
}

function serializeListing(listing: ListingCandidate): string {
  const { revision: _revision, ...stored } = listing;
  return JSON.stringify(stored);
}

function readChanges(result: unknown): number {
  if (result && typeof result === "object") {
    const meta = (result as { meta?: { changes?: unknown } }).meta;
    if (typeof meta?.changes === "number") return meta.changes;
  }
  return 0;
}
