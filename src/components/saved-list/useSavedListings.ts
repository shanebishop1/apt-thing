"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GroupActionRecord, SeenRejectedMemoryRecord } from "../../lib/agent-contracts";
import {
  createListingGroupActions,
  createSelectedListingStorageKey,
  findSelectedListing,
  normalizeInviteIdentityInput,
  readGroupActions,
  readSeenRejectedMemory,
  readStoredInviteIdentity,
  writeStoredInviteIdentity,
} from "../../lib/saved-list-storage";
import type { FieldProvenance, ListingCandidate, ReviewStatus } from "../../lib/listings";
import {
  createSharedListing,
  establishGroupSession,
  loadSharedSnapshot,
  patchSharedListing,
  postSharedAction,
  SharedListingRequestError,
  type GroupSession,
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
  const [identity, setIdentity] = useState<GroupSession>();
  const [listings, setListings] = useState<ListingCandidate[]>([]);
  const [groupActions, setGroupActions] = useState<GroupActionRecord[]>([]);
  const [, setSeenRejectedMemory] = useState<SeenRejectedMemoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [url, setUrl] = useState("");
  const [commentText, setCommentText] = useState("");
  const [message, setMessage] = useState("");
  const [listingNotice, setListingNotice] = useState("");
  const [apiBusy, setApiBusy] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const createRequestIdRef = useRef(0);
  const listingsRef = useRef<ListingCandidate[]>([]);
  const identityRef = useRef<GroupSession | undefined>(undefined);
  const sessionRequestIdRef = useRef(0);
  const coordinator = useIdentityRequestCoordinator();

  const selectedListing = identity ? findSelectedListing(listings, selectedId) : undefined;
  const selectedActions =
    identity && selectedListing
      ? createListingGroupActions(groupActions, identity.groupId, selectedListing.id)
      : undefined;

  useEffect(() => {
    try {
      const storedIdentity = readStoredInviteIdentity(window.localStorage);

      if (!storedIdentity) {
        resetIdentity(
          "Enter the invite code and display name to load this shared apartment search.",
        );
        return;
      }

      setIdentityForm({
        inviteCode: storedIdentity.inviteCode,
        displayName: storedIdentity.displayName,
      });
      startSession(storedIdentity.inviteCode, storedIdentity.displayName, { restoring: true });
    } catch {
      setMessage("Browser storage is unavailable; enter the invite code to continue.");
    } finally {
      setHasHydrated(true);
    }
  }, []);

  useSharedSnapshotPolling({ hasHydrated, identity, refreshSnapshot: refreshSharedSnapshot });

  function startSession(
    inviteCode: string,
    displayName: string,
    { restoring }: { restoring: boolean },
  ) {
    const requestId = ++sessionRequestIdRef.current;
    setMessage(restoring ? "Connecting to the shared list…" : "Checking invite…");

    establishGroupSession(inviteCode, displayName).then(
      (session) => {
        if (requestId !== sessionRequestIdRef.current) return;
        const groupChanged = identityRef.current?.groupId !== session.groupId;
        activateIdentity(session);
        identityRef.current = session;
        setIdentity(session);

        if (groupChanged) {
          listingsRef.current = [];
          setListings([]);
          hydrateGroupState(session);
        }

        refreshSharedSnapshot(session, { silent: true });
        try {
          writeStoredInviteIdentity(window.localStorage, {
            inviteCode,
            displayName: session.displayName,
            groupId: session.groupId,
          });
          setMessage(restoring ? "" : `Invite identity saved for ${session.displayName}.`);
        } catch {
          setMessage("Could not persist invite identity in this browser session.");
        }
      },
      (error: unknown) => {
        if (requestId !== sessionRequestIdRef.current) return;
        if (error instanceof SharedListingRequestError && error.isRejectedInvite) {
          resetIdentity(invalidIdentityMessage);
          return;
        }
        setMessage(
          `Could not reach the shared list service (${error instanceof Error ? error.message : "network-error"}). Try again.`,
        );
      },
    );
  }
  function activateIdentity(nextIdentity: GroupSession | undefined) {
    if (coordinator.activateIdentity(nextIdentity)) {
      setApiBusy(false);
    }
  }
  function hydrateGroupState(activeIdentity: GroupSession) {
    const storage = window.localStorage;
    setGroupActions(readGroupActions(storage, activeIdentity.groupId));
    setSeenRejectedMemory(readSeenRejectedMemory(storage, activeIdentity.groupId));
    setSelectedId(storage.getItem(createSelectedListingStorageKey(activeIdentity.groupId)) ?? "");
  }
  function resetIdentity(nextMessage: string) {
    activateIdentity(undefined);
    identityRef.current = undefined;
    setIdentity(undefined);
    listingsRef.current = [];
    setListingNotice("");
    setListings([]);
    setGroupActions([]);
    setSeenRejectedMemory([]);
    setSelectedId("");
    setMessage(nextMessage);
  }
  function showRequestError(error: unknown, fallbackMessage: string) {
    if (error instanceof SharedListingRequestError && error.isRejectedInvite) {
      resetIdentity(invalidIdentityMessage);
      return;
    }
    setMessage(error instanceof Error ? error.message : fallbackMessage);
  }
  function refreshSharedSnapshot(
    activeIdentity: GroupSession,
    options: { silent?: boolean } = {},
  ): Promise<void> {
    return coordinator.execute(
      activeIdentity,
      "load",
      (signal) => loadSharedSnapshot(activeIdentity, { signal }),
      {
        onSuccess: applySharedSnapshot,
        onError: (error) => {
          if (
            options.silent &&
            !(error instanceof SharedListingRequestError && error.isRejectedInvite)
          ) {
            return;
          }
          showRequestError(error, "Could not load shared D1 listing state.");
        },
      },
    );
  }
  function createListing(activeIdentity: GroupSession, sourceUrl: string, createId: number) {
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
    activeIdentity: GroupSession,
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
          ? patchSharedListing(
              activeIdentity,
              listingId,
              // Read the revision when the queued request runs, so a mutation queued behind
              // another one for the same listing uses the revision that mutation produced.
              { ...payload, revision: findObservedRevision(listingId) },
              { signal },
            )
          : postSharedAction(activeIdentity, listingId, payload, { signal }),
      {
        onSuccess: (snapshot) => {
          applySharedSnapshot(snapshot);
          setListingNotice("");
          setMessage(successMessage);
        },
        onError: (error) => {
          if (error instanceof SharedListingRequestError && error.isStaleListing) {
            recoverStaleListing(activeIdentity, error);
            return;
          }
          showRequestError(error, errorMessage);
        },
      },
    );
  }
  function findObservedRevision(listingId: string) {
    return listingsRef.current.find((listing) => listing.id === listingId)?.revision;
  }
  function recoverStaleListing(activeIdentity: GroupSession, error: SharedListingRequestError) {
    if (error.snapshot) {
      applySharedSnapshot(error.snapshot);
    } else {
      void refreshSharedSnapshot(activeIdentity, { silent: true });
    }
    // Shown as a workspace-level alert: the intake message area is hidden while collapsed.
    setListingNotice(
      error.code === "listing-not-found"
        ? "That listing was removed by someone else, so your change was not saved. The list has been refreshed."
        : "Someone else changed that listing first, so your change was not saved. Showing the latest version; reapply your change if it is still needed.",
    );
  }
  function requireIdentity(errorMessage: string): GroupSession | undefined {
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
    listingsRef.current = normalizedSnapshot.listings;
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

    const input = normalizeInviteIdentityInput(identityForm.inviteCode, identityForm.displayName);
    if (input.kind === "incomplete") {
      setMessage(input.feedback);
      return;
    }

    startSession(input.inviteCode, input.displayName, { restoring: false });
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
    listingNotice,
    dismissListingNotice: () => setListingNotice(""),
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
