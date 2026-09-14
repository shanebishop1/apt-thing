"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ToggleEvent,
} from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Map as MapIcon,
  Moon,
  Pencil,
  Plus,
  Settings,
  Sun,
  X,
} from "lucide-react";
import {
  createListingGroupActions,
  createSelectedListingStorageKey,
  findSelectedListing,
  readGroupActions,
  readInviteIdentity,
  readSeenRejectedMemory,
  writeInviteIdentity,
  type ListingGroupActions,
} from "../lib/saved-list-storage";
import type { GroupActionRecord, SeenRejectedMemoryRecord } from "../lib/agent-contracts";
import { g3cBriefingRunHistoryFixture } from "../lib/agent-contract-fixtures";
import { createMapReviewModel, type MapReviewCandidate } from "../lib/map-review";
import {
  REVIEW_STATUSES,
  type FieldProvenance,
  type InviteIdentity,
  type ListingCandidate,
  type ReviewStatus,
} from "../lib/listings";
import { ListingSection, type ListingListGroup } from "./saved-list/ListingSection";
import { RunHistoryPanel } from "./saved-list/RunHistoryPanel";
import { LeafletListingMap, ListingInlineMap } from "./saved-list/map/LeafletListingMap";
import {
  Fact,
  formatListingAddedAge,
  formatLabel,
  formatMoney,
} from "./saved-list/listing-presentation";

export { RunHistoryPanel } from "./saved-list/RunHistoryPanel";
export { createRunHistoryPanelModel } from "./saved-list/run-history-model";
export { formatAverageRent } from "./saved-list/listing-presentation";

const editableFields: FieldProvenance["field"][] = [
  "title",
  "address",
  "neighborhood",
  "rent",
  "bedrooms",
  "bathrooms",
  "availableAt",
];
const SELECTABLE_REVIEW_STATUSES: Exclude<ReviewStatus, "review">[] = REVIEW_STATUSES.filter(
  (status): status is Exclude<ReviewStatus, "review"> => status !== "review",
);
const numericFields = new Set<FieldProvenance["field"]>(["rent", "bedrooms", "bathrooms"]);
const sharedSnapshotPollMs = 15000;

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

function MapReviewPanel({
  identity,
  model,
  selectedId,
  actions,
  commentText,
  isDetailOverlayOpen,
  onSelect,
  onCommentTextChange,
  onFieldChange,
  onStatusChange,
  onReviewDecision,
  onSourceOpen,
  onReaction,
  onComment,
  onCloseDetail,
}: {
  identity?: InviteIdentity;
  model: ReturnType<typeof createMapReviewModel>;
  selectedId?: string;
  actions?: ListingGroupActions;
  commentText: string;
  isDetailOverlayOpen: boolean;
  onSelect: (listingId: string) => void;
  onCommentTextChange: (value: string) => void;
  onFieldChange: (listingId: string, field: FieldProvenance["field"], rawValue: string) => void;
  onStatusChange: (listingId: string, status: ReviewStatus) => void;
  onReviewDecision: (listingId: string, decision: "approve" | "reject") => void;
  onSourceOpen: (listing: ListingCandidate) => void;
  onReaction: (listing: ListingCandidate, reaction: GroupActionRecord["reaction"]) => void;
  onComment: (event: FormEvent<HTMLFormElement>) => void;
  onCloseDetail: () => void;
}) {
  const selected = model.selected;

  return (
    <section className="map-review-card" aria-label="Map enhanced review">
      <div className="map-review-grid">
        <div id="map-map" className="map-shell" aria-label="Leaflet NYC apartment map">
          <LeafletListingMap
            identity={identity}
            model={model}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </div>

        <div id="map-list" className="map-list" aria-label="Map synchronized listing list">
          {model.candidates.map((candidate) => (
            <MapCandidateButton
              key={candidate.listing.id}
              candidate={candidate}
              selected={candidate.listing.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>

        <MapDetail id="map-detail" candidate={selected} onSourceOpen={onSourceOpen} />
      </div>
      <div
        className={
          isDetailOverlayOpen
            ? "listing-detail-shell map-listing-detail-shell mobile-detail-open"
            : "listing-detail-shell map-listing-detail-shell"
        }
      >
        <ListingEditor
          identity={identity}
          listing={selected?.listing}
          actions={actions}
          commentText={commentText}
          onCommentTextChange={onCommentTextChange}
          onFieldChange={onFieldChange}
          onStatusChange={onStatusChange}
          onReviewDecision={onReviewDecision}
          onSourceOpen={onSourceOpen}
          onReaction={onReaction}
          onComment={onComment}
          onClose={onCloseDetail}
        />
      </div>
    </section>
  );
}

function MapCandidateButton({
  candidate,
  selected,
  onSelect,
}: {
  candidate: MapReviewCandidate;
  selected: boolean;
  onSelect: (listingId: string) => void;
}) {
  return (
    <button
      type="button"
      className={selected ? "map-list-item selected" : "map-list-item"}
      onClick={() => onSelect(candidate.listing.id)}
      aria-pressed={selected}
    >
      <span>{candidate.pinState.replace(/-/g, " ")}</span>
      <strong>{candidate.listing.title}</strong>
      <small>
        {candidate.zoneLabel} · {candidate.boroughFallback}
      </small>
      <small>{candidate.confidenceLabel}</small>
    </button>
  );
}

function MapDetail({
  id,
  candidate,
  onSourceOpen,
}: {
  id: string;
  candidate?: MapReviewCandidate;
  onSourceOpen: (listing: ListingCandidate) => void;
}) {
  if (!candidate) {
    return (
      <article id={id} className="map-detail" aria-label="Selected map listing detail">
        <p>No mapped listing selected.</p>
      </article>
    );
  }

  return (
    <article id={id} className="map-detail" aria-label="Selected map listing detail">
      <header>
        <p className="eyebrow">Selected location</p>
        <h3>{candidate.listing.title}</h3>
        <p>
          {candidate.listing.address} · {candidate.zoneLabel} · {candidate.boroughFallback}
        </p>
      </header>
      <section className="fact-strip map-facts" aria-label="Selected map listing facts">
        <Fact label="Rent" value={formatMoney(candidate.listing.rent)} />
        <Fact label="Beds" value={String(candidate.listing.bedrooms ?? "?")} />
        <Fact label="Baths" value={String(candidate.listing.bathrooms ?? "?")} />
        <Fact label="Added" value={formatListingAddedAge(candidate.listing.createdAt)} />
        <Fact label="Available" value={candidate.listing.availableAt ?? "TBD"} />
      </section>
      <div className="map-context-stack">
        <section>
          <h4>Confidence and concerns</h4>
          <p>{candidate.confidenceLabel}</p>
          <p>{candidate.concernSummary}</p>
        </section>
        <section>
          <h4>Evidence</h4>
          <p>{candidate.evidenceSummary}</p>
        </section>
        <section>
          <h4>Nearest subway</h4>
          {candidate.subway.length > 0 ? (
            <ul>
              {candidate.subway.slice(0, 2).map((subway) => (
                <li key={`${subway.station}-${subway.routes.join("")}`}>
                  {subway.station} ({subway.routes.join("/")}) · {subway.distanceMeters}m
                </li>
              ))}
            </ul>
          ) : (
            <p>Subway context pending for this fixture.</p>
          )}
        </section>
      </div>
      <div className="source-link-row" aria-label="Selected source links">
        {candidate.sourceLinks.map((sourceLink) => (
          <a
            key={sourceLink}
            href={sourceLink}
            target="_blank"
            rel="noreferrer"
            onClick={() => onSourceOpen(candidate.listing)}
          >
            Source link
          </a>
        ))}
      </div>
    </article>
  );
}

function ReviewStatusDropdown({
  listing,
  disabled = false,
  onStatusChange,
}: {
  listing: ListingCandidate;
  disabled?: boolean;
  onStatusChange: (listingId: string, status: ReviewStatus) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeStatus, setActiveStatus] = useState<ReviewStatus>(listing.reviewStatus);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const valueId = useId();
  const listboxId = useId();
  const activeOptionId = `${listboxId}-${activeStatus}`;

  useEffect(() => {
    setActiveStatus(listing.reviewStatus);
  }, [listing.reviewStatus]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  function selectStatus(status: ReviewStatus) {
    if (disabled || status === "review") {
      return;
    }

    setActiveStatus(status);
    setIsOpen(false);
    if (status !== listing.reviewStatus) {
      onStatusChange(listing.id, status);
    }
  }

  function moveActiveStatus(direction: 1 | -1) {
    if (disabled) {
      return;
    }

    const currentIndex = SELECTABLE_REVIEW_STATUSES.findIndex((status) => status === activeStatus);
    const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex =
      (safeCurrentIndex + direction + SELECTABLE_REVIEW_STATUSES.length) %
      SELECTABLE_REVIEW_STATUSES.length;
    setActiveStatus(SELECTABLE_REVIEW_STATUSES[nextIndex]!);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      moveActiveStatus(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen) {
        selectStatus(activeStatus);
      } else {
        setIsOpen(true);
      }
    }
  }

  return (
    <div
      ref={dropdownRef}
      className="status-control detail-status-control"
      aria-label="Review status"
    >
      <button
        type="button"
        className={`status-dropdown-trigger status-${listing.reviewStatus}`}
        aria-label={`Change review status for ${listing.title}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? activeOptionId : undefined}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setIsOpen((current) => !current);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="status-option-dot" aria-hidden="true" />
        <span id={valueId}>{formatLabel(listing.reviewStatus)}</span>
        <ChevronDown className="status-dropdown-chevron" aria-hidden="true" />
      </button>
      <div
        id={listboxId}
        className="status-dropdown-menu"
        role="listbox"
        aria-label={`Review status for ${listing.title}`}
        hidden={!isOpen}
      >
        {SELECTABLE_REVIEW_STATUSES.map((status) => {
          const isSelected = status === listing.reviewStatus;
          const isActive = status === activeStatus;
          return (
            <button
              type="button"
              key={status}
              id={`${listboxId}-${status}`}
              className={`status-dropdown-option status-${status}${isActive ? " active" : ""}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => selectStatus(status)}
              onMouseEnter={() => setActiveStatus(status)}
            >
              <span className="status-option-dot" aria-hidden="true" />
              <span>{formatLabel(status)}</span>
              {isSelected ? <span className="status-option-check" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ListingEditor({
  identity,
  listing,
  actions,
  commentText,
  onCommentTextChange,
  onFieldChange,
  onStatusChange,
  onReviewDecision,
  onSourceOpen,
  onReaction,
  onComment,
  onClose,
}: {
  identity?: InviteIdentity;
  listing?: ListingCandidate;
  actions?: ListingGroupActions;
  commentText: string;
  onCommentTextChange: (value: string) => void;
  onFieldChange: (listingId: string, field: FieldProvenance["field"], rawValue: string) => void;
  onStatusChange: (listingId: string, status: ReviewStatus) => void;
  onReviewDecision: (listingId: string, decision: "approve" | "reject") => void;
  onSourceOpen: (listing: ListingCandidate) => void;
  onReaction: (listing: ListingCandidate, reaction: GroupActionRecord["reaction"]) => void;
  onComment: (event: FormEvent<HTMLFormElement>) => void;
  onClose?: () => void;
}) {
  const [isEditingFields, setIsEditingFields] = useState(false);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isAboutExpanded, setIsAboutExpanded] = useState(false);
  const firstEditInputRef = useRef<HTMLInputElement | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedListingId = listing?.id;
  const modalMediaItemCount = (listing?.photos.filter(Boolean).length ?? 0) + 1;

  useEffect(() => {
    setIsEditingFields(false);
    setSelectedMediaIndex(0);
    setIsPhotoModalOpen(false);
    setIsAboutExpanded(false);
  }, [selectedListingId]);

  useEffect(() => {
    if (!isPhotoModalOpen) {
      return;
    }

    function handleModalKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPhotoModalOpen(false);
        return;
      }

      if (modalMediaItemCount <= 1) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSelectedMediaIndex((currentIndex) =>
          currentIndex === 0 ? modalMediaItemCount - 1 : currentIndex - 1,
        );
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setSelectedMediaIndex((currentIndex) =>
          currentIndex === modalMediaItemCount - 1 ? 0 : currentIndex + 1,
        );
      }
    }

    window.addEventListener("keydown", handleModalKeyDown);
    return () => window.removeEventListener("keydown", handleModalKeyDown);
  }, [isPhotoModalOpen, modalMediaItemCount]);

  useEffect(() => {
    if (!isEditingFields) {
      return;
    }

    firstEditInputRef.current?.focus();

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsEditingFields(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isEditingFields]);

  if (!listing) {
    return (
      <section className="editor-panel" aria-label="Listing detail panel">
        <button
          type="button"
          className="listing-detail-close"
          aria-label="Close listing detail"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
        <p>No listing selected yet.</p>
      </section>
    );
  }

  const intakeKind = getProviderIntakeKind(listing);
  const addedByLabel = getAddedByLabel(listing);
  const lastFieldProvenance = listing.fieldProvenance[listing.fieldProvenance.length - 1];
  const editFieldsDialogId = `${listing.id}-edit-fields-dialog`;
  const editFieldsTitleId = `${listing.id}-edit-fields-title`;
  const photoUrls = listing.photos.filter(Boolean);
  const mapMediaIndex = 0;
  const mediaItemCount = photoUrls.length + 1;
  const isMapSelected = selectedMediaIndex === mapMediaIndex;
  const selectedPhotoUrl = !isMapSelected
    ? (photoUrls[selectedMediaIndex - 1] ?? photoUrls[0])
    : undefined;
  const showPhotoControls = mediaItemCount > 1;
  const showModalPhotoControls = mediaItemCount > 1;
  const photoPositionLabel = `${selectedMediaIndex + 1} of ${mediaItemCount}`;
  const aboutPreview = getListingAboutPreview(listing.description);
  const aboutText = isAboutExpanded ? listing.description : aboutPreview;
  const canExpandAbout = Boolean(listing.description && aboutPreview !== listing.description);
  const isRejectedListing =
    listing.triageBucket === "rejected" || listing.reviewStatus === "rejected";
  const isReviewNeeded =
    !isRejectedListing &&
    (listing.triageBucket === "review-needed" || listing.reviewStatus === "review");
  const lockStatusUntilReviewDecision = isReviewNeeded;
  const selectPhoto = (index: number) => setSelectedMediaIndex(index);
  const handlePreviousPhoto = () => {
    setSelectedMediaIndex((currentIndex) =>
      currentIndex === 0 ? mediaItemCount - 1 : currentIndex - 1,
    );
  };
  const handleNextPhoto = () => {
    setSelectedMediaIndex((currentIndex) =>
      currentIndex === mediaItemCount - 1 ? 0 : currentIndex + 1,
    );
  };
  const handlePreviousModalPhoto = () => {
    setSelectedMediaIndex((currentIndex) =>
      currentIndex === 0 ? mediaItemCount - 1 : currentIndex - 1,
    );
  };
  const handleNextModalPhoto = () => {
    setSelectedMediaIndex((currentIndex) =>
      currentIndex === mediaItemCount - 1 ? 0 : currentIndex + 1,
    );
  };
  const handlePhotoCarouselKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!showPhotoControls) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      handlePreviousPhoto();
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      handleNextPhoto();
    }
  };
  const handleCommentToggle = (event: ToggleEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open) {
      commentInputRef.current?.focus();
    }
  };

  return (
    <article className="editor-panel" aria-label="Listing detail panel">
      <button
        type="button"
        className="listing-detail-close"
        aria-label="Close listing detail"
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </button>
      <header className="editor-header">
        <div className="listing-title-stack">
          <h2>{listing.title}</h2>
          <ReactionScoreBadge reactions={actions?.reactions ?? []} />
          <span>
            {listing.address}
            {listing.neighborhood ? `, ${listing.neighborhood}` : ""}
          </span>
        </div>
        <div className="editor-header-actions">
          <span className="listing-added-by">{addedByLabel}</span>
          <button
            type="button"
            className="editor-icon-button"
            aria-label={`${isEditingFields ? "Close" : "Edit"} fields for ${listing.title}`}
            aria-controls={editFieldsDialogId}
            aria-expanded={isEditingFields}
            aria-pressed={isEditingFields}
            onClick={() => setIsEditingFields((current) => !current)}
          >
            <Pencil className="summary-icon" aria-hidden="true" />
          </button>
          <a
            href={listing.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open source for ${listing.title}`}
            onClick={() => onSourceOpen(listing)}
          >
            <ExternalLinkIcon />
          </a>
        </div>
      </header>

      <ReviewStatusDropdown
        listing={listing}
        disabled={lockStatusUntilReviewDecision}
        onStatusChange={onStatusChange}
      />

      {isReviewNeeded ? (
        <section className="review-decision-panel" aria-label="Review decision">
          <div>
            <p className="eyebrow">Needs review</p>
            <h3>Approve or reject this candidate</h3>
            <p>
              Approving keeps it in the shared list as a current candidate. Rejecting removes it
              from the list and records it in rejected memory.
            </p>
          </div>
          <div className="review-decision-actions">
            <button
              type="button"
              className="review-approve-button"
              onClick={() => onReviewDecision(listing.id, "approve")}
            >
              Approve
            </button>
            <button
              type="button"
              className="secondary-danger"
              onClick={() => onReviewDecision(listing.id, "reject")}
            >
              Reject and remove
            </button>
          </div>
        </section>
      ) : null}

      <section
        className="listing-photo-carousel"
        aria-label={`Media for ${listing.title}`}
        tabIndex={showPhotoControls ? 0 : undefined}
        onKeyDown={handlePhotoCarouselKeyDown}
      >
        <figure className="listing-photo-frame">
          {isMapSelected ? (
            <ListingInlineMap identity={identity} listing={listing} />
          ) : selectedPhotoUrl ? (
            <button
              type="button"
              className="listing-photo-open"
              aria-label={`Enlarge photo ${selectedMediaIndex} of ${photoUrls.length} for ${listing.title}`}
              onClick={() => setIsPhotoModalOpen(true)}
            >
              <img
                src={selectedPhotoUrl}
                alt={`${listing.title} photo ${selectedMediaIndex}`}
                loading="lazy"
              />
            </button>
          ) : null}
          <figcaption className="listing-photo-count">{photoPositionLabel}</figcaption>
          {showPhotoControls ? (
            <div className="listing-photo-controls" aria-label="Photo navigation controls">
              <button
                type="button"
                className="listing-photo-arrow listing-photo-arrow-previous"
                aria-label={`Show previous photo for ${listing.title}`}
                onClick={handlePreviousPhoto}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <button
                type="button"
                className="listing-photo-arrow listing-photo-arrow-next"
                aria-label={`Show next photo for ${listing.title}`}
                onClick={handleNextPhoto}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </figure>
        {showPhotoControls ? (
          <div className="listing-photo-media-strip" aria-label="Choose listing photo or map">
            <button
              type="button"
              className="listing-photo-thumbnail listing-map-thumbnail"
              aria-label={`Show map for ${listing.title}`}
              aria-current={isMapSelected ? "true" : undefined}
              onClick={() => setSelectedMediaIndex(mapMediaIndex)}
            >
              <MapIcon aria-hidden="true" />
              <span>Map</span>
            </button>
            <div className="listing-photo-thumbnails" aria-label="Choose listing photo">
              {photoUrls.map((photoUrl, index) => (
                <button
                  type="button"
                  key={`${photoUrl}-${index}`}
                  className="listing-photo-thumbnail"
                  aria-label={`Show photo ${index + 1} of ${photoUrls.length} for ${listing.title}`}
                  aria-current={index + 1 === selectedMediaIndex ? "true" : undefined}
                  onClick={() => selectPhoto(index + 1)}
                >
                  <img src={photoUrl} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {isPhotoModalOpen ? (
        <div
          className="listing-photo-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Enlarged photos for ${listing.title}`}
        >
          <button
            type="button"
            className="listing-photo-modal-backdrop"
            aria-label="Close enlarged photo carousel"
            onClick={() => setIsPhotoModalOpen(false)}
          />
          <section className="listing-photo-modal-panel" aria-label={`Photos for ${listing.title}`}>
            <div className="listing-photo-modal-header">
              <div>
                <p className="eyebrow">Photos</p>
                <h3>{listing.title}</h3>
              </div>
              <button
                type="button"
                className="listing-photo-modal-close"
                aria-label="Close enlarged photo carousel"
                onClick={() => setIsPhotoModalOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <figure className="listing-photo-frame listing-photo-modal-frame">
              {isMapSelected ? (
                <ListingInlineMap identity={identity} listing={listing} />
              ) : selectedPhotoUrl ? (
                <img src={selectedPhotoUrl} alt={`${listing.title} photo ${selectedMediaIndex}`} />
              ) : null}
              <figcaption className="listing-photo-count">{photoPositionLabel}</figcaption>
              {showModalPhotoControls ? (
                <div className="listing-photo-controls" aria-label="Photo navigation controls">
                  <button
                    type="button"
                    className="listing-photo-arrow listing-photo-arrow-previous"
                    aria-label={`Show previous photo for ${listing.title}`}
                    onClick={handlePreviousModalPhoto}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="listing-photo-arrow listing-photo-arrow-next"
                    aria-label={`Show next photo for ${listing.title}`}
                    onClick={handleNextModalPhoto}
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </figure>
            {showModalPhotoControls ? (
              <div
                className="listing-photo-media-strip listing-photo-modal-media-strip"
                aria-label="Choose listing photo or map"
              >
                <button
                  type="button"
                  className="listing-photo-thumbnail listing-map-thumbnail"
                  aria-label={`Show map for ${listing.title}`}
                  aria-current={isMapSelected ? "true" : undefined}
                  onClick={() => setSelectedMediaIndex(mapMediaIndex)}
                >
                  <MapIcon aria-hidden="true" />
                  <span>Map</span>
                </button>
                <div
                  className="listing-photo-thumbnails listing-photo-modal-thumbnails"
                  aria-label="Choose listing photo"
                >
                  {photoUrls.map((photoUrl, index) => (
                    <button
                      type="button"
                      key={`${photoUrl}-${index}`}
                      className="listing-photo-thumbnail"
                      aria-label={`Show photo ${index + 1} of ${photoUrls.length} for ${listing.title}`}
                      aria-current={index + 1 === selectedMediaIndex ? "true" : undefined}
                      onClick={() => selectPhoto(index + 1)}
                    >
                      <img src={photoUrl} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <section className="fact-strip" aria-label="Listing facts">
        <Fact label="Rent" value={formatMoney(listing.rent)} />
        <Fact label="Beds" value={String(listing.bedrooms ?? "?")} />
        <Fact label="Baths" value={String(listing.bathrooms ?? "?")} />
        <Fact label="Added" value={formatListingAddedAge(listing.createdAt)} />
        <Fact label="Available" value={listing.availableAt ?? "TBD"} />
      </section>

      {listing.description ? (
        <section className="listing-about" aria-label="Listing description">
          <h3>About</h3>
          <p>{aboutText}</p>
          {canExpandAbout ? (
            <button
              type="button"
              className="text-button"
              aria-expanded={isAboutExpanded}
              onClick={() => setIsAboutExpanded((current) => !current)}
            >
              {isAboutExpanded ? "View less" : "View more"}
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="group-actions-panel" aria-label="Group comments and reactions">
        <div className="group-actions-header">
          <h3>Group</h3>
        </div>
        <div className="group-control-row">
          <div className="reaction-row" aria-label="Roommate reactions">
            {(["thumbs-up", "thumbs-down"] as const).map((reaction) => (
              <button
                type="button"
                key={reaction}
                aria-label={`React ${formatLabel(reaction)} to ${listing.title}`}
                title={formatLabel(reaction)}
                onClick={() => onReaction(listing, reaction)}
              >
                <span aria-hidden="true">{reactionGlyph(reaction)}</span>
                <small>{reactionShortLabel(reaction)}</small>
              </button>
            ))}
          </div>
        </div>
        <details className="detail-disclosure" onToggle={handleCommentToggle}>
          <summary>
            <CommentIcon />
            <span>Add comment</span>
          </summary>
          <form className="group-action-form" onSubmit={onComment}>
            <label>
              Comment
              <textarea
                ref={commentInputRef}
                enterKeyHint="done"
                aria-label={`Comment on ${listing.title}`}
                value={commentText}
                onChange={(event) => onCommentTextChange(event.target.value)}
                placeholder="Note"
              />
            </label>
            <button type="submit" disabled={!identity}>
              Save
            </button>
          </form>
        </details>
        <GroupActionSummary actions={actions} />
      </section>

      <details className="detail-disclosure">
        <summary>Evidence</summary>
        <section className="trust-grid" aria-label="Fit flags, evidence, concerns, and provenance">
          <div>
            <h3>Flags</h3>
            <div className="pills">
              {listing.fitFlags.length > 0 ? (
                listing.fitFlags.map((flag) => <span key={flag}>{formatLabel(flag)}</span>)
              ) : (
                <span>No flags</span>
              )}
            </div>
          </div>
          <div>
            <h3>Evidence</h3>
            <p>{getEvidenceSummary(listing)}</p>
            <p>{getConcernSummary(listing)}</p>
          </div>
          <div>
            <h3>Last edit</h3>
            <p>
              {lastFieldProvenance?.actorDisplayName ??
                identity?.displayName ??
                "No active reviewer"}{" "}
              · {lastFieldProvenance?.field ?? "fixture seed"}
            </p>
          </div>
          <div className="source-details">
            <h3>Source details</h3>
            <a
              href={listing.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => onSourceOpen(listing)}
            >
              {listing.url}
            </a>
            <div className="state-grid compact" aria-label="Extraction, batch, and triage state">
              <span>{listing.source}</span>
              <span>{formatLabel(listing.extractionStatus)}</span>
              <span>{formatLabel(intakeKind)}</span>
              <span>{formatLabel(listing.triageStatus)}</span>
              <span>{formatLabel(listing.triageBucket)}</span>
            </div>
          </div>
        </section>
      </details>

      {isEditingFields ? (
        <div className="field-modal-backdrop" onClick={() => setIsEditingFields(false)}>
          <section
            id={editFieldsDialogId}
            className="field-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={editFieldsTitleId}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="field-modal-header">
              <div>
                <p className="eyebrow">Edit listing</p>
                <h3 id={editFieldsTitleId}>{listing.title}</h3>
                <p>{listing.address}</p>
              </div>
              <button
                type="button"
                className="editor-icon-button"
                aria-label={`Close field editor for ${listing.title}`}
                onClick={() => setIsEditingFields(false)}
              >
                <X className="summary-icon" aria-hidden="true" />
              </button>
            </header>
            <section className="edit-grid" aria-label="Editable saved-list fields">
              {editableFields.map((field) => (
                <label key={field}>
                  {field}
                  <input
                    ref={field === editableFields[0] ? firstEditInputRef : undefined}
                    type={numericFields.has(field) ? "number" : "text"}
                    inputMode={numericFields.has(field) ? "decimal" : "text"}
                    enterKeyHint="done"
                    value={String(listing[field] ?? "")}
                    onChange={(event) => onFieldChange(listing.id, field, event.target.value)}
                  />
                </label>
              ))}
            </section>
          </section>
        </div>
      ) : null}
    </article>
  );
}

export function GroupActionSummary({ actions }: { actions?: ListingGroupActions }) {
  if (!actions) {
    return (
      <p className="empty-state">Group actions load after a valid invite opens this record.</p>
    );
  }

  const hasDigestItems = actions.comments.length > 0;

  if (!hasDigestItems) {
    return null;
  }

  return (
    <div className="group-action-summary" aria-label="Saved group action summary">
      <section className="group-action-digest-section" aria-label="Comments">
        <h4>Comments</h4>
        <ul>
          {actions.comments.map((action) => (
            <li key={action.id}>
              <strong>{action.actorDisplayName}</strong> · {action.commentBody}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ReactionScoreBadge({ reactions }: { reactions: GroupActionRecord[] }) {
  const reactionDigest = createReactionScoreDigest(reactions);

  if (reactionDigest.score === 0) {
    return null;
  }

  return (
    <div
      className={`reaction-score-badge ${reactionDigest.tone}`}
      tabIndex={0}
      aria-label={`Reaction score: ${reactionDigest.accessibleScore}. Hover or focus to see who liked or passed.`}
    >
      <strong>{reactionDigest.displayScore}</strong>
      <div className="reaction-score-popover" role="tooltip">
        <ReactionNameGroup label="Liked" names={reactionDigest.likedNames} />
        <ReactionNameGroup label="Passed" names={reactionDigest.passedNames} />
      </div>
    </div>
  );
}

function createReactionScoreDigest(reactions: GroupActionRecord[]) {
  const likedNames = reactions
    .filter((action) => action.reaction === "thumbs-up")
    .map((action) => action.actorDisplayName);
  const passedNames = reactions
    .filter((action) => action.reaction === "thumbs-down")
    .map((action) => action.actorDisplayName);
  const score = likedNames.length;
  const displayScore = `+${score}`;

  return {
    score,
    displayScore,
    accessibleScore: `plus ${score}`,
    tone: "positive",
    likedNames,
    passedNames,
  };
}

function ReactionNameGroup({ label, names }: { label: string; names: string[] }) {
  return (
    <section className="reaction-name-group" aria-label={label}>
      <h4>{label}</h4>
      {names.length === 0 ? (
        <p>No one yet.</p>
      ) : (
        <ul>
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function getEvidenceSummary(listing: ListingCandidate): string {
  const firstEvidence = listing.evidence[0];

  if (!firstEvidence) {
    return "No evidence captured yet.";
  }

  return `${firstEvidence.claim}: ${firstEvidence.quote}`;
}

function getConcernSummary(listing: ListingCandidate): string {
  if (listing.concerns.length === 0) {
    return "No concerns.";
  }

  return listing.concerns.slice(0, 2).join(" · ");
}

function getListingAboutPreview(description?: string): string | undefined {
  if (!description) return undefined;

  const paragraphs = description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const previewSource =
    paragraphs.length > 1 && paragraphs[0]!.length <= 90
      ? `${paragraphs[0]}\n\n${paragraphs[1]}`
      : (paragraphs[0] ?? description.trim());

  if (previewSource.length <= 430) return previewSource;

  const sentenceEnd = previewSource.slice(0, 430).lastIndexOf(". ");
  const cutoff = sentenceEnd > 180 ? sentenceEnd + 1 : previewSource.slice(0, 430).lastIndexOf(" ");
  return `${previewSource.slice(0, cutoff > 0 ? cutoff : 430).trim()}...`;
}

function reactionGlyph(reaction: NonNullable<GroupActionRecord["reaction"]>) {
  switch (reaction) {
    case "thumbs-up":
      return <ThumbIcon direction="up" />;
    case "thumbs-down":
      return <ThumbIcon direction="down" />;
    default:
      return null;
  }
}

function reactionShortLabel(reaction: NonNullable<GroupActionRecord["reaction"]>) {
  switch (reaction) {
    case "thumbs-up":
      return "Like";
    case "thumbs-down":
      return "Pass";
    default:
      return "React";
  }
}

function ThumbIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={direction === "down" ? "reaction-icon down" : "reaction-icon"}
    >
      <path
        d="M7 10v10M7 10H4.8c-.7 0-1.3.6-1.3 1.3v7.4c0 .7.6 1.3 1.3 1.3H7m0-10 4.2-6.3c.4-.6 1.1-.9 1.8-.7.9.2 1.5 1 1.3 1.9l-.7 3.1h4.3c1.4 0 2.4 1.3 2.1 2.6l-1.3 5.8c-.3 1.2-1.2 2-2.5 2H7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="summary-icon">
      <path
        d="M5 5.5h14v10H9l-4 3.5V5.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="summary-icon">
      <path
        d="M8 8h8v8M16 8l-9 9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function getProviderIntakeKind(listing: ListingCandidate): string {
  return (
    listing.providerRouting?.intakeKind ?? (listing.userQualified ? "pasted-url" : "batch-run")
  );
}

function getAddedByLabel(listing: ListingCandidate): string {
  const intakeKind = listing.providerRouting?.intakeKind;

  if (intakeKind === "batch-search" || listing.userQualified === false) {
    return "Added by AI";
  }

  return `Added by ${listing.submittedBy?.trim() || "AI"}`;
}
