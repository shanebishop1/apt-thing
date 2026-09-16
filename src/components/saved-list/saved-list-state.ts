import type { GroupActionRecord, SeenRejectedMemoryRecord } from "@/lib/agent-contracts";
import {
  NUMERIC_LISTING_FIELDS,
  type FieldProvenance,
  type InviteIdentity,
  type ListingCandidate,
} from "@/lib/listings";
import type { SharedListingSnapshot } from "./shared-listings-client";

export const sharedSnapshotPollMs = 15000;

export const defaultIdentityForm = {
  inviteCode: "",
  displayName: "",
};

export const numericFields = new Set<FieldProvenance["field"]>(NUMERIC_LISTING_FIELDS);

export const invalidIdentityMessage = "Invite code or display name is invalid.";

export type IdentityFormState = typeof defaultIdentityForm;

const sessionExpiredMessage = "Your session expired. Enter the invite code again.";

/**
 * Plain-language sentences for the kebab-case error codes the API returns. Anything not listed
 * here falls back to the caller's message with the raw code appended, so new server codes stay
 * diagnosable instead of silently disappearing.
 */
const requestErrorMessages: Record<string, string> = {
  "d1-binding-missing": "The shared database is not set up on the server yet.",
  "group-auth-unconfigured": "Invite codes are not set up on the server yet.",
  "authentication-required": sessionExpiredMessage,
  "session-invalid": sessionExpiredMessage,
  "invalid-invite-code": invalidIdentityMessage,
  "display-name-required": invalidIdentityMessage,
  "snapshot-load-failed": "Could not load the shared list. Try again.",
  "create-listing-failed": "Could not add this listing to the shared list. Try again.",
  "listing-mutation-failed": "Could not save that change to the shared list. Try again.",
  "listing-action-failed": "Could not save that to the shared list. Try again.",
  "run-history-load-failed": "Could not load this group's run history. Try again.",
  "session-create-failed": "Could not open the shared list with that invite. Try again.",
  "revision-required": "Reopen this listing and make the change again.",
  "unsupported-mutation": "That change is not supported.",
  "listing-not-found": "That listing is no longer on the shared list.",
  "listing-revision-conflict": "Someone else changed that listing first. Try again.",
};

/**
 * Turns a failed request into something a reviewer can act on. Server-authored sentences (URL
 * validation feedback, for example) are passed through untouched; only kebab-case codes are
 * translated.
 */
export function describeRequestError(error: unknown, fallback: string): string {
  // `fetch` rejects with a TypeError when the request never reaches the server.
  if (error instanceof TypeError) {
    return "Could not reach the server. Check your connection and try again.";
  }

  const message = (
    error instanceof Error ? error.message : typeof error === "string" ? error : ""
  ).trim();

  if (!message) return fallback;
  if (!isRequestErrorCode(message)) return message;

  return requestErrorMessages[message] ?? `${fallback} (${message})`;
}

function isRequestErrorCode(message: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(message);
}

export type NormalizedSharedSnapshot = {
  listings: ListingCandidate[];
  actions: GroupActionRecord[];
  memory: SeenRejectedMemoryRecord[];
};

export function findSelectedListing(
  listings: ListingCandidate[],
  selectedId?: string | null,
): ListingCandidate | undefined {
  return listings.find((listing) => listing.id === selectedId) ?? listings[0];
}

export function getIdentityKey(identity: InviteIdentity & { inviteCode?: string }): string {
  return [
    identity.groupId,
    identity.inviteCode ?? "",
    identity.displayName,
    identity.identityToken,
  ].join("\u0000");
}

export function normalizeSharedSnapshot(snapshot: SharedListingSnapshot): NormalizedSharedSnapshot {
  return {
    listings: snapshot.listings.map(normalizeReviewNeededListing),
    actions: snapshot.actions,
    memory: snapshot.memory,
  };
}

function normalizeReviewNeededListing(listing: ListingCandidate): ListingCandidate {
  if (listing.triageBucket !== "review-needed" || listing.reviewStatus === "rejected") {
    return listing;
  }

  if (listing.reviewStatus === "review") {
    return listing;
  }

  return {
    ...listing,
    reviewStatus: "review",
    display: {
      ...listing.display,
      reviewStatus: "review",
    },
  };
}
