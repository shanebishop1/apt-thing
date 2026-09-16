import type { GroupActionRecord, SeenRejectedMemoryRecord } from "../../lib/agent-contracts";
import type { InviteIdentity, ListingCandidate } from "../../lib/listings";
import type { PersistedRunHistory } from "../../lib/run-history-store";

export type SharedListingSnapshot = {
  groupId: string;
  listings: ListingCandidate[];
  actions: GroupActionRecord[];
  memory: SeenRejectedMemoryRecord[];
  updatedAt: string;
};

export type CreateSharedListingResult = {
  kind: "created" | "duplicate";
  listing?: ListingCandidate;
  extraction?: {
    ok: boolean;
    failureCode?: string;
  };
};

export type SharedListingsApiResponse =
  | {
      ok: true;
      snapshot: SharedListingSnapshot;
      result?: CreateSharedListingResult;
    }
  | { ok: false; error?: string };

type RequestOptions = {
  signal?: AbortSignal;
};

export async function loadSharedSnapshot(
  identity: InviteIdentity,
  options: RequestOptions = {},
): Promise<SharedListingSnapshot> {
  const response = await fetch(
    `/api/group/listings?groupId=${encodeURIComponent(identity.groupId)}`,
    {
      headers: {
        "X-Invite-Code": identity.inviteCode,
        "X-Display-Name": identity.displayName,
      },
      signal: options.signal,
    },
  );
  const payload = await readSharedListingsResponse(response, "snapshot-load-failed");
  return payload.snapshot;
}

export async function loadRunHistory(
  identity: InviteIdentity,
  options: RequestOptions = {},
): Promise<PersistedRunHistory> {
  const response = await fetch("/api/group/runs", {
    headers: {
      "X-Invite-Code": identity.inviteCode,
      "X-Display-Name": identity.displayName,
    },
    signal: options.signal,
  });
  const payload = (await response.json()) as
    | { ok: true; history: PersistedRunHistory }
    | { ok: false; error?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.ok ? "run-history-load-failed" : (payload.error ?? "run-history-load-failed"),
    );
  }
  return payload.history;
}

export async function createSharedListing(
  identity: InviteIdentity,
  url: string,
  options: RequestOptions = {},
): Promise<{
  snapshot: SharedListingSnapshot;
  result?: CreateSharedListingResult;
}> {
  const response = await fetch("/api/group/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(identityPayload(identity, { url })),
    signal: options.signal,
  });
  const payload = await readSharedListingsResponse(response, "create-listing-failed");
  return { snapshot: payload.snapshot, result: payload.result };
}

export async function patchSharedListing(
  identity: InviteIdentity,
  listingId: string,
  mutation: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<SharedListingSnapshot> {
  const response = await fetch(`/api/group/listings/${encodeURIComponent(listingId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(identityPayload(identity, mutation)),
    signal: options.signal,
  });
  const payload = await readSharedListingsResponse(response, "listing-mutation-failed");
  return payload.snapshot;
}

export async function postSharedAction(
  identity: InviteIdentity,
  listingId: string,
  action: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<SharedListingSnapshot> {
  const response = await fetch(`/api/group/listings/${encodeURIComponent(listingId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(identityPayload(identity, action)),
    signal: options.signal,
  });
  const payload = await readSharedListingsResponse(response, "listing-action-failed");
  return payload.snapshot;
}

function identityPayload(identity: InviteIdentity, payload: Record<string, unknown>) {
  return {
    ...payload,
    inviteCode: identity.inviteCode,
    displayName: identity.displayName,
  };
}

async function readSharedListingsResponse(
  response: Response,
  fallback: string,
): Promise<Extract<SharedListingsApiResponse, { ok: true }>> {
  const payload = (await response.json()) as SharedListingsApiResponse;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? fallback : (payload.error ?? fallback));
  }
  return payload;
}
