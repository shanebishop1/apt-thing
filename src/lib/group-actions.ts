import type { GroupActionRecord, SeenRejectedMemoryRecord } from "./agent-contracts";
import type { InviteIdentity, ListingCandidate } from "./listings";

export type ListingGroupActions = {
  comments: GroupActionRecord[];
  reactions: GroupActionRecord[];
  statusChanges: GroupActionRecord[];
  sourceLinkOpens: GroupActionRecord[];
  feedback: GroupActionRecord[];
};

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

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
