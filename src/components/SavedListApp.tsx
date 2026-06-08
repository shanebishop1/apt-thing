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
  Moon,
  Pencil,
  Plus,
  Settings,
  Sun,
  X,
} from "lucide-react";
import type {
  DivIcon,
  LatLngBoundsExpression,
  LayerGroup,
  Map as LeafletMap,
  Marker,
} from "leaflet";
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
import type {
  BriefingCandidateSummary,
  BriefingRunHistoryContract,
  BriefingRunHistoryRun,
  EvidenceStoragePointer,
  FeedbackSummary,
  SourceCoverageSummary,
} from "../lib/agent-contracts";
import { createMapReviewModel, type MapReviewCandidate } from "../lib/map-review";
import {
  REVIEW_STATUSES,
  type FieldProvenance,
  type InviteIdentity,
  type ListingCandidate,
  type ReviewStatus,
} from "../lib/listings";

const editableFields: FieldProvenance["field"][] = [
  "title",
  "address",
  "neighborhood",
  "rent",
  "bedrooms",
  "bathrooms",
  "availableAt",
];
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
type AppTab = "dashboard" | "map" | "briefing" | "history" | "settings";
type ThemeMode = "dark" | "light";

const themeStorageKey = "apt-thing-theme";
const listingStatusSortOrder: Record<ReviewStatus, number> = {
  touring: 0,
  new: 1,
  interested: 2,
  unavailable: 3,
  rejected: 4,
};

const invalidIdentityMessage = "Invite code or display name is invalid.";

const appTabs: Array<{ id: AppTab; label: string }> = [
  { id: "dashboard", label: "List" },
  { id: "map", label: "Map" },
  { id: "briefing", label: "Briefing" },
  { id: "history", label: "Runs" },
];

type BriefingFeedbackSummaryItem = FeedbackSummary & {
  groupId: string;
  listingTitle: string;
  source: string;
};

export type LatestBriefingMemoryRecord = {
  id: string;
  state: SeenRejectedMemoryRecord["memoryState"];
  reason: string;
  duplicateKey: string;
  groupScopedDuplicateKey: string;
  lastSeenLabel: string;
  sourceUrl?: string;
};

type ListingSectionProps = {
  groups?: ListingListGroup[];
  selectedId?: string;
  onSelect: (listingId: string) => void;
  onSourceOpen: (listing: ListingCandidate) => void;
};

type ListingListGroup = {
  id: string;
  label: string;
  listings: ListingCandidate[];
};

export type RunHistoryArtifactLink = {
  id: string;
  href: string;
  label: string;
  ownerLabel: string;
  storageKey: string;
  contentType?: string;
};

export type RunHistoryPanelRunModel = {
  runId: string;
  heading: string;
  cadence: BriefingRunHistoryRun["cadence"];
  trigger: BriefingRunHistoryRun["trigger"];
  status: BriefingRunHistoryRun["status"];
  statusLabel: string;
  startedLabel: string;
  completedLabel: string;
  timelineLabel: string;
  isLatest: boolean;
  counts: BriefingRunHistoryRun["counts"];
  sourceCoverage: SourceCoverageSummary[];
  failures: SourceCoverageSummary[];
  providerMetadata: string[];
  providerDetails: string[];
  artifactLinks: RunHistoryArtifactLink[];
};

export type RunHistoryPanelModel = {
  supportedCadences: BriefingRunHistoryContract["supportedCadences"];
  runs: RunHistoryPanelRunModel[];
};

export type LatestBriefingPanelModel = {
  runStatus: string;
  runCadence: string;
  generatedAt: string;
  completedAt?: string;
  summary: string;
  bestMatches: BriefingCandidateSummary[];
  reviewNeeded: BriefingCandidateSummary[];
  changedListings: string[];
  skippedSeenCount: number;
  skippedTriagedCount: number;
  memoryRecordCount: number;
  memoryRecords: LatestBriefingMemoryRecord[];
  sourceCoverage: SourceCoverageSummary[];
  recommendationRationale: string[];
  concerns: string[];
  nextActions: string[];
  feedbackSummaries: BriefingFeedbackSummaryItem[];
};

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
  const [message, setMessage] = useState("");
  const [apiBusy, setApiBusy] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const addListingInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();

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
  const selectedListing = identity ? findSelectedListing(listings, selectedId) : undefined;
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
    setListings(snapshot.listings);
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
                onSelect={setSelectedId}
                onSourceOpen={handleSourceOpen}
              />
            </section>

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
              onSourceOpen={handleSourceOpen}
              onReaction={handleReaction}
              onComment={handleComment}
            />
          </div>
        </>
      ) : null}

      {activeTab === "map" ? (
        <MapReviewPanel
          model={mapReview}
          selectedId={selectedListing?.id}
          onSelect={setSelectedId}
          onSourceOpen={handleSourceOpen}
        />
      ) : null}

      {activeTab === "briefing" ? (
        <LatestBriefingPanel history={fixtureBriefingRunHistory} />
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

export function createLatestBriefingPanelModel(
  history: BriefingRunHistoryContract,
): LatestBriefingPanelModel {
  const latestRun = history.latestRun;
  const latestBriefing = history.latestBriefing;
  const candidatesById = new Map(
    latestRun.candidateSummaries.map((candidate) => [candidate.listingId, candidate]),
  );
  const bestMatchIds = new Set([
    ...latestBriefing.bestNewListingIds,
    ...latestRun.candidateSummaries
      .filter((candidate) => candidate.bucket === "confirmed-match")
      .map((candidate) => candidate.listingId),
  ]);
  const reviewNeededIds = new Set([
    ...latestBriefing.reviewNeededListingIds,
    ...latestRun.candidateSummaries
      .filter((candidate) => candidate.bucket === "review-needed")
      .map((candidate) => candidate.listingId),
  ]);
  const bestMatches = candidatesFromIds(bestMatchIds, candidatesById);
  const reviewNeeded = candidatesFromIds(reviewNeededIds, candidatesById);
  const concerns = uniqueNonEmpty(
    latestRun.candidateSummaries
      .flatMap((candidate) => candidate.evidenceSummary.concerns)
      .concat(
        latestBriefing.sourceCoverage.flatMap(
          (coverage) => coverage.failureMessage ?? coverage.failureCode ?? [],
        ),
      ),
  );
  const feedbackSummaries = history.feedbackSummaries.map((summary) => {
    const candidate = candidatesById.get(summary.listingId);

    return {
      ...summary,
      groupId: history.groupId,
      listingTitle: candidate?.title ?? summary.listingId,
      source: candidate?.source ?? sourceLabelFromUrl(summary.sourceUrl),
    };
  });

  return {
    runStatus: latestRun.status,
    runCadence: latestRun.cadence,
    generatedAt: latestBriefing.generatedAt,
    completedAt: latestRun.completedAt,
    summary: latestBriefing.summary,
    bestMatches,
    reviewNeeded,
    changedListings: latestBriefing.whatChanged,
    skippedSeenCount: latestBriefing.skippedSeenCount,
    skippedTriagedCount: latestRun.counts.candidatesSkippedTriaged,
    memoryRecordCount: history.seenRejectedMemory.length,
    memoryRecords: history.seenRejectedMemory.map(toLatestBriefingMemoryRecord),
    sourceCoverage: latestBriefing.sourceCoverage,
    recommendationRationale: latestBriefing.recommendationRationale,
    concerns,
    nextActions: latestBriefing.suggestedActions,
    feedbackSummaries,
  };
}

export function createRunHistoryPanelModel(
  history: BriefingRunHistoryContract,
): RunHistoryPanelModel {
  const latestRunId = history.latestRun.runId;

  return {
    supportedCadences: history.supportedCadences,
    runs: [...history.runs]
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .map((run) => {
        const artifactLinks = createRunArtifactLinks(run);
        const failures = run.sourceCoverage.filter((coverage) => coverage.status === "failed");

        return {
          runId: run.runId,
          heading: createRunHistoryHeading(run),
          cadence: run.cadence,
          trigger: run.trigger,
          status: run.status,
          statusLabel: formatLabel(run.status),
          startedLabel: formatDateTimeLabel(run.startedAt),
          completedLabel: run.completedAt ? formatDateTimeLabel(run.completedAt) : "Still running",
          timelineLabel: `${formatDateLabel(run.startedAt)} · ${run.completedAt ? "completed" : "in progress"}`,
          isLatest: run.runId === latestRunId,
          counts: run.counts,
          sourceCoverage: run.sourceCoverage,
          failures,
          providerMetadata: uniqueNonEmpty(
            run.providerMetadata.map((metadata) => `${metadata.provider} / ${metadata.model}`),
          ),
          providerDetails: run.providerMetadata.map((metadata) =>
            uniqueNonEmpty([
              metadata.status,
              metadata.purpose,
              metadata.promptVersion ?? "",
              metadata.schemaValidation ? `schema ${metadata.schemaValidation}` : "",
            ]).join(" · "),
          ),
          artifactLinks,
        } satisfies RunHistoryPanelRunModel;
      }),
  };
}

export function RunHistoryPanel({ history }: { history: BriefingRunHistoryContract }) {
  const model = createRunHistoryPanelModel(history);

  return (
    <section className="run-history-card" aria-label="Agent run history">
      <header className="run-history-header">
        <div>
          <p className="eyebrow">Run history</p>
          <h2>Runs</h2>
          <p>Cadences: {model.supportedCadences.join(", ")}.</p>
        </div>
        <div className="run-history-total" aria-label="Run history total">
          <span>Records</span>
          <strong>{model.runs.length}</strong>
        </div>
      </header>

      <div className="run-history-list">
        {model.runs.map((run) => (
          <details key={run.runId} className="run-history-item" open={run.isLatest}>
            <summary>
              <span className={`run-status-dot ${run.status}`} aria-hidden="true" />
              <div>
                <p className="eyebrow">
                  {formatLabel(run.cadence)} · {formatLabel(run.trigger)}
                  {run.isLatest ? " · latest" : ""}
                </p>
                <h3>{run.heading}</h3>
                <small>{run.timelineLabel}</small>
              </div>
              <strong>{run.statusLabel}</strong>
            </summary>

            <div className="run-history-detail">
              <section className="run-history-facts" aria-label={`${run.heading} counts`}>
                <Fact label="Candidates found" value={String(run.counts.candidatesFound)} />
                <Fact
                  label="Candidates skipped"
                  value={String(
                    run.counts.candidatesSkippedSeen + run.counts.candidatesSkippedTriaged,
                  )}
                />
                <Fact label="Candidates triaged" value={String(run.counts.candidatesTriaged)} />
                <Fact label="Source failures" value={String(run.counts.sourceFailures)} />
              </section>

              <section className="run-history-section" aria-label={`${run.heading} timestamps`}>
                <h4>Timestamps</h4>
                <p>
                  Started {run.startedLabel}; completed {run.completedLabel}.
                </p>
              </section>

              <section
                className="run-history-section"
                aria-label={`${run.heading} source coverage`}
              >
                <h4>Source coverage</h4>
                <div className="run-source-list">
                  {run.sourceCoverage.map((coverage) => (
                    <article
                      key={`${run.runId}-${coverage.source}`}
                      className={`run-source ${coverage.status}`}
                    >
                      <div>
                        <strong>{coverage.source}</strong>
                        <span>{formatLabel(coverage.status)}</span>
                      </div>
                      <p>
                        Checked {coverage.checkedCount}; candidates {coverage.candidateCount};
                        artifacts {coverage.rawArtifactPointers.length}
                        {coverage.failureCode ? ` · ${coverage.failureCode}` : ""}
                      </p>
                      {coverage.failureMessage ? <p>{coverage.failureMessage}</p> : null}
                    </article>
                  ))}
                </div>
              </section>

              <section
                className="run-history-section"
                aria-label={`${run.heading} failure summary`}
              >
                <h4>Failures</h4>
                {run.failures.length === 0 ? (
                  <p>No failures.</p>
                ) : (
                  <ul>
                    {run.failures.map((failure) => (
                      <li key={`${run.runId}-${failure.source}-${failure.failureCode ?? "failed"}`}>
                        <strong>{failure.source}</strong>: {failure.failureCode ?? "failed"}
                        {failure.failureMessage ? ` · ${failure.failureMessage}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section
                className="run-history-section"
                aria-label={`${run.heading} provider metadata`}
              >
                <h4>Provider/model metadata</h4>
                {run.providerMetadata.length === 0 ? (
                  <p>No provider metadata.</p>
                ) : (
                  <ul>
                    {run.providerMetadata.map((metadata, index) => (
                      <li key={`${run.runId}-provider-${metadata}-${index}`}>
                        <strong>{metadata}</strong>
                        {run.providerDetails[index] ? ` · ${run.providerDetails[index]}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section
                className="run-history-section"
                aria-label={`${run.heading} evidence artifacts`}
              >
                <h4>Evidence artifacts</h4>
                {run.artifactLinks.length === 0 ? (
                  <p>No artifacts.</p>
                ) : (
                  <div className="artifact-link-grid">
                    {run.artifactLinks.map((artifact) => (
                      <a id={artifact.id} key={artifact.id} href={artifact.href}>
                        <span>{artifact.label}</span>
                        <strong>{artifact.storageKey}</strong>
                        {artifact.contentType ? <small>{artifact.contentType}</small> : null}
                      </a>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

export function LatestBriefingPanel({ history }: { history: BriefingRunHistoryContract }) {
  const model = createLatestBriefingPanelModel(history);

  return (
    <section className="briefing-card" aria-label="Latest agent briefing">
      <header className="briefing-header">
        <div>
          <p className="eyebrow">Latest in-app briefing</p>
          <h2>Briefing</h2>
          <p>{model.summary}</p>
        </div>
        <div className="briefing-run-pill" aria-label="Latest briefing run status">
          <span>{formatLabel(model.runStatus)}</span>
          <strong>{model.runCadence}</strong>
          <small>{formatDateLabel(model.completedAt ?? model.generatedAt)}</small>
        </div>
      </header>

      <div className="briefing-layout">
        <div className="briefing-highlight-stack">
          <BriefingCandidateGroup
            eyebrow="Matches"
            candidates={model.bestMatches}
            emptyText="No matches."
          />
          <BriefingCandidateGroup
            eyebrow="Review needed"
            candidates={model.reviewNeeded}
            emptyText="No review-needed candidates."
          />
        </div>

        <section className="briefing-section" aria-label="Changed listings">
          <h3>Changed listings</h3>
          <BulletList items={model.changedListings} emptyText="No changes." />
        </section>

        <section className="briefing-section memory-counts" aria-label="Skipped / seen memory">
          <h3>Skipped / seen memory</h3>
          <div className="briefing-count-grid">
            <Fact label="Seen skips" value={String(model.skippedSeenCount)} />
            <Fact label="Triaged skips" value={String(model.skippedTriagedCount)} />
            <Fact label="Memory rows" value={String(model.memoryRecordCount)} />
          </div>
          <MemoryRecordList records={model.memoryRecords} />
        </section>

        <section className="briefing-section source-coverage" aria-label="Source coverage">
          <h3>Source coverage</h3>
          <div className="source-coverage-list">
            {model.sourceCoverage.map((coverage) => (
              <article key={coverage.source} className={`source-coverage-item ${coverage.status}`}>
                <div>
                  <strong>{coverage.source}</strong>
                  <span>{formatLabel(coverage.status)}</span>
                </div>
                <p>
                  Checked {coverage.checkedCount}; candidates {coverage.candidateCount}
                  {coverage.failureCode ? ` · ${coverage.failureCode}` : ""}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="briefing-section" aria-label="Recommendation rationale">
          <h3>Recommendation rationale</h3>
          <BulletList items={model.recommendationRationale} emptyText="No rationale." />
        </section>

        <section className="briefing-section" aria-label="Concerns">
          <h3>Concerns</h3>
          <BulletList items={model.concerns} emptyText="No concerns." />
        </section>

        <section className="briefing-section next-actions" aria-label="Next actions">
          <h3>Next actions</h3>
          <BulletList items={model.nextActions} emptyText="No actions." />
        </section>
      </div>
    </section>
  );
}

function MemoryRecordList({ records }: { records: LatestBriefingMemoryRecord[] }) {
  if (records.length === 0) {
    return <p className="empty-state">No memory records.</p>;
  }

  return (
    <div className="briefing-memory-list" aria-label="Seen and rejected memory records">
      {records.map((record) => (
        <article key={record.id} className="briefing-memory-card">
          <div className="briefing-memory-topline">
            <span>{formatLabel(record.state)}</span>
            <small>Last seen {record.lastSeenLabel}</small>
          </div>
          <p>{record.reason}</p>
          <dl className="memory-key-list">
            <div>
              <dt>Duplicate key</dt>
              <dd>{record.duplicateKey}</dd>
            </div>
            <div>
              <dt>Group key</dt>
              <dd>{record.groupScopedDuplicateKey}</dd>
            </div>
          </dl>
          {record.sourceUrl ? (
            <a
              className="memory-source-link"
              href={record.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Source link
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function BriefingCandidateGroup({
  eyebrow,
  candidates,
  emptyText,
}: {
  eyebrow: string;
  candidates: BriefingCandidateSummary[];
  emptyText: string;
}) {
  return (
    <section className="briefing-candidate-group" aria-label={eyebrow}>
      <p className="eyebrow">{eyebrow}</p>
      {candidates.length === 0 ? (
        <p>{emptyText}</p>
      ) : (
        <div className="briefing-candidates">
          {candidates.map((candidate) => (
            <article key={candidate.listingId} className="briefing-candidate-card">
              <div>
                <span>{formatLabel(candidate.bucket)}</span>
                <strong>{candidate.title}</strong>
              </div>
              <p>{candidate.suggestedAction}</p>
              <small>
                Overall confidence {Math.round(candidate.evidenceSummary.confidence.overall * 100)}%
              </small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function BulletList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) {
    return <p>{emptyText}</p>;
  }

  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function createRunHistoryHeading(run: BriefingRunHistoryRun): string {
  if (run.cadence === "manual") {
    return "Manual import catch-up";
  }
  if (run.cadence === "hourly") {
    return "Hourly-ready smoke run";
  }

  return "Daily scheduled search";
}

function createRunArtifactLinks(run: BriefingRunHistoryRun): RunHistoryArtifactLink[] {
  const pointers = uniquePointers([
    ...run.rawArtifactPointers,
    ...run.sourceCoverage.flatMap((coverage) => coverage.rawArtifactPointers),
    ...run.candidateSummaries.flatMap((candidate) => candidate.evidenceSummary.rawArtifactPointers),
  ]);

  return pointers.map((pointer, index) => {
    const id = `artifact-${slugify(run.runId)}-${index}`;

    return {
      id,
      href: `#${id}`,
      label: `${pointer.owner.toUpperCase()} artifact`,
      ownerLabel: pointer.owner.toUpperCase(),
      storageKey: pointer.key,
      contentType: pointer.contentType,
    };
  });
}

function uniquePointers(pointers: EvidenceStoragePointer[]): EvidenceStoragePointer[] {
  const byKey = new Map<string, EvidenceStoragePointer>();

  for (const pointer of pointers) {
    byKey.set(`${pointer.owner}:${pointer.key}`, pointer);
  }

  return [...byKey.values()];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toLatestBriefingMemoryRecord(
  record: SeenRejectedMemoryRecord,
): LatestBriefingMemoryRecord {
  return {
    id: record.id,
    state: record.memoryState,
    reason: record.reason,
    duplicateKey: record.duplicateKey,
    groupScopedDuplicateKey: record.groupScopedDuplicateKey,
    lastSeenLabel: formatDateLabel(record.lastSeenAt),
    sourceUrl: record.sourceUrl,
  };
}

function candidatesFromIds(
  ids: Set<string>,
  candidatesById: Map<string, BriefingCandidateSummary>,
): BriefingCandidateSummary[] {
  return [...ids].flatMap((id) => {
    const candidate = candidatesById.get(id);

    return candidate ? [candidate] : [];
  });
}

function uniqueNonEmpty(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function sourceLabelFromUrl(sourceUrl: string): string {
  try {
    const hostname = new URL(sourceUrl).hostname.replace(/^www\./, "");
    return hostname.split(".")[0] ?? sourceUrl;
  } catch {
    return sourceUrl;
  }
}

function MapReviewPanel({
  model,
  selectedId,
  onSelect,
  onSourceOpen,
}: {
  model: ReturnType<typeof createMapReviewModel>;
  selectedId?: string;
  onSelect: (listingId: string) => void;
  onSourceOpen: (listing: ListingCandidate) => void;
}) {
  const selected = model.selected;
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<LeafletMap | null>(null);
  const listingMarkersRef = useRef<Marker[]>([]);
  const subwayOverlayRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);

  useEffect(() => {
    const mapContainer = mapContainerRef.current;
    if (!mapContainer || leafletMapRef.current) {
      return;
    }

    let disposed = false;

    void import("leaflet").then((leaflet) => {
      if (disposed || !mapContainerRef.current) {
        return;
      }

      leafletRef.current = leaflet;
      const map = leaflet.map(mapContainerRef.current, {
        attributionControl: false,
        center: [40.7328, -73.9797],
        scrollWheelZoom: true,
        zoom: 13,
        zoomControl: true,
      });

      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "",
          maxZoom: 19,
        })
        .addTo(map);
      leafletMapRef.current = map;
      const nextMarkers = syncLeafletMap({
        fitToListings: true,
        leaflet,
        map,
        model,
        onSelect,
        selectedId,
      });
      listingMarkersRef.current = nextMarkers.listingMarkers;
      void addMtaSubwayOverlay(leaflet, map)
        .then((overlay) => {
          if (disposed) {
            overlay.remove();
            return;
          }

          subwayOverlayRef.current = overlay;
        })
        .catch((error: unknown) => {
          console.error("MTA subway overlay failed to load", error);
        });
      setTimeout(() => map.invalidateSize(), 0);
    });

    return () => {
      disposed = true;
      listingMarkersRef.current.forEach((marker) => marker.remove());
      subwayOverlayRef.current?.remove();
      listingMarkersRef.current = [];
      subwayOverlayRef.current = null;
      leafletMapRef.current?.remove();
      leafletMapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = leafletMapRef.current;
    if (!leaflet || !map) {
      return;
    }

    listingMarkersRef.current.forEach((marker) => marker.remove());
    const nextMarkers = syncLeafletMap({
      fitToListings: false,
      leaflet,
      map,
      model,
      onSelect,
      selectedId,
    });
    listingMarkersRef.current = nextMarkers.listingMarkers;
  }, [model, onSelect, selectedId]);

  return (
    <section className="map-review-card" aria-label="Map enhanced review">
      <div className="panel-heading map-heading">
        <div>
          <p className="eyebrow">Map-enhanced review</p>
          <h2>Map</h2>
          <p>
            Apartment pins with interactive MTA subway lines, stations, confidence, concerns, and
            source links.
          </p>
        </div>
        <div className="map-mode-tabs" aria-label="Mobile map review modes">
          {model.mobileModes.map((mode) => (
            <a key={mode} href={`#map-${mode}`}>
              {mode}
            </a>
          ))}
        </div>
      </div>

      <div className="map-review-grid">
        <div id="map-map" className="map-shell" aria-label="Leaflet NYC apartment map">
          <div ref={mapContainerRef} className="leaflet-map" />
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

type LeafletModule = typeof import("leaflet");
type LeafletGeoJsonInput = Parameters<LeafletModule["geoJSON"]>[0];

type LeafletSyncResult = {
  listingMarkers: Marker[];
};

const MTA_SUBWAY_FEATURE_SERVICE =
  "https://services5.arcgis.com/OKgEWPlJhc3vFb8C/arcgis/rest/services/MTA_Subway_Routes_Stops/FeatureServer";
const MTA_SUBWAY_STATIONS_LAYER = 0;
const MTA_SUBWAY_ROUTES_LAYER = 1;

type SubwayGeoJsonFeature = {
  properties?: Record<string, unknown>;
};

function syncLeafletMap({
  leaflet,
  fitToListings,
  map,
  model,
  onSelect,
  selectedId,
}: {
  leaflet: LeafletModule;
  fitToListings: boolean;
  map: LeafletMap;
  model: ReturnType<typeof createMapReviewModel>;
  onSelect: (listingId: string) => void;
  selectedId?: string;
}): LeafletSyncResult {
  const listingMarkers = model.locatedCandidates.map((candidate, index) => {
    const marker = leaflet
      .marker([candidate.coordinates!.latitude, candidate.coordinates!.longitude], {
        icon: createListingLeafletIcon(
          leaflet,
          candidate,
          index + 1,
          candidate.listing.id === selectedId,
        ),
        keyboard: true,
        title: candidate.listing.title,
      })
      .addTo(map);

    marker.bindPopup(createListingPopup(candidate));
    marker.on("click", () => onSelect(candidate.listing.id));
    return marker;
  });

  if (fitToListings && model.locatedCandidates.length > 0) {
    const bounds = model.locatedCandidates.map((candidate) => [
      candidate.coordinates!.latitude,
      candidate.coordinates!.longitude,
    ]) as LatLngBoundsExpression;
    map.fitBounds(bounds, { maxZoom: 14, padding: [34, 34] });
  }

  return { listingMarkers };
}

async function addMtaSubwayOverlay(leaflet: LeafletModule, map: LeafletMap): Promise<LayerGroup> {
  const overlay = leaflet.layerGroup().addTo(map);
  const [routes, stations] = await Promise.all([
    fetchSubwayGeoJson(MTA_SUBWAY_ROUTES_LAYER),
    fetchSubwayGeoJson(MTA_SUBWAY_STATIONS_LAYER),
  ]);

  leaflet
    .geoJSON(routes, {
      onEachFeature: (feature, layer) => {
        const properties = getFeatureProperties(feature);
        const route =
          getPropertyText(properties, "route_shor") || getPropertyText(properties, "route_id");
        const name = getPropertyText(properties, "route_long");
        layer.bindPopup(
          `<strong>${escapeHtml(route || "Subway route")}</strong><br>${escapeHtml(
            name || "MTA subway route",
          )}<br>Source: MTA Subway Routes & Stops`,
        );
      },
      style: (feature) => {
        const properties = getFeatureProperties(feature);
        const color = normalizeRouteColor(getPropertyText(properties, "color"));
        return {
          color,
          interactive: true,
          opacity: 0.82,
          weight: 4,
        };
      },
    })
    .addTo(overlay);

  leaflet
    .geoJSON(stations, {
      onEachFeature: (feature, layer) => {
        const properties = getFeatureProperties(feature);
        const station = getPropertyText(properties, "stop_name") || "Subway station";
        const trains = getPropertyText(properties, "trains") || "Routes unavailable";
        layer.bindPopup(
          `<strong>${escapeHtml(station)}</strong><br>Routes: ${escapeHtml(
            trains,
          )}<br>Source: MTA Subway Routes & Stops`,
        );
      },
      pointToLayer: (feature, latlng) => {
        const properties = getFeatureProperties(feature);
        const trains = getPropertyText(properties, "trains");
        return leaflet.circleMarker(latlng, {
          className: "leaflet-subway-station",
          color: "#1e1915",
          fillColor: normalizeRouteColor(firstRouteColor(trains)),
          fillOpacity: 0.96,
          opacity: 0.86,
          radius: 4.5,
          weight: 1.5,
        });
      },
    })
    .addTo(overlay);

  return overlay;
}

async function fetchSubwayGeoJson(layerId: number): Promise<LeafletGeoJsonInput> {
  const response = await fetch(
    `${MTA_SUBWAY_FEATURE_SERVICE}/${layerId}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load MTA subway layer ${layerId}: ${response.status}`);
  }

  return response.json() as Promise<LeafletGeoJsonInput>;
}

function getFeatureProperties(feature: unknown): Record<string, unknown> {
  return ((feature as SubwayGeoJsonFeature | undefined)?.properties ?? {}) as Record<
    string,
    unknown
  >;
}

function getPropertyText(properties: Record<string, unknown>, key: string): string {
  const value = properties[key];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeRouteColor(value: string): string {
  const color = value.replace(/^#/, "").trim();
  return /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : "#6b6257";
}

function firstRouteColor(routes: string): string {
  const route =
    routes
      .split(/[\s,/]+/)
      .find(Boolean)
      ?.toUpperCase() ?? "";
  const colors: Record<string, string> = {
    "1": "EE352E",
    "2": "EE352E",
    "3": "EE352E",
    "4": "00933C",
    "5": "00933C",
    "6": "00933C",
    "7": "B933AD",
    A: "0039A6",
    C: "0039A6",
    E: "0039A6",
    B: "FF6319",
    D: "FF6319",
    F: "FF6319",
    M: "FF6319",
    G: "6CBE45",
    J: "996633",
    Z: "996633",
    L: "A7A9AC",
    N: "FCCC0A",
    Q: "FCCC0A",
    R: "FCCC0A",
    W: "FCCC0A",
    S: "808183",
  };
  return colors[route] ?? "6b6257";
}

function createListingLeafletIcon(
  leaflet: LeafletModule,
  candidate: MapReviewCandidate,
  label: number,
  selected: boolean,
): DivIcon {
  return leaflet.divIcon({
    className: "",
    html: `<span class="leaflet-listing-pin ${candidate.pinState}${selected ? " selected" : ""}">${label}</span>`,
    iconAnchor: [20, 20],
    iconSize: [40, 40],
    popupAnchor: [0, -22],
  });
}

function createListingPopup(candidate: MapReviewCandidate): string {
  return `<strong>${escapeHtml(candidate.listing.title)}</strong><br>${escapeHtml(
    candidate.listing.address,
  )}<br>${escapeHtml(formatMoney(candidate.listing.rent))} · ${candidate.listing.bedrooms ?? "?"} beds`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ListingSection({ groups = [], selectedId, onSelect, onSourceOpen }: ListingSectionProps) {
  const safeGroups = groups.map((group) => ({ ...group, listings: group.listings ?? [] }));
  const visibleListings = safeGroups.flatMap((group) => group.listings);
  const hasListings = visibleListings.length > 0;

  if (!hasListings) {
    return <p className="empty-state">No listings.</p>;
  }

  return (
    <section className="listing-section" aria-label="Listing table">
      <div className="listing-table-head" aria-hidden="true">
        <span>Status</span>
        <span>Listing</span>
        <span>Rent</span>
      </div>
      <div className="listing-cards">
        {visibleListings.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            selected={listing.id === selectedId}
            onSelect={onSelect}
            onSourceOpen={onSourceOpen}
          />
        ))}
      </div>
    </section>
  );
}

function ListingCard({
  listing,
  selected,
  onSelect,
  onSourceOpen,
}: {
  listing: ListingCandidate;
  selected: boolean;
  onSelect: (listingId: string) => void;
  onSourceOpen: (listing: ListingCandidate) => void;
}) {
  return (
    <article className={selected ? "listing-card selected" : "listing-card"}>
      <button
        type="button"
        className="listing-row-button"
        onClick={() => onSelect(listing.id)}
        aria-pressed={selected}
        aria-label={`${selected ? "Selected" : "Select"} ${listing.title}`}
      >
        <span className={`card-status status-${listing.reviewStatus}`}>
          {formatLabel(listing.reviewStatus)}
        </span>
        <span className="listing-row-main">
          <strong>{listing.title}</strong>
          <small>{listing.neighborhood ?? listing.address}</small>
        </span>
        <strong>{formatMoney(listing.rent)}</strong>
      </button>
      <a
        href={listing.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open source for ${listing.title}`}
        onClick={() => onSourceOpen(listing)}
      >
        ↗<span className="sr-only"> Source</span>
      </a>
    </article>
  );
}

function ReviewStatusDropdown({
  listing,
  onStatusChange,
}: {
  listing: ListingCandidate;
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
    setActiveStatus(status);
    setIsOpen(false);
    if (status !== listing.reviewStatus) {
      onStatusChange(listing.id, status);
    }
  }

  function moveActiveStatus(direction: 1 | -1) {
    const currentIndex = REVIEW_STATUSES.indexOf(activeStatus);
    const nextIndex = (currentIndex + direction + REVIEW_STATUSES.length) % REVIEW_STATUSES.length;
    setActiveStatus(REVIEW_STATUSES[nextIndex]);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
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
        onClick={() => setIsOpen((current) => !current)}
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
        {REVIEW_STATUSES.map((status) => {
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
  onSourceOpen,
  onReaction,
  onComment,
}: {
  identity?: InviteIdentity;
  listing?: ListingCandidate;
  actions?: ListingGroupActions;
  commentText: string;
  onCommentTextChange: (value: string) => void;
  onFieldChange: (listingId: string, field: FieldProvenance["field"], rawValue: string) => void;
  onStatusChange: (listingId: string, status: ReviewStatus) => void;
  onSourceOpen: (listing: ListingCandidate) => void;
  onReaction: (listing: ListingCandidate, reaction: GroupActionRecord["reaction"]) => void;
  onComment: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [isEditingFields, setIsEditingFields] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const firstEditInputRef = useRef<HTMLInputElement | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedListingId = listing?.id;

  useEffect(() => {
    setIsEditingFields(false);
    setSelectedPhotoIndex(0);
    setIsPhotoModalOpen(false);
  }, [selectedListingId]);

  useEffect(() => {
    if (!isPhotoModalOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPhotoModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isPhotoModalOpen]);

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
  const selectedPhotoUrl = photoUrls[selectedPhotoIndex] ?? photoUrls[0];
  const showPhotoControls = photoUrls.length > 1;
  const photoPositionLabel = `${selectedPhotoIndex + 1} of ${photoUrls.length}`;
  const selectPhoto = (index: number) => setSelectedPhotoIndex(index);
  const handlePreviousPhoto = () => {
    setSelectedPhotoIndex((currentIndex) =>
      currentIndex === 0 ? photoUrls.length - 1 : currentIndex - 1,
    );
  };
  const handleNextPhoto = () => {
    setSelectedPhotoIndex((currentIndex) =>
      currentIndex === photoUrls.length - 1 ? 0 : currentIndex + 1,
    );
  };
  const handleCommentToggle = (event: ToggleEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open) {
      commentInputRef.current?.focus();
    }
  };

  return (
    <article className="editor-panel" aria-label="Listing detail panel">
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

      <ReviewStatusDropdown listing={listing} onStatusChange={onStatusChange} />

      {photoUrls.length > 0 ? (
        <section className="listing-photo-carousel" aria-label={`Photos for ${listing.title}`}>
          <figure className="listing-photo-frame">
            <button
              type="button"
              className="listing-photo-open"
              aria-label={`Enlarge photo ${selectedPhotoIndex + 1} of ${photoUrls.length} for ${listing.title}`}
              onClick={() => setIsPhotoModalOpen(true)}
            >
              <img
                src={selectedPhotoUrl}
                alt={`${listing.title} photo ${selectedPhotoIndex + 1}`}
                loading="lazy"
              />
            </button>
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
            <div className="listing-photo-thumbnails" aria-label="Choose listing photo">
              {photoUrls.map((photoUrl, index) => (
                <button
                  type="button"
                  key={`${photoUrl}-${index}`}
                  className="listing-photo-thumbnail"
                  aria-label={`Show photo ${index + 1} of ${photoUrls.length} for ${listing.title}`}
                  aria-current={index === selectedPhotoIndex ? "true" : undefined}
                  onClick={() => selectPhoto(index)}
                >
                  <img src={photoUrl} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

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
              <img
                src={selectedPhotoUrl}
                alt={`${listing.title} photo ${selectedPhotoIndex + 1}`}
              />
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
                    aria-current={index === selectedPhotoIndex ? "true" : undefined}
                    onClick={() => selectPhoto(index)}
                  >
                    <img src={photoUrl} alt="" loading="lazy" />
                  </button>
                ))}
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
          <p>{listing.description}</p>
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

function formatMoney(value?: number) {
  if (value === undefined) {
    return "Rent TBD";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatListingAddedAge(createdAt: string) {
  const createdTime = new Date(createdAt).getTime();

  if (!Number.isFinite(createdTime)) {
    return "TBD";
  }

  const dayInMilliseconds = 24 * 60 * 60 * 1000;
  const ageDays = Math.max(0, Math.floor((Date.now() - createdTime) / dayInMilliseconds));

  return `${ageDays} ${ageDays === 1 ? "day" : "days"}`;
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

function formatDateTimeLabel(value: string) {
  return value.slice(0, 16).replace("T", " ");
}

function formatDateLabel(value: string) {
  return value.slice(0, 10);
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

function formatLabel(value: string) {
  return value.replace(/[-_]/g, " ");
}
