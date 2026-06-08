import { fixtureBatchRun, fixtureListings } from "./fixtures";
import {
  INVITE_IDENTITY_STORAGE_KEY,
  createInviteIdentity,
  defaultSearchGroup,
  intakePastedListingUrl,
  resolveSearchGroupInvite,
  updateListingField,
  updateReviewStatus,
  type FieldProvenance,
  type InviteIdentity,
  type ListingCandidate,
  type ReviewStatus,
  type StreetEasyBatchRun,
} from "./listings";
import type { GroupActionRecord, SeenRejectedMemoryRecord } from "./agent-contracts";

export const SAVED_LIST_STORAGE_VERSION = "v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SavedListingsEnvelope = {
  version: typeof SAVED_LIST_STORAGE_VERSION;
  groupId: string;
  listings: ListingCandidate[];
  updatedAt: string;
};

export type GroupActionsEnvelope = {
  version: typeof SAVED_LIST_STORAGE_VERSION;
  groupId: string;
  actions: GroupActionRecord[];
  updatedAt: string;
};

export type SeenRejectedMemoryEnvelope = {
  version: typeof SAVED_LIST_STORAGE_VERSION;
  groupId: string;
  memory: SeenRejectedMemoryRecord[];
  updatedAt: string;
};

export type ListingGroupActions = {
  comments: GroupActionRecord[];
  reactions: GroupActionRecord[];
  statusChanges: GroupActionRecord[];
  sourceLinkOpens: GroupActionRecord[];
  feedback: GroupActionRecord[];
};

export type StoredInviteIdentity = {
  version: typeof SAVED_LIST_STORAGE_VERSION;
  inviteCode: string;
  displayName: string;
  groupId?: string;
  persistedIn: "localStorage";
  storageKey: typeof INVITE_IDENTITY_STORAGE_KEY;
  updatedAt: string;
};

export type InviteIdentityResolution =
  | {
      kind: "valid";
      identity: InviteIdentity;
      storedIdentity: StoredInviteIdentity;
      feedback: string;
    }
  | {
      kind: "invalid";
      storedIdentity: StoredInviteIdentity;
      feedback: string;
    };

export type SavedListingCreateResult =
  | {
      kind: "created";
      listing: ListingCandidate;
      listings: ListingCandidate[];
      feedback: string;
    }
  | {
      kind: "duplicate";
      listing: ListingCandidate;
      listings: ListingCandidate[];
      feedback: string;
    }
  | {
      kind: "rejected";
      listings: ListingCandidate[];
      feedback: string;
    };

export type ReviewBatchRunSummary = Pick<
  StreetEasyBatchRun,
  "id" | "cadence" | "status" | "counts" | "maxImagesPerListing" | "startedAt" | "completedAt"
>;

export type ReviewDashboardCounts = {
  total: number;
  currentMatches: number;
  reviewNeededBatch: number;
  userQualifiedPasted: number;
  history: number;
  active: number;
  touring: number;
  manualNeeded: number;
  skippedSeen: number;
  skippedTriaged: number;
  candidatesFound: number;
  candidatesSaved: number;
};

export type ReviewDashboardModel = {
  counts: ReviewDashboardCounts;
  batchRun?: ReviewBatchRunSummary;
  currentMatches: ListingCandidate[];
  reviewNeededBatch: ListingCandidate[];
  userQualifiedPasted: ListingCandidate[];
  history: ListingCandidate[];
};

export function createSavedListingsStorageKey(groupId: string): string {
  return `apt-thing:${SAVED_LIST_STORAGE_VERSION}:groups:${groupId}:saved-listings`;
}

export function createSelectedListingStorageKey(groupId: string): string {
  return `apt-thing:${SAVED_LIST_STORAGE_VERSION}:groups:${groupId}:selected-listing`;
}

export function createGroupActionsStorageKey(groupId: string): string {
  return `apt-thing:${SAVED_LIST_STORAGE_VERSION}:groups:${groupId}:group-actions`;
}

export function createSeenRejectedMemoryStorageKey(groupId: string): string {
  return `apt-thing:${SAVED_LIST_STORAGE_VERSION}:groups:${groupId}:seen-rejected-memory`;
}

export function resolveStoredInviteIdentity(
  inviteCode: string,
  displayName: string,
): InviteIdentityResolution {
  const normalizedInviteCode = inviteCode.trim();
  const normalizedDisplayName = displayName.trim();
  const inviteResolution = resolveSearchGroupInvite(normalizedInviteCode);
  const group = inviteResolution.status === "valid" ? inviteResolution.group : undefined;
  const resolvedInviteCode =
    inviteResolution.status === "valid" ? inviteResolution.inviteCode : normalizedInviteCode;
  const identity = createInviteIdentity(resolvedInviteCode, normalizedDisplayName);
  const storedIdentity: StoredInviteIdentity = {
    version: SAVED_LIST_STORAGE_VERSION,
    inviteCode: resolvedInviteCode,
    displayName: normalizedDisplayName,
    groupId: group?.id,
    persistedIn: "localStorage",
    storageKey: INVITE_IDENTITY_STORAGE_KEY,
    updatedAt: new Date().toISOString(),
  };

  if (!identity) {
    return {
      kind: "invalid",
      storedIdentity,
      feedback: group
        ? "Enter a display name before saving group records."
        : "Enter a valid invite code before saving group records.",
    };
  }

  return {
    kind: "valid",
    identity,
    storedIdentity: {
      ...storedIdentity,
      groupId: identity.groupId,
    },
    feedback: `Invite identity saved for ${identity.displayName}.`,
  };
}

export function readInviteIdentity(storage: StorageLike): InviteIdentityResolution | undefined {
  try {
    const storedIdentity = storage.getItem(INVITE_IDENTITY_STORAGE_KEY);

    if (!storedIdentity) {
      return undefined;
    }

    const parsedIdentity = JSON.parse(storedIdentity) as Partial<StoredInviteIdentity>;

    if (
      typeof parsedIdentity.inviteCode !== "string" ||
      typeof parsedIdentity.displayName !== "string"
    ) {
      return undefined;
    }

    return resolveStoredInviteIdentity(parsedIdentity.inviteCode, parsedIdentity.displayName);
  } catch {
    return undefined;
  }
}

export function writeInviteIdentity(
  storage: StorageLike,
  inviteCode: string,
  displayName: string,
): InviteIdentityResolution {
  const resolution = resolveStoredInviteIdentity(inviteCode, displayName);

  try {
    storage.setItem(INVITE_IDENTITY_STORAGE_KEY, JSON.stringify(resolution.storedIdentity));
  } catch {
    return resolution;
  }

  return resolution;
}

export function getFixtureListingsForGroup(groupId = defaultSearchGroup.id): ListingCandidate[] {
  return fixtureListings.filter((listing) => listing.groupId === groupId);
}

export function getFixtureBatchRunSummary(): ReviewBatchRunSummary {
  return toReviewBatchRunSummary(fixtureBatchRun);
}

export function readSavedListings(
  storage: StorageLike,
  groupId: string,
  fallbackListings = getFixtureListingsForGroup(groupId),
): ListingCandidate[] {
  const storedEnvelope = storage.getItem(createSavedListingsStorageKey(groupId));

  if (!storedEnvelope) {
    return fallbackListings;
  }

  try {
    const parsedEnvelope = JSON.parse(storedEnvelope) as Partial<SavedListingsEnvelope>;

    if (parsedEnvelope.groupId !== groupId || !Array.isArray(parsedEnvelope.listings)) {
      return fallbackListings;
    }

    return parsedEnvelope.listings
      .filter((listing) => listing.groupId === groupId)
      .map(upgradePersistedFixturePhotos);
  } catch {
    return fallbackListings;
  }
}

export function writeSavedListings(
  storage: StorageLike,
  groupId: string,
  listings: ListingCandidate[],
): SavedListingsEnvelope {
  const envelope: SavedListingsEnvelope = {
    version: SAVED_LIST_STORAGE_VERSION,
    groupId,
    listings: listings.filter((listing) => listing.groupId === groupId),
    updatedAt: new Date().toISOString(),
  };

  storage.setItem(createSavedListingsStorageKey(groupId), JSON.stringify(envelope));

  return envelope;
}

export function readGroupActions(storage: StorageLike, groupId: string): GroupActionRecord[] {
  const storedEnvelope = storage.getItem(createGroupActionsStorageKey(groupId));

  if (!storedEnvelope) {
    return [];
  }

  try {
    const parsedEnvelope = JSON.parse(storedEnvelope) as Partial<GroupActionsEnvelope>;

    if (parsedEnvelope.groupId !== groupId || !Array.isArray(parsedEnvelope.actions)) {
      return [];
    }

    return parsedEnvelope.actions.filter((action) => action.groupId === groupId);
  } catch {
    return [];
  }
}

export function readSeenRejectedMemory(
  storage: StorageLike,
  groupId: string,
): SeenRejectedMemoryRecord[] {
  const storedEnvelope = storage.getItem(createSeenRejectedMemoryStorageKey(groupId));

  if (!storedEnvelope) {
    return [];
  }

  try {
    const parsedEnvelope = JSON.parse(storedEnvelope) as Partial<SeenRejectedMemoryEnvelope>;

    if (parsedEnvelope.groupId !== groupId || !Array.isArray(parsedEnvelope.memory)) {
      return [];
    }

    return parsedEnvelope.memory.filter((record) => record.groupId === groupId);
  } catch {
    return [];
  }
}

export function writeSeenRejectedMemory(
  storage: StorageLike,
  groupId: string,
  memory: SeenRejectedMemoryRecord[],
): SeenRejectedMemoryEnvelope {
  const envelope: SeenRejectedMemoryEnvelope = {
    version: SAVED_LIST_STORAGE_VERSION,
    groupId,
    memory: memory.filter((record) => record.groupId === groupId),
    updatedAt: new Date().toISOString(),
  };

  storage.setItem(createSeenRejectedMemoryStorageKey(groupId), JSON.stringify(envelope));

  return envelope;
}

export function writeGroupActions(
  storage: StorageLike,
  groupId: string,
  actions: GroupActionRecord[],
): GroupActionsEnvelope {
  const envelope: GroupActionsEnvelope = {
    version: SAVED_LIST_STORAGE_VERSION,
    groupId,
    actions: actions.filter((action) => action.groupId === groupId),
    updatedAt: new Date().toISOString(),
  };

  storage.setItem(createGroupActionsStorageKey(groupId), JSON.stringify(envelope));

  return envelope;
}

export function createListingGroupActions(
  actions: GroupActionRecord[],
  groupId: string,
  listingId: string,
): ListingGroupActions {
  const listingActions = actions.filter(
    (action) => action.groupId === groupId && action.listingId === listingId,
  );
  const reactions = dedupeCurrentReactions(
    listingActions.filter((action) => action.actionType === "reaction"),
  );

  return {
    comments: listingActions.filter((action) => action.actionType === "comment"),
    reactions,
    statusChanges: listingActions.filter((action) => action.actionType === "status-change"),
    sourceLinkOpens: listingActions.filter((action) => action.actionType === "source-link-open"),
    feedback: listingActions.filter((action) => action.actionType === "feedback"),
  };
}

export function appendGroupAction(
  actions: GroupActionRecord[],
  identity: InviteIdentity,
  listing: ListingCandidate,
  action: Pick<
    GroupActionRecord,
    "actionType" | "commentBody" | "reaction" | "status" | "sourceUrl" | "feedback"
  >,
): GroupActionRecord[] {
  if (identity.groupId !== listing.groupId) {
    return actions;
  }

  const createdAt = new Date().toISOString();
  const actionRecord: GroupActionRecord = {
    id: createGroupActionId(
      identity.groupId,
      listing.id,
      action.actionType,
      createdAt,
      actions.length,
    ),
    contract: "group-action-v1",
    groupId: identity.groupId,
    listingId: listing.id,
    actorDisplayName: identity.displayName,
    actorIdentityToken: identity.identityToken,
    actor: {
      displayName: identity.displayName,
      identityToken: identity.identityToken,
    },
    actionType: action.actionType,
    commentBody: normalizeOptionalText(action.commentBody),
    reaction: action.reaction,
    status: action.status,
    sourceUrl: action.sourceUrl ?? listing.url,
    provenance: createActionProvenance(action.actionType, listing),
    feedback: action.feedback,
    createdAt,
  };

  const remainingActions =
    action.actionType === "reaction"
      ? actions.filter(
          (record) =>
            !isSameUserListingReaction(
              record,
              identity.groupId,
              listing.id,
              identity.identityToken,
            ),
        )
      : actions;

  return [actionRecord, ...remainingActions].filter(
    (record) => record.groupId === identity.groupId,
  );
}

function dedupeCurrentReactions(reactions: GroupActionRecord[]): GroupActionRecord[] {
  const seenActors = new Set<string>();

  return reactions.filter((reaction) => {
    const actorKey = createReactionActorKey(reaction.actorIdentityToken, reaction.actorDisplayName);

    if (seenActors.has(actorKey)) {
      return false;
    }

    seenActors.add(actorKey);
    return true;
  });
}

function isSameUserListingReaction(
  record: GroupActionRecord,
  groupId: string,
  listingId: string,
  identityToken: string,
): boolean {
  return (
    record.actionType === "reaction" &&
    record.groupId === groupId &&
    record.listingId === listingId &&
    record.actorIdentityToken === identityToken
  );
}

function createReactionActorKey(identityToken?: string, displayName?: string): string {
  return identityToken ?? `display:${displayName ?? "unknown"}`;
}

export function clearSavedListings(storage: StorageLike, groupId: string): void {
  storage.removeItem(createSavedListingsStorageKey(groupId));
  storage.removeItem(createSelectedListingStorageKey(groupId));
  storage.removeItem(createGroupActionsStorageKey(groupId));
  storage.removeItem(createSeenRejectedMemoryStorageKey(groupId));
}

export function createSavedListing(
  listings: ListingCandidate[],
  rawUrl: string,
  identity?: InviteIdentity,
): SavedListingCreateResult {
  const validatedIdentity = identity
    ? createInviteIdentity(identity.inviteCode, identity.displayName)
    : undefined;

  if (!identity || !validatedIdentity || validatedIdentity.groupId !== identity.groupId) {
    return {
      kind: "rejected",
      listings,
      feedback: "Enter a valid invite code before saving group records.",
    };
  }

  const intakeResult = intakePastedListingUrl({
    rawUrl,
    identity: validatedIdentity,
    existingListings: listings.filter((listing) => listing.groupId === validatedIdentity.groupId),
  });

  if (intakeResult.status === "rejected") {
    return {
      kind: "rejected",
      listings,
      feedback: intakeResult.feedback,
    };
  }

  if (intakeResult.status === "duplicate") {
    return {
      kind: "duplicate",
      listing: intakeResult.existingListing,
      listings,
      feedback: intakeResult.feedback,
    };
  }

  return {
    kind: "created",
    listing: intakeResult.listing,
    listings: [intakeResult.listing, ...listings],
    feedback: intakeResult.feedback,
  };
}

export function updateSavedListingStatus(
  listings: ListingCandidate[],
  groupId: string,
  listingId: string,
  status: ReviewStatus,
): ListingCandidate[] {
  return listings.map((listing) =>
    listing.groupId === groupId && listing.id === listingId
      ? updateReviewStatus(listing, status)
      : listing,
  );
}

export function upsertRejectedMemory(
  memory: SeenRejectedMemoryRecord[],
  listing: ListingCandidate,
  reason: string,
): SeenRejectedMemoryRecord[] {
  if (listing.reviewStatus !== "rejected") {
    return memory;
  }

  const nextRecord: SeenRejectedMemoryRecord = {
    id: `seen-rejected-${hashString(`${listing.groupId}:${listing.url}`)}`,
    contract: "seen-rejected-memory-v1",
    groupId: listing.groupId,
    sourceUrl: listing.url,
    duplicateKey: listing.duplicateKey,
    groupScopedDuplicateKey: listing.groupScopedDuplicateKey,
    memoryState: "rejected",
    reason,
    lastSeenAt: new Date().toISOString(),
  };

  return [nextRecord, ...memory.filter((record) => record.id !== nextRecord.id)].filter(
    (record) => record.groupId === listing.groupId,
  );
}

function createActionProvenance(
  actionType: GroupActionRecord["actionType"],
  listing: ListingCandidate,
): GroupActionRecord["provenance"] {
  if (actionType === "source-link-open") {
    return {
      source: "original-listing-source-link",
      visibleToGroup: true,
      evidencePointerIds: listing.evidencePointers.map((pointer) => pointer.id),
    };
  }

  if (actionType === "feedback") {
    return {
      source: "evidence-feedback",
      visibleToGroup: true,
      evidencePointerIds: listing.evidencePointers.map((pointer) => pointer.id),
    };
  }

  return {
    source: actionType === "status-change" ? "shared-status-control" : "user-entered",
    visibleToGroup: true,
  };
}

function createGroupActionId(
  groupId: string,
  listingId: string,
  actionType: GroupActionRecord["actionType"],
  createdAt: string,
  index: number,
): string {
  return `group-action-${hashString(`${groupId}:${listingId}:${actionType}:${createdAt}:${index}`)}`;
}

function normalizeOptionalText(value?: string): string | undefined {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function upgradePersistedFixturePhotos(listing: ListingCandidate): ListingCandidate {
  if (
    !listing.photos.some((photoUrl) => photoUrl.startsWith("https://fixtures.test/streeteasy/"))
  ) {
    return listing;
  }

  const fixtureListing = fixtureListings.find(
    (candidate) => candidate.groupId === listing.groupId && candidate.url === listing.url,
  );

  if (!fixtureListing || fixtureListing.photos.length === 0) {
    return listing;
  }

  return {
    ...listing,
    photos: fixtureListing.photos,
    imageEvidence: fixtureListing.imageEvidence,
  };
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

export function updateSavedListingField(
  listings: ListingCandidate[],
  groupId: string,
  listingId: string,
  field: FieldProvenance["field"],
  value: string | number,
  actorDisplayName: string,
): ListingCandidate[] {
  return listings.map((listing) =>
    listing.groupId === groupId && listing.id === listingId
      ? updateListingField(listing, field, value, actorDisplayName)
      : listing,
  );
}

export function findSelectedListing(
  listings: ListingCandidate[],
  selectedId?: string | null,
): ListingCandidate | undefined {
  return listings.find((listing) => listing.id === selectedId) ?? listings[0];
}

export function sortSavedListingsForDashboard(listings: ListingCandidate[]): ListingCandidate[] {
  const sectionRank = new Map<string, number>();
  const model = createReviewDashboardModel(listings);

  for (const [rank, section] of [
    model.currentMatches,
    model.reviewNeededBatch,
    model.userQualifiedPasted,
    model.history,
  ].entries()) {
    for (const listing of section) {
      sectionRank.set(listing.id, rank);
    }
  }

  return [...listings].sort((a, b) => {
    const rankDelta = (sectionRank.get(a.id) ?? 99) - (sectionRank.get(b.id) ?? 99);

    if (rankDelta !== 0) {
      return rankDelta;
    }

    return compareActionableListings(a, b);
  });
}

export function createReviewDashboardModel(
  listings: ListingCandidate[],
  batchRun?: ReviewBatchRunSummary,
): ReviewDashboardModel {
  const seenListingIds = new Set<string>();
  const currentMatches = sortDashboardSection(
    listings.filter((listing) => isCurrentMatch(listing) && markSeen(seenListingIds, listing.id)),
  );
  const reviewNeededBatch = sortDashboardSection(
    listings.filter(
      (listing) =>
        !seenListingIds.has(listing.id) &&
        isBatchListing(listing) &&
        listing.triageBucket === "review-needed" &&
        listing.reviewStatus !== "rejected" &&
        markSeen(seenListingIds, listing.id),
    ),
  );
  const userQualifiedPasted = sortDashboardSection(
    listings.filter(
      (listing) =>
        !seenListingIds.has(listing.id) &&
        listing.userQualified &&
        !isBatchListing(listing) &&
        markSeen(seenListingIds, listing.id),
    ),
  );
  const history = sortDashboardSection(
    listings.filter(
      (listing) => !seenListingIds.has(listing.id) && markSeen(seenListingIds, listing.id),
    ),
  );
  const counts: ReviewDashboardCounts = {
    total: listings.length,
    currentMatches: currentMatches.length,
    reviewNeededBatch: reviewNeededBatch.length,
    userQualifiedPasted: userQualifiedPasted.length,
    history: history.length,
    active: listings.filter(
      (listing) => listing.reviewStatus !== "rejected" && listing.reviewStatus !== "unavailable",
    ).length,
    touring: listings.filter((listing) => listing.reviewStatus === "touring").length,
    manualNeeded: listings.filter((listing) => listing.extractionStatus === "manual-needed").length,
    skippedSeen: batchRun?.counts.candidatesSkippedSeen ?? 0,
    skippedTriaged: batchRun?.counts.candidatesSkippedTriaged ?? 0,
    candidatesFound: batchRun?.counts.candidatesFound ?? 0,
    candidatesSaved: batchRun?.counts.candidatesSaved ?? 0,
  };

  return {
    counts,
    batchRun,
    currentMatches,
    reviewNeededBatch,
    userQualifiedPasted,
    history,
  };
}

function toReviewBatchRunSummary(run: StreetEasyBatchRun): ReviewBatchRunSummary {
  return {
    id: run.id,
    cadence: run.cadence,
    status: run.status,
    counts: run.counts,
    maxImagesPerListing: run.maxImagesPerListing,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

function isCurrentMatch(listing: ListingCandidate): boolean {
  return (
    listing.reviewStatus !== "rejected" &&
    listing.reviewStatus !== "unavailable" &&
    listing.triageBucket === "confirmed-match"
  );
}

function isBatchListing(listing: ListingCandidate): boolean {
  return listing.providerRoute === "streeteasy-realtyapi-batch-search";
}

function markSeen(seenListingIds: Set<string>, listingId: string): boolean {
  seenListingIds.add(listingId);
  return true;
}

function sortDashboardSection(listings: ListingCandidate[]): ListingCandidate[] {
  return [...listings].sort(compareActionableListings);
}

function compareActionableListings(a: ListingCandidate, b: ListingCandidate): number {
  const statusRank: Record<ReviewStatus, number> = {
    touring: 0,
    interested: 1,
    new: 2,
    unavailable: 3,
    rejected: 4,
  };
  const statusDelta = statusRank[a.reviewStatus] - statusRank[b.reviewStatus];

  if (statusDelta !== 0) {
    return statusDelta;
  }

  const updatedDelta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  return a.title.localeCompare(b.title);
}
