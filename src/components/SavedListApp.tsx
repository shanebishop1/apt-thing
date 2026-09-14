"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ToggleEvent,
} from "react";
import { Moon, Plus, Settings, Sun } from "lucide-react";
import {
  createListingGroupActions,
  createSelectedListingStorageKey,
  findSelectedListing,
  readGroupActions,
  readInviteIdentity,
  readSeenRejectedMemory,
  writeInviteIdentity,
} from "../lib/saved-list-storage";
import type { GroupActionRecord, SeenRejectedMemoryRecord } from "../lib/agent-contracts";
import { g3cBriefingRunHistoryFixture } from "../lib/agent-contract-fixtures";
import { createMapReviewModel } from "../lib/map-review";
import type {
  FieldProvenance,
  InviteIdentity,
  ListingCandidate,
  ReviewStatus,
} from "../lib/listings";
import { ListingSection, type ListingListGroup } from "./saved-list/ListingSection";
import { RunHistoryPanel } from "./saved-list/RunHistoryPanel";
import { ListingEditor } from "./saved-list/ListingEditor";
import { MapReviewPanel } from "./saved-list/MapReviewPanel";

export { RunHistoryPanel } from "./saved-list/RunHistoryPanel";
export { createRunHistoryPanelModel } from "./saved-list/run-history-model";
export { formatAverageRent } from "./saved-list/listing-presentation";
export { ListingEditor } from "./saved-list/ListingEditor";
export { GroupActionSummary, ReactionScoreBadge } from "./saved-list/ListingGroupActions";

const sharedSnapshotPollMs = 15000;
const numericFields = new Set<FieldProvenance["field"]>(["rent", "bedrooms", "bathrooms"]);

type SharedListingSnapshot = {
  groupId: string;
  listings: ListingCandidate[];
  actions: GroupActionRecord[];
  memory: SeenRejectedMemoryRecord[];
  updatedAt: string;
};

type SharedListingsApiResponse =
  | { ok: true; snapshot: SharedListingSnapshot }
  | { ok: false; error?: string };

function identityPayload(identity: InviteIdentity, payload: Record<string, unknown>) {
  return {
    ...payload,
    inviteCode: identity.inviteCode,
    displayName: identity.displayName,
  };
}

function sharedApiError(payload: SharedListingsApiResponse, fallback: string): string {
  return payload.ok ? fallback : (payload.error ?? fallback);
}

const defaultIdentityForm = {
  inviteCode: "",
  displayName: "",
};
const fixtureBriefingRunHistory = g3cBriefingRunHistoryFixture;

type IdentityFormState = typeof defaultIdentityForm;
type AppTab = "dashboard" | "map" | "history" | "settings";
type ThemeMode = "dark" | "light";

const themeStorageKey = "apt-thing-theme";
const listingStatusSortOrder: Record<ReviewStatus, number> = {
  review: 0,
  touring: 1,
  new: 2,
  interested: 3,
  unavailable: 4,
  gone: 5,
  rejected: 6,
};

const invalidIdentityMessage = "Invite code or display name is invalid.";

const appTabs: Array<{ id: AppTab; label: string }> = [
  { id: "dashboard", label: "List" },
  { id: "map", label: "Map" },
  { id: "history", label: "Runs" },
];

export function SavedListApp() {
  const [identityForm, setIdentityForm] = useState<IdentityFormState>(defaultIdentityForm);
  const [identity, setIdentity] = useState<InviteIdentity | undefined>();
  const [listings, setListings] = useState<ListingCandidate[]>([]);
  const [groupActions, setGroupActions] = useState<GroupActionRecord[]>([]);
  const [, setSeenRejectedMemory] = useState<SeenRejectedMemoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>(listings[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [commentText, setCommentText] = useState("");
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [isDetailOverlayOpen, setIsDetailOverlayOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [apiBusy, setApiBusy] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const addListingInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedListing = identity ? findSelectedListing(listings, selectedId) : undefined;

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(themeStorageKey);
      if (savedTheme === "light" || savedTheme === "dark") {
        setThemeMode(savedTheme);
      }

      const savedIdentity = readInviteIdentity(window.localStorage);

      if (savedIdentity) {
        setIdentityForm({
          inviteCode: savedIdentity.storedIdentity.inviteCode,
          displayName: savedIdentity.storedIdentity.displayName,
        });
      }

      if (savedIdentity?.kind === "invalid") {
        setIdentity(undefined);
        setListings([]);
        setSelectedId("");
        setMessage(invalidIdentityMessage);
        return;
      }

      if (!savedIdentity || savedIdentity.kind !== "valid") {
        setIdentity(undefined);
        setListings([]);
        setGroupActions([]);
        setSeenRejectedMemory([]);
        setSelectedId("");
        setMessage("Enter the invite code and display name to load this shared apartment search.");
        return;
      }

      const activeIdentity = savedIdentity.identity;

      const hydratedActions = readGroupActions(window.localStorage, activeIdentity.groupId);
      const hydratedMemory = readSeenRejectedMemory(window.localStorage, activeIdentity.groupId);
      const savedSelectedId = window.localStorage.getItem(
        createSelectedListingStorageKey(activeIdentity.groupId),
      );

      setIdentity(activeIdentity);
      void refreshSharedSnapshot(activeIdentity, { silent: true });
      setGroupActions(hydratedActions);
      setSeenRejectedMemory(hydratedMemory);
      setSelectedId(savedSelectedId ?? "");
      setMessage("");
    } catch {
      setMessage("Browser storage is unavailable; using fixture listings for this session.");
    } finally {
      setHasHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    document.documentElement.dataset.theme = themeMode;

    try {
      window.localStorage.setItem(themeStorageKey, themeMode);
    } catch {
      setMessage("Could not persist theme preference in this browser session.");
    }
  }, [hasHydrated, themeMode]);

  useEffect(() => {
    if (!hasHydrated || !identity || !selectedId) {
      return;
    }

    try {
      window.localStorage.setItem(createSelectedListingStorageKey(identity.groupId), selectedId);
    } catch {
      setMessage("Could not remember the currently opened record.");
    }
  }, [hasHydrated, identity, selectedId]);

  useEffect(() => {
    if (!selectedListing) {
      setIsDetailOverlayOpen(false);
    }
  }, [selectedListing]);

  useEffect(() => {
    if (!isDetailOverlayOpen) {
      return;
    }

    function handleDetailOverlayKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDetailOverlayOpen(false);
      }
    }

    window.addEventListener("keydown", handleDetailOverlayKeyDown);
    return () => window.removeEventListener("keydown", handleDetailOverlayKeyDown);
  }, [isDetailOverlayOpen]);

  useEffect(() => {
    if (!hasHydrated || !identity) {
      return;
    }

    let stopped = false;
    let timeoutId: number | undefined;

    const schedule = (delay = sharedSnapshotPollMs) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(async () => {
        if (stopped) return;
        if (document.visibilityState === "visible" && navigator.onLine) {
          await refreshSharedSnapshot(identity, { silent: true });
        }
        schedule();
      }, delay);
    };
    const refreshNow = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void refreshSharedSnapshot(identity, { silent: true });
      }
    };

    schedule();
    window.addEventListener("focus", refreshNow);
    window.addEventListener("online", refreshNow);
    document.addEventListener("visibilitychange", refreshNow);

    return () => {
      stopped = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("online", refreshNow);
      document.removeEventListener("visibilitychange", refreshNow);
    };
  }, [hasHydrated, identity]);

  const mapReview = useMemo(
    () => createMapReviewModel(listings, selectedId),
    [listings, selectedId],
  );
  const listingGroups: ListingListGroup[] = useMemo(
    () => [
      {
        id: "all",
        label: "All listings",
        listings: listings
          .map((listing, index) => ({ listing, index }))
          .sort(
            (left, right) =>
              listingStatusSortOrder[left.listing.reviewStatus] -
                listingStatusSortOrder[right.listing.reviewStatus] || left.index - right.index,
          )
          .map(({ listing }) => listing),
      },
    ],
    [listings],
  );

  function handleIdentityChange(field: keyof IdentityFormState, value: string) {
    setIdentityForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  function handleListingSelect(listingId: string) {
    setSelectedId(listingId);
    setIsDetailOverlayOpen(true);
  }

  function handleIdentitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const resolution = writeInviteIdentity(
        window.localStorage,
        identityForm.inviteCode,
        identityForm.displayName,
      );

      if (resolution.kind === "invalid") {
        setIdentity(undefined);
        setListings([]);
        setGroupActions([]);
        setSeenRejectedMemory([]);
        setSelectedId("");
        setMessage(invalidIdentityMessage);
        return;
      }

      const groupChanged = identity?.groupId !== resolution.identity.groupId;

      setIdentity(resolution.identity);

      if (groupChanged) {
        const hydratedActions = readGroupActions(window.localStorage, resolution.identity.groupId);
        const hydratedMemory = readSeenRejectedMemory(
          window.localStorage,
          resolution.identity.groupId,
        );
        const savedSelectedId = window.localStorage.getItem(
          createSelectedListingStorageKey(resolution.identity.groupId),
        );

        setGroupActions(hydratedActions);
        setSeenRejectedMemory(hydratedMemory);
        setSelectedId(savedSelectedId ?? "");
      }

      void refreshSharedSnapshot(resolution.identity, { silent: true });
      setMessage(resolution.feedback);
    } catch {
      setMessage("Could not persist invite identity in this browser session.");
    }
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identity) {
      setMessage("Enter a valid invite code before saving group records.");
      return;
    }

    setApiBusy(true);
    startTransition(() => {
      void createSharedListing(identity, url);
    });
  }

  function handleThemeToggle() {
    setThemeMode((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  function handleAddListingToggle(event: ToggleEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open) {
      addListingInputRef.current?.focus();
    }
  }

  function handleStatusChange(listingId: string, status: ReviewStatus) {
    if (!identity) {
      setMessage("Enter a valid invite code before updating group records.");
      return;
    }

    void patchSharedListing(
      identity,
      listingId,
      { mutation: "status", status },
      `Status updated to ${status}.`,
    );
  }

  function handleReviewDecision(listingId: string, decision: "approve" | "reject") {
    if (!identity) {
      setMessage("Enter a valid invite code before updating group records.");
      return;
    }

    void patchSharedListing(
      identity,
      listingId,
      { mutation: "review-decision", decision },
      decision === "approve" ? "Review approved." : "Review rejected and removed.",
    );
  }

  function handleSourceOpen(listing: ListingCandidate) {
    if (!identity) {
      setMessage("Enter a valid invite code before opening source links as a group action.");
      return;
    }

    void postSharedAction(
      identity,
      listing.id,
      { actionType: "source-link-open", sourceUrl: listing.url },
      "",
    );
    setMessage("");
  }

  function handleReaction(listing: ListingCandidate, reaction: GroupActionRecord["reaction"]) {
    if (!identity || !reaction) {
      setMessage("Enter a valid invite code before reacting to group records.");
      return;
    }

    void postSharedAction(
      identity,
      listing.id,
      { actionType: "reaction", reaction },
      "Reaction saved.",
    );
  }

  function handleComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identity || !selectedListing) {
      setMessage("Open a listing with a valid invite before commenting.");
      return;
    }

    if (!commentText.trim()) {
      setMessage("Add a comment before saving it to the group review.");
      return;
    }

    void postSharedAction(
      identity,
      selectedListing.id,
      { actionType: "comment", commentBody: commentText },
      "Comment saved.",
    );
    setCommentText("");
  }

  function handleFieldChange(listingId: string, field: FieldProvenance["field"], rawValue: string) {
    if (!identity) {
      setMessage("Enter a valid invite code before editing group records.");
      return;
    }

    const nextValue = numericFields.has(field) ? Number(rawValue) : rawValue;

    if (numericFields.has(field) && (rawValue.trim() === "" || Number.isNaN(nextValue))) {
      setMessage(`${field} must be a number before it can be saved.`);
      return;
    }

    void patchSharedListing(
      identity,
      listingId,
      { mutation: "field", field, value: nextValue },
      `Saved ${field}.`,
    );
  }

  async function refreshSharedSnapshot(
    activeIdentity: InviteIdentity,
    options: { silent?: boolean } = {},
  ) {
    try {
      const response = await fetch(
        `/api/group/listings?groupId=${encodeURIComponent(activeIdentity.groupId)}`,
        {
          headers: {
            "X-Invite-Code": activeIdentity.inviteCode,
            "X-Display-Name": activeIdentity.displayName,
          },
        },
      );
      const payload = (await response.json()) as SharedListingsApiResponse;
      if (!response.ok || !payload.ok)
        throw new Error(sharedApiError(payload, "snapshot-load-failed"));
      applySharedSnapshot(payload.snapshot);
    } catch {
      if (!options.silent) setMessage("Could not load shared D1 listing state.");
    }
  }

  async function createSharedListing(activeIdentity: InviteIdentity, sourceUrl: string) {
    try {
      const response = await fetch("/api/group/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identityPayload(activeIdentity, { url: sourceUrl })),
      });
      const payload = (await response.json()) as SharedListingsApiResponse & {
        result?: {
          kind: "created" | "duplicate";
          listing?: ListingCandidate;
          extraction?: { ok: boolean; failureCode?: string };
        };
      };
      if (!response.ok || !payload.ok)
        throw new Error(sharedApiError(payload, "create-listing-failed"));
      applySharedSnapshot(payload.snapshot);
      if (payload.result?.listing) setSelectedId(payload.result.listing.id);
      setUrl("");
      setMessage(
        payload.result?.kind === "duplicate"
          ? "Duplicate listing found. Opening the existing shared record."
          : payload.result?.extraction?.ok === false
            ? `Listing saved to D1; extraction needs manual review (${payload.result.extraction.failureCode ?? "unknown"}).`
            : "Listing extracted and saved to shared D1 state.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save this listing right now.");
    } finally {
      setApiBusy(false);
    }
  }

  async function patchSharedListing(
    activeIdentity: InviteIdentity,
    listingId: string,
    mutation: Record<string, unknown>,
    successMessage: string,
  ) {
    try {
      const response = await fetch(`/api/group/listings/${encodeURIComponent(listingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identityPayload(activeIdentity, mutation)),
      });
      const payload = (await response.json()) as SharedListingsApiResponse;
      if (!response.ok || !payload.ok)
        throw new Error(sharedApiError(payload, "listing-mutation-failed"));
      applySharedSnapshot(payload.snapshot);
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update shared listing.");
    }
  }

  async function postSharedAction(
    activeIdentity: InviteIdentity,
    listingId: string,
    action: Record<string, unknown>,
    successMessage: string,
  ) {
    try {
      const response = await fetch(`/api/group/listings/${encodeURIComponent(listingId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identityPayload(activeIdentity, action)),
      });
      const payload = (await response.json()) as SharedListingsApiResponse;
      if (!response.ok || !payload.ok)
        throw new Error(sharedApiError(payload, "listing-action-failed"));
      applySharedSnapshot(payload.snapshot);
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save shared group action.");
    }
  }

  function applySharedSnapshot(snapshot: SharedListingSnapshot) {
    setListings(snapshot.listings.map(normalizeReviewNeededListing));
    setGroupActions(snapshot.actions);
    setSeenRejectedMemory(snapshot.memory);
    setSelectedId((currentId) => findSelectedListing(snapshot.listings, currentId)?.id ?? "");
  }

  if (!identity) {
    return (
      <main className="dashboard-shell" data-theme={themeMode}>
        <section className="settings-card" aria-label="Invite gate">
          <div className="panel-heading settings-heading">
            <div>
              <p className="eyebrow">Private roommate search</p>
              <h1>Enter your invite</h1>
            </div>
            <p>Enter the shared invite code and your display name to load the apartment list.</p>
          </div>
          <form
            className="settings-form"
            aria-label="Invite identity"
            onSubmit={handleIdentitySubmit}
          >
            <label className="settings-field">
              Invite code
              <input
                autoCapitalize="none"
                autoComplete="off"
                value={identityForm.inviteCode}
                onChange={(event) => handleIdentityChange("inviteCode", event.target.value)}
                required
              />
            </label>
            <label className="settings-field">
              Display name
              <input
                autoComplete="name"
                value={identityForm.displayName}
                onChange={(event) => handleIdentityChange("displayName", event.target.value)}
                required
              />
            </label>
            <button type="submit">Enter shared list</button>
            <div className="settings-status" role="status" aria-live="polite">
              <span className="eyebrow">Access required</span>
              <strong>No active group</strong>
              <p>{message || "Enter a valid invite code and display name to continue."}</p>
            </div>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell" data-theme={themeMode}>
      <nav className="app-tabs" aria-label="Apartment search workspace sections">
        {appTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "active" : undefined}
            onClick={() => setActiveTab(tab.id)}
            aria-pressed={activeTab === tab.id}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className="theme-toggle"
          onClick={handleThemeToggle}
          aria-pressed={themeMode === "dark"}
          aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
        >
          <span aria-hidden="true">
            {themeMode === "dark" ? <Sun className="nav-icon" /> : <Moon className="nav-icon" />}
          </span>
        </button>
        <button
          type="button"
          className={`settings-toggle${activeTab === "settings" ? " active" : ""}`}
          onClick={() => setActiveTab("settings")}
          aria-pressed={activeTab === "settings"}
          aria-label="Settings"
          title="Settings"
        >
          <span aria-hidden="true">
            <Settings className="nav-icon" />
          </span>
        </button>
      </nav>

      {activeTab === "dashboard" ? (
        <>
          <div className="workspace-grid">
            <section className="list-panel" aria-label="Saved listing review queue">
              <div className="panel-heading listing-panel-heading">
                <h2>Listings</h2>
                <details className="add-listing-control" onToggle={handleAddListingToggle}>
                  <summary aria-label="Add listing">
                    <Plus className="summary-icon" aria-hidden="true" />
                  </summary>
                  <form onSubmit={handleCreate} className="intake-form compact">
                    <label>
                      <span className="sr-only">Source URL</span>
                      <input
                        ref={addListingInputRef}
                        type="url"
                        inputMode="url"
                        enterKeyHint="go"
                        autoCapitalize="none"
                        autoComplete="url"
                        aria-describedby="intake-feedback"
                        placeholder="https://streeteasy.com/building/..."
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        required
                      />
                    </label>
                    <button type="submit" disabled={isPending || apiBusy || !identity}>
                      {isPending || apiBusy ? "Saving…" : "Add"}
                    </button>
                    <p id="intake-feedback" role="status" aria-live="polite">
                      {message || " "}
                    </p>
                  </form>
                </details>
              </div>
              <ListingSection
                groups={listingGroups}
                selectedId={selectedListing?.id}
                onSelect={handleListingSelect}
                onSourceOpen={handleSourceOpen}
              />
            </section>

            <div
              className={
                isDetailOverlayOpen
                  ? "listing-detail-shell mobile-detail-open"
                  : "listing-detail-shell"
              }
            >
              <ListingEditor
                identity={identity}
                listing={selectedListing}
                actions={
                  identity && selectedListing
                    ? createListingGroupActions(groupActions, identity.groupId, selectedListing.id)
                    : undefined
                }
                commentText={commentText}
                onCommentTextChange={setCommentText}
                onFieldChange={handleFieldChange}
                onStatusChange={handleStatusChange}
                onReviewDecision={handleReviewDecision}
                onSourceOpen={handleSourceOpen}
                onReaction={handleReaction}
                onComment={handleComment}
                onClose={() => setIsDetailOverlayOpen(false)}
              />
            </div>
          </div>
        </>
      ) : null}

      {activeTab === "map" ? (
        <MapReviewPanel
          identity={identity}
          model={mapReview}
          selectedId={selectedListing?.id}
          actions={
            identity && selectedListing
              ? createListingGroupActions(groupActions, identity.groupId, selectedListing.id)
              : undefined
          }
          commentText={commentText}
          isDetailOverlayOpen={isDetailOverlayOpen}
          onSelect={handleListingSelect}
          onCommentTextChange={setCommentText}
          onFieldChange={handleFieldChange}
          onStatusChange={handleStatusChange}
          onReviewDecision={handleReviewDecision}
          onSourceOpen={handleSourceOpen}
          onReaction={handleReaction}
          onComment={handleComment}
          onCloseDetail={() => setIsDetailOverlayOpen(false)}
        />
      ) : null}

      {activeTab === "history" ? <RunHistoryPanel history={fixtureBriefingRunHistory} /> : null}

      {activeTab === "settings" ? (
        <section className="settings-card" aria-label="Settings">
          <div className="panel-heading settings-heading">
            <div>
              <h2>Settings</h2>
            </div>
          </div>
          <form
            className="settings-form"
            aria-label="Active group identity"
            onSubmit={handleIdentitySubmit}
          >
            <label className="settings-field">
              Invite code
              <input
                autoCapitalize="none"
                autoComplete="off"
                value={identityForm.inviteCode}
                onChange={(event) => handleIdentityChange("inviteCode", event.target.value)}
              />
            </label>
            <label className="settings-field">
              Display name
              <input
                value={identityForm.displayName}
                onChange={(event) => handleIdentityChange("displayName", event.target.value)}
              />
            </label>
            <button type="submit">Save identity</button>
            <div className="settings-status" role="status" aria-live="polite">
              <span className="eyebrow">Current workspace</span>
              <strong>{identity ? identity.groupId : "No active group"}</strong>
              <p>{identity ? `Saving as ${identity.displayName}` : "Enter a valid invite code."}</p>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
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
