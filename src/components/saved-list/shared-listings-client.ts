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

/**
 * The browser's active group session: the server-issued identity plus the user-entered invite
 * code kept in localStorage so an expired HTTP-only session cookie can be re-established.
 */
export type GroupSession = InviteIdentity & { inviteCode: string };

export type SharedListingsApiResponse =
  | {
      ok: true;
      snapshot: SharedListingSnapshot;
      result?: CreateSharedListingResult;
    }
  | { ok: false; error?: string; snapshot?: SharedListingSnapshot; listing?: ListingCandidate };

/** A rejected shared-listing request, carrying the server's current snapshot when it sent one. */
export class SharedListingRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly snapshot?: SharedListingSnapshot,
  ) {
    super(code);
    this.name = "SharedListingRequestError";
  }

  get isStaleListing() {
    return this.code === "listing-revision-conflict" || this.code === "listing-not-found";
  }

  get isRejectedInvite() {
    return this.code === "invalid-invite-code" || this.code === "display-name-required";
  }
}

type RequestOptions = {
  signal?: AbortSignal;
};

type ApiErrorPayload = { ok: false; error?: string; snapshot?: SharedListingSnapshot };

export async function establishGroupSession(
  inviteCode: string,
  displayName: string,
  options: RequestOptions = {},
): Promise<GroupSession> {
  const response = await fetch("/api/group/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ inviteCode, displayName }),
    signal: options.signal,
  });
  const payload = (await response.json()) as
    | { ok: true; identity: InviteIdentity }
    | ApiErrorPayload;
  if (!response.ok || !payload.ok) {
    throw toRequestError(response, payload, "session-create-failed");
  }
  return { ...payload.identity, inviteCode };
}

export async function loadSharedSnapshot(
  session: GroupSession,
  options: RequestOptions = {},
): Promise<SharedListingSnapshot> {
  const response = await sessionFetch(session, "/api/group/listings", {
    signal: options.signal,
  });
  const payload = await readSharedListingsResponse(response, "snapshot-load-failed");
  return payload.snapshot;
}

export async function loadRunHistory(
  session: GroupSession,
  options: RequestOptions = {},
): Promise<PersistedRunHistory> {
  const response = await sessionFetch(session, "/api/group/runs", { signal: options.signal });
  const payload = (await response.json()) as
    | { ok: true; history: PersistedRunHistory }
    | ApiErrorPayload;
  if (!response.ok || !payload.ok) {
    throw toRequestError(response, payload, "run-history-load-failed");
  }
  return payload.history;
}

export async function createSharedListing(
  session: GroupSession,
  url: string,
  options: RequestOptions = {},
): Promise<{
  snapshot: SharedListingSnapshot;
  result?: CreateSharedListingResult;
}> {
  const response = await sessionFetch(session, "/api/group/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: options.signal,
  });
  const payload = await readSharedListingsResponse(response, "create-listing-failed");
  return { snapshot: payload.snapshot, result: payload.result };
}

export async function patchSharedListing(
  session: GroupSession,
  listingId: string,
  mutation: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<SharedListingSnapshot> {
  const response = await sessionFetch(
    session,
    `/api/group/listings/${encodeURIComponent(listingId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation),
      signal: options.signal,
    },
  );
  const payload = await readSharedListingsResponse(response, "listing-mutation-failed");
  return payload.snapshot;
}

export async function postSharedAction(
  session: GroupSession,
  listingId: string,
  action: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<SharedListingSnapshot> {
  const response = await sessionFetch(
    session,
    `/api/group/listings/${encodeURIComponent(listingId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
      signal: options.signal,
    },
  );
  const payload = await readSharedListingsResponse(response, "listing-action-failed");
  return payload.snapshot;
}

/** Sends a same-origin request with the session cookie, re-establishing the session once on 401. */
async function sessionFetch(session: GroupSession, input: string, init: RequestInit) {
  const request = () => fetch(input, { ...init, credentials: "same-origin" });
  const response = await request();
  if (response.status !== 401) return response;

  await establishGroupSession(session.inviteCode, session.displayName, {
    signal: init.signal ?? undefined,
  });
  return request();
}

async function readSharedListingsResponse(
  response: Response,
  fallback: string,
): Promise<Extract<SharedListingsApiResponse, { ok: true }>> {
  const payload = (await response.json()) as SharedListingsApiResponse;
  if (!response.ok || !payload.ok) {
    throw toRequestError(response, payload, fallback);
  }
  return payload;
}

function toRequestError(
  response: Response,
  payload: { ok: boolean; error?: string; snapshot?: SharedListingSnapshot },
  fallback: string,
) {
  return new SharedListingRequestError(
    payload.ok ? fallback : (payload.error ?? fallback),
    response.status,
    payload.ok ? undefined : payload.snapshot,
  );
}
