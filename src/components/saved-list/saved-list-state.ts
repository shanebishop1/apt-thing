import type { GroupActionRecord, SeenRejectedMemoryRecord } from "../../lib/agent-contracts";
import type { FieldProvenance, InviteIdentity, ListingCandidate } from "../../lib/listings";
import type { SharedListingSnapshot } from "./shared-listings-client";

export const sharedSnapshotPollMs = 15000;

export const defaultIdentityForm = {
  inviteCode: "",
  displayName: "",
};

export const numericFields = new Set<FieldProvenance["field"]>(["rent", "bedrooms", "bathrooms"]);

export const invalidIdentityMessage = "Invite code or display name is invalid.";

export type IdentityFormState = typeof defaultIdentityForm;

export type NormalizedSharedSnapshot = {
  listings: ListingCandidate[];
  actions: GroupActionRecord[];
  memory: SeenRejectedMemoryRecord[];
};

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
