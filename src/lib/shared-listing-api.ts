import type { GroupActionRecord } from "./agent-contracts";
import {
  createInviteIdentity,
  createGroupScopedDuplicateKey,
  defaultSearchGroup,
  normalizeUrl,
  updateListingField,
  updateReviewStatus,
  type FieldProvenance,
  type InviteIdentity,
  type ReviewStatus,
} from "./listings";
import { appendGroupAction, upsertRejectedMemory } from "./saved-list-storage";
import {
  appendSharedGroupAction,
  findListingByDuplicateKey,
  readSavedListing,
  readSharedListingSnapshot,
  recordExtractionJob,
  upsertSavedListing,
  upsertSeenRejectedMemoryRecord,
  type D1DatabaseLike,
} from "./shared-listing-store";
import { extractListingFromUrlLive, type SingleLinkExtractionEnv } from "./single-link-extraction";

export type SharedApiEnv = SingleLinkExtractionEnv & { DB?: D1DatabaseLike };
export const allowedInviteCode = defaultSearchGroup.inviteCode;

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
  await upsertSavedListing(db, extraction.listing);
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
    listing: extraction.listing,
    extraction: extraction.extraction,
  };
}

export async function mutateSharedListingStatus({
  db,
  identity,
  listingId,
  status,
}: {
  db: D1DatabaseLike;
  identity: InviteIdentity;
  listingId: string;
  status: ReviewStatus;
}) {
  const listing = await requireListing(db, identity.groupId, listingId);
  const updatedListing = updateReviewStatus(listing, status);
  await upsertSavedListing(db, updatedListing);
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

export async function mutateSharedListingField({
  db,
  identity,
  listingId,
  field,
  value,
}: {
  db: D1DatabaseLike;
  identity: InviteIdentity;
  listingId: string;
  field: FieldProvenance["field"];
  value: string | number;
}) {
  const listing = await requireListing(db, identity.groupId, listingId);
  await upsertSavedListing(db, updateListingField(listing, field, value, identity.displayName));
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

export function parseApiIdentity(body: Record<string, unknown>): InviteIdentity | undefined {
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
  const displayName = typeof body.displayName === "string" ? body.displayName : "Apartment Search";

  if (inviteCode !== allowedInviteCode) {
    return undefined;
  }

  return createInviteIdentity(inviteCode, displayName);
}

export function isAllowedInviteCode(value: unknown): boolean {
  return typeof value === "string" && value.trim() === allowedInviteCode;
}

async function requireListing(db: D1DatabaseLike, groupId: string, listingId: string) {
  const listing = await readSavedListing(db, groupId, listingId);
  if (!listing) throw new Error("listing-not-found");
  return listing;
}
