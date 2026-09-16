import type { GroupActionRecord } from "./agent-contracts";
import {
  createGroupScopedDuplicateKey,
  normalizeUrl,
  updateListingField,
  updateReviewStatus,
  type FieldProvenance,
  type InviteIdentity,
  type ListingCandidate,
  type ReviewStatus,
} from "./listings";
import { appendGroupAction, upsertRejectedMemory } from "./group-actions";
import {
  appendSharedGroupAction,
  deleteSavedListingAtRevision,
  findListingByDuplicateKey,
  insertSavedListing,
  readSavedListing,
  readSharedListingSnapshot,
  recordExtractionJob,
  updateSavedListingAtRevision,
  upsertSeenRejectedMemoryRecord,
  type ConditionalWriteResult,
  type D1DatabaseLike,
} from "./shared-listing-store";
import { extractListingFromUrlLive, type SingleLinkExtractionEnv } from "./single-link-extraction";

export type SharedApiEnv = SingleLinkExtractionEnv & { DB?: D1DatabaseLike };

export type ListingMutationErrorCode = "listing-not-found" | "listing-revision-conflict";

export class ListingMutationError extends Error {
  readonly status: 404 | 409;

  constructor(
    readonly code: ListingMutationErrorCode,
    readonly current?: ListingCandidate,
  ) {
    super(code);
    this.name = "ListingMutationError";
    this.status = code === "listing-not-found" ? 404 : 409;
  }
}

export function parseExpectedRevision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

export async function createListingFromSharedApi({
  db,
  rawUrl,
  identity,
  env,
}: {
  db: D1DatabaseLike;
  rawUrl: string;
  identity: InviteIdentity;
  env?: SharedApiEnv;
}) {
  const normalizedUrl = normalizeUrl(rawUrl);
  const duplicateKey = createGroupScopedDuplicateKey(identity.groupId, normalizedUrl);
  const existingListing = await findListingByDuplicateKey(db, identity.groupId, duplicateKey);
  if (existingListing) {
    return { kind: "duplicate" as const, listing: existingListing };
  }

  const extraction = await extractListingFromUrlLive({ rawUrl: normalizedUrl, identity, env });
  if (extraction.listing.groupScopedDuplicateKey !== duplicateKey) {
    const canonicalExistingListing = await findListingByDuplicateKey(
      db,
      identity.groupId,
      extraction.listing.groupScopedDuplicateKey,
    );
    if (canonicalExistingListing) {
      return { kind: "duplicate" as const, listing: canonicalExistingListing };
    }
  }
  const inserted = await insertSavedListing(db, extraction.listing);
  if (inserted.kind === "duplicate") {
    return { kind: "duplicate" as const, listing: inserted.listing };
  }
  await recordExtractionJob(db, {
    id: `extraction-${extraction.listing.id}-${Date.now()}`,
    groupId: identity.groupId,
    listingId: extraction.listing.id,
    sourceUrl: normalizedUrl,
    status: extraction.listing.extractionStatus,
    provider: extraction.extraction.providerCalled ? "google-direct" : undefined,
    model: extraction.extraction.providerCalled ? "gemini-3.5-flash" : undefined,
    failureCode: extraction.extraction.failureCode,
    failureMessage: extraction.extraction.failureMessage,
    createdAt: extraction.listing.createdAt,
    updatedAt: extraction.listing.updatedAt,
  });

  return {
    kind: "created" as const,
    listing: inserted.listing,
    extraction: extraction.extraction,
  };
}

export async function mutateSharedListingStatus({
  db,
  identity,
  listingId,
  status,
  expectedRevision,
}: {
  db: D1DatabaseLike;
  identity: InviteIdentity;
  listingId: string;
  status: ReviewStatus;
  expectedRevision: number;
}) {
  const listing = await requireListing(db, identity.groupId, listingId);
  const updatedListing = updateReviewStatus(listing, status);
  requireWritten(await updateSavedListingAtRevision(db, updatedListing, expectedRevision));
  const action = appendGroupAction([], identity, listing, {
    actionType: "status-change",
    status,
  })[0];
  if (action) await appendSharedGroupAction(db, action);
  if (updatedListing.reviewStatus === "rejected") {
    const memory = upsertRejectedMemory(
      [],
      updatedListing,
      `Rejected by ${identity.displayName}`,
    )[0];
    if (memory) await upsertSeenRejectedMemoryRecord(db, memory);
  }
  return readSharedListingSnapshot(db, identity.groupId);
}

export async function mutateSharedListingReviewDecision({
  db,
  identity,
  listingId,
  decision,
  expectedRevision,
}: {
  db: D1DatabaseLike;
  identity: InviteIdentity;
  listingId: string;
  decision: "approve" | "reject";
  expectedRevision: number;
}) {
  if (decision === "approve") {
    const listing = await requireListing(db, identity.groupId, listingId);
    const approvedListing = updateReviewStatus(
      { ...listing, triageBucket: "confirmed-match" },
      "new",
    );
    requireWritten(await updateSavedListingAtRevision(db, approvedListing, expectedRevision));
    const action = appendGroupAction([], identity, listing, {
      actionType: "status-change",
      status: "new",
    })[0];
    if (action) await appendSharedGroupAction(db, action);
    return readSharedListingSnapshot(db, identity.groupId);
  }

  const listing = requireWritten(
    await deleteSavedListingAtRevision(db, identity.groupId, listingId, expectedRevision),
  );
  const memory = upsertRejectedMemory(
    [],
    updateReviewStatus(listing, "rejected"),
    [`Rejected from review by ${identity.displayName}`, ...listing.concerns][0]!,
  )[0];
  if (memory) await upsertSeenRejectedMemoryRecord(db, memory);
  return readSharedListingSnapshot(db, identity.groupId);
}

export async function mutateSharedListingField({
  db,
  identity,
  listingId,
  field,
  value,
  expectedRevision,
}: {
  db: D1DatabaseLike;
  identity: InviteIdentity;
  listingId: string;
  field: FieldProvenance["field"];
  value: string | number;
  expectedRevision: number;
}) {
  const listing = await requireListing(db, identity.groupId, listingId);
  requireWritten(
    await updateSavedListingAtRevision(
      db,
      updateListingField(listing, field, value, identity.displayName),
      expectedRevision,
    ),
  );
  return readSharedListingSnapshot(db, identity.groupId);
}

export async function appendSharedAction({
  db,
  identity,
  listingId,
  action,
}: {
  db: D1DatabaseLike;
  identity: InviteIdentity;
  listingId: string;
  action: Pick<
    GroupActionRecord,
    "actionType" | "commentBody" | "reaction" | "sourceUrl" | "feedback"
  >;
}) {
  const listing = await requireListing(db, identity.groupId, listingId);
  const actionRecord = appendGroupAction([], identity, listing, action)[0];
  if (actionRecord) await appendSharedGroupAction(db, actionRecord);
  return readSharedListingSnapshot(db, identity.groupId);
}

async function requireListing(db: D1DatabaseLike, groupId: string, listingId: string) {
  const listing = await readSavedListing(db, groupId, listingId);
  if (!listing) throw new ListingMutationError("listing-not-found");
  return listing;
}

function requireWritten(result: ConditionalWriteResult): ListingCandidate {
  if (result.ok) return result.listing;
  throw result.reason === "not-found"
    ? new ListingMutationError("listing-not-found")
    : new ListingMutationError("listing-revision-conflict", result.current);
}
