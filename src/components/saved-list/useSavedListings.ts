"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GroupActionRecord, SeenRejectedMemoryRecord } from "../../lib/agent-contracts";
import {
  createListingGroupActions,
  createSelectedListingStorageKey,
  findSelectedListing,
  readGroupActions,
  readInviteIdentity,
  readSeenRejectedMemory,
  writeInviteIdentity,
} from "../../lib/saved-list-storage";
import type {
  FieldProvenance,
  InviteIdentity,
  ListingCandidate,
  ReviewStatus,
} from "../../lib/listings";
import {
  createSharedListing,
  loadSharedSnapshot,
  patchSharedListing,
  postSharedAction,
  type SharedListingSnapshot,
} from "./shared-listings-client";
import { useIdentityRequestCoordinator } from "./useIdentityRequestCoordinator";
import {
  defaultIdentityForm,
  invalidIdentityMessage,
  normalizeSharedSnapshot,
  numericFields,
  type IdentityFormState,
} from "./saved-list-state";
import { useSharedSnapshotPolling } from "./useSharedSnapshotPolling";

export { sharedSnapshotPollMs, type IdentityFormState } from "./saved-list-state";

export function useSavedListings() {
  const [identityForm, setIdentityForm] = useState<IdentityFormState>(defaultIdentityForm);
  const [identity, setIdentity] = useState<InviteIdentity>();
  const [listings, setListings] = useState<ListingCandidate[]>([]);
  const [groupActions, setGroupActions] = useState<GroupActionRecord[]>([]);
  const [, setSeenRejectedMemory] = useState<SeenRejectedMemoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [url, setUrl] = useState("");
  const [commentText, setCommentText] = useState("");
  const [message, setMessage] = useState("");
  const [apiBusy, setApiBusy] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const createRequestIdRef = useRef(0);
  const coordinator = useIdentityRequestCoordinator();

  const selectedListing = identity ? findSelectedListing(listings, selectedId) : undefined;
  const selectedActions =
    identity && selectedListing
      ? createListingGroupActions(groupActions, identity.groupId, selectedListing.id)
      : undefined;

  useEffect(() => {
    try {
      const savedIdentity = readInviteIdentity(window.localStorage);

      if (savedIdentity) {
        setIdentityForm({
          inviteCode: savedIdentity.storedIdentity.inviteCode,
          displayName: savedIdentity.storedIdentity.displayName,
        });
      }

      if (savedIdentity?.kind === "invalid") {
        resetIdentity(invalidIdentityMessage);
        return;
      }

      if (!savedIdentity || savedIdentity.kind !== "valid") {
        resetIdentity(
          "Enter the invite code and display name to load this shared apartment search.",
        );
        return;
      }

      const activeIdentity = savedIdentity.identity;
      activateIdentity(activeIdentity);
      setIdentity(activeIdentity);
      hydrateGroupState(activeIdentity);
      refreshSharedSnapshot(activeIdentity, { silent: true });
      setMessage("");
    } catch {
      setMessage("Browser storage is unavailable; using fixture listings for this session.");
    } finally {
      setHasHydrated(true);
    }
  }, []);

  useSharedSnapshotPolling({ hasHydrated, identity, refreshSnapshot: refreshSharedSnapshot });

  function activateIdentity(nextIdentity: InviteIdentity | undefined) {
    if (coordinator.activateIdentity(nextIdentity)) {
      setApiBusy(false);
    }
  }
  function hydrateGroupState(activeIdentity: InviteIdentity) {
    const storage = window.localStorage;
    setGroupActions(readGroupActions(storage, activeIdentity.groupId));
    setSeenRejectedMemory(readSeenRejectedMemory(storage, activeIdentity.groupId));
    setSelectedId(storage.getItem(createSelectedListingStorageKey(activeIdentity.groupId)) ?? "");
  }
  function resetIdentity(nextMessage: string) {
    activateIdentity(undefined);
    setIdentity(undefined);
    setListings([]);
    setGroupActions([]);
    setSeenRejectedMemory([]);
    setSelectedId("");
    setMessage(nextMessage);
  }
  function showRequestError(error: unknown, fallbackMessage: string) {
    setMessage(error instanceof Error ? error.message : fallbackMessage);
  }
  function refreshSharedSnapshot(
    activeIdentity: InviteIdentity,
    options: { silent?: boolean } = {},
  ): Promise<void> {
    return coordinator.execute(
      activeIdentity,
      "load",
      (signal) => loadSharedSnapshot(activeIdentity, { signal }),
      {
        onSuccess: applySharedSnapshot,
        onError: options.silent
          ? undefined
          : (error) => showRequestError(error, "Could not load shared D1 listing state."),
      },
    );
  }
  function createListing(activeIdentity: InviteIdentity, sourceUrl: string, createId: number) {
    void coordinator.execute(
      activeIdentity,
      "mutation",
      (signal) => createSharedListing(activeIdentity, sourceUrl, { signal }),
      {
        onSuccess: (result) => {
          applySharedSnapshot(result.snapshot);
          if (result.result?.listing) setSelectedId(result.result.listing.id);
          setUrl("");
          setMessage(
            result.result?.kind === "duplicate"
              ? "Duplicate listing found. Opening the existing shared record."
              : result.result?.extraction?.ok === false
                ? `Listing saved to D1; extraction needs manual review (${result.result.extraction.failureCode ?? "unknown"}).`
                : "Listing extracted and saved to shared D1 state.",
          );
        },
        onError: (error) => showRequestError(error, "Unable to save this listing right now."),
        onFinally: () => createRequestIdRef.current === createId && setApiBusy(false),
      },
    );
  }
  function mutateListing(
    activeIdentity: InviteIdentity,
    listingId: string,
    payload: Record<string, unknown>,
    successMessage: string,
    kind: "patch" | "action",
    errorMessage: string,
  ) {
    void coordinator.execute(
      activeIdentity,
      "mutation",
      (signal) =>
        kind === "patch"
          ? patchSharedListing(activeIdentity, listingId, payload, { signal })
          : postSharedAction(activeIdentity, listingId, payload, { signal }),
      {
        onSuccess: (snapshot) => {
          applySharedSnapshot(snapshot);
          setMessage(successMessage);
        },
        onError: (error) => showRequestError(error, errorMessage),
      },
    );
  }
  function requireIdentity(errorMessage: string): InviteIdentity | undefined {
    if (identity) return identity;
    setMessage(errorMessage);
    return undefined;
  }
  function submitPatch(
    listingId: string,
    mutation: Record<string, unknown>,
    successMessage: string,
    errorMessage = "Enter a valid invite code before updating group records.",
  ) {
    const activeIdentity = requireIdentity(errorMessage);
    if (activeIdentity)
      mutateListing(
        activeIdentity,
        listingId,
        mutation,
        successMessage,
        "patch",
        "Could not update shared listing.",
      );
  }
  function submitAction(
    listing: ListingCandidate,
    action: Record<string, unknown>,
    successMessage: string,
    errorMessage = "Enter a valid invite code before reacting to group records.",
  ) {
    const activeIdentity = requireIdentity(errorMessage);
    if (activeIdentity)
      mutateListing(
        activeIdentity,
        listing.id,
        action,
        successMessage,
        "action",
        "Could not save shared group action.",
      );
  }
  function applySharedSnapshot(snapshot: SharedListingSnapshot) {
    const normalizedSnapshot = normalizeSharedSnapshot(snapshot);
    setListings(normalizedSnapshot.listings);
    setGroupActions(normalizedSnapshot.actions);
    setSeenRejectedMemory(normalizedSnapshot.memory);
    setSelectedId(
      (currentId) => findSelectedListing(normalizedSnapshot.listings, currentId)?.id ?? "",
    );
  }
  function onIdentityChange(field: keyof IdentityFormState, value: string) {
    setIdentityForm((currentForm) => ({ ...currentForm, [field]: value }));
  }
  function onIdentitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const resolution = writeInviteIdentity(
        window.localStorage,
        identityForm.inviteCode,
        identityForm.displayName,
      );

      if (resolution.kind === "invalid") {
        resetIdentity(invalidIdentityMessage);
        return;
      }

      const groupChanged = identity?.groupId !== resolution.identity.groupId;
      activateIdentity(resolution.identity);
      setIdentity(resolution.identity);

      if (groupChanged) {
        setListings([]);
        hydrateGroupState(resolution.identity);
      }

      refreshSharedSnapshot(resolution.identity, { silent: true });
      setMessage(resolution.feedback);
    } catch {
      setMessage("Could not persist invite identity in this browser session.");
    }
  }
  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identity) {
      setMessage("Enter a valid invite code before saving group records.");
      return;
    }

    const activeIdentity = identity;
    const createId = ++createRequestIdRef.current;
    setApiBusy(true);
    createListing(activeIdentity, url, createId);
  }
  function onListingSelect(listingId: string) {
    setSelectedId(listingId);
  }
  function onStatusChange(listingId: string, status: ReviewStatus) {
    submitPatch(listingId, { mutation: "status", status }, `Status updated to ${status}.`);
  }
  function onReviewDecision(listingId: string, decision: "approve" | "reject") {
    submitPatch(
      listingId,
      { mutation: "review-decision", decision },
      decision === "approve" ? "Review approved." : "Review rejected and removed.",
    );
  }
  function onSourceOpen(listing: ListingCandidate) {
    const activeIdentity = requireIdentity(
      "Enter a valid invite code before opening source links as a group action.",
    );
    if (!activeIdentity) return;
    mutateListing(
      activeIdentity,
      listing.id,
      { actionType: "source-link-open", sourceUrl: listing.url },
      "",
      "action",
      "Could not save shared group action.",
    );
    setMessage("");
  }
  function onReaction(listing: ListingCandidate, reaction: GroupActionRecord["reaction"]) {
    if (!reaction) {
      setMessage("Enter a valid invite code before reacting to group records.");
      return;
    }

    submitAction(listing, { actionType: "reaction", reaction }, "Reaction saved.");
  }
  function onComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identity || !selectedListing) {
      setMessage("Open a listing with a valid invite before commenting.");
      return;
    }

    if (!commentText.trim()) {
      setMessage("Add a comment before saving it to the group review.");
      return;
    }

    mutateListing(
      identity,
      selectedListing.id,
      { actionType: "comment", commentBody: commentText },
      "Comment saved.",
      "action",
      "Could not save shared group action.",
    );
    setCommentText("");
  }
  function onFieldChange(listingId: string, field: FieldProvenance["field"], rawValue: string) {
    if (!identity) {
      setMessage("Enter a valid invite code before editing group records.");
      return;
    }

    const nextValue = numericFields.has(field) ? Number(rawValue) : rawValue;

    if (numericFields.has(field) && (rawValue.trim() === "" || Number.isNaN(nextValue))) {
      setMessage(`${field} must be a number before it can be saved.`);
      return;
    }

    submitPatch(listingId, { mutation: "field", field, value: nextValue }, `Saved ${field}.`);
  }
  function onThemeStorageError() {
    setMessage("Could not persist theme preference in this browser session.");
  }
  useEffect(() => {
    if (!hasHydrated || !identity || !selectedId) return;

    try {
      window.localStorage.setItem(createSelectedListingStorageKey(identity.groupId), selectedId);
    } catch {
      if (coordinator.isCurrentIdentity(identity)) {
        setMessage("Could not remember the currently opened record.");
      }
    }
  }, [hasHydrated, identity, selectedId]);

  return {
    identityForm,
    identity,
    listings,
    groupActions,
    selectedId,
    selectedListing,
    selectedActions,
    url,
    commentText,
    message,
    apiBusy,
    onIdentityChange,
    onIdentitySubmit,
    onCreate,
    onListingSelect,
    onStatusChange,
    onReviewDecision,
    onSourceOpen,
    onReaction,
    onComment,
    onFieldChange,
    onThemeStorageError,
    setUrl,
    setCommentText,
  };
}
