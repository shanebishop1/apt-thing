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
  BriefingRunHistoryContract,
  BriefingRunHistoryRun,
  EvidenceStoragePointer,
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
const stadiaMapsApiKey = process.env.NEXT_PUBLIC_STADIA_MAPS_API_KEY?.trim();
const leafletTileLayer = stadiaMapsApiKey
  ? {
      attribution: "",
      maxZoom: 20,
      url: `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${encodeURIComponent(stadiaMapsApiKey)}`,
    }
  : {
      attribution: "",
      maxZoom: 19,
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    };

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
const noopSelectListing = () => {};

const appTabs: Array<{ id: AppTab; label: string }> = [
  { id: "dashboard", label: "List" },
  { id: "map", label: "Map" },
  { id: "history", label: "Runs" },
];

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

export type RunHistoryArtifactPointer = {
  id: string;
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
  isLatest: boolean;
  counts: BriefingRunHistoryRun["counts"];
  apiMatchedCount: number;
  checkedOrScrapedCount: number;
  checkedOrScrapedLabel: string;
  skippedCount: number;
  aiCallCount: number;
  aiOutputLabel: string;
  sourceCoverage: SourceCoverageSummary[];
  failures: SourceCoverageSummary[];
  providerMetadata: string[];
  providerDetails: string[];
  artifactPointers: RunHistoryArtifactPointer[];
  candidateSummaries: BriefingRunHistoryRun["candidateSummaries"];
};

export type RunHistoryPanelModel = {
  runs: RunHistoryPanelRunModel[];
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
              onReviewDecision={handleReviewDecision}
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

export function createRunHistoryPanelModel(
  history: BriefingRunHistoryContract,
): RunHistoryPanelModel {
  const latestRunId = history.latestRun.runId;
  const runs = [...history.runs]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .map((run) => {
      const sourceCoverage = run.sourceCoverage.filter(
        (coverage) => !isSyntheticFixtureCoverage(coverage),
      );
      const artifactPointers = createRunArtifactPointers(run, sourceCoverage);
      const failures = sourceCoverage.filter((coverage) => coverage.status === "failed");
      const counts = { ...run.counts, sourceFailures: failures.length };
      const checkedCount = sourceCoverage.reduce(
        (total, coverage) => total + coverage.checkedCount,
        0,
      );
      const aiCallCount = run.providerMetadata.length;
      const skippedCount = run.counts.candidatesSkippedSeen + run.counts.candidatesSkippedTriaged;
      const checkedOrScrapedLabel =
        checkedCount > 0 ? String(checkedCount) : "Not separately recorded";

      return {
        runId: run.runId,
        heading: createRunHistoryHeading(run),
        cadence: run.cadence,
        trigger: run.trigger,
        status: run.status,
        statusLabel: formatLabel(run.status),
        startedLabel: formatDateTimeLabel(run.startedAt),
        completedLabel: run.completedAt ? formatDateTimeLabel(run.completedAt) : "Still running",
        isLatest: run.runId === latestRunId,
        counts,
        apiMatchedCount: counts.candidatesFound,
        checkedOrScrapedCount: checkedCount,
        checkedOrScrapedLabel,
        skippedCount,
        aiCallCount,
        aiOutputLabel: `${counts.confirmedMatches} yes / ${counts.reviewNeeded} review / ${counts.rejected} no`,
        sourceCoverage,
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
          ]).join(" / "),
        ),
        artifactPointers,
        candidateSummaries: run.candidateSummaries,
      } satisfies RunHistoryPanelRunModel;
    });

  return {
    runs,
  };
}

export function RunHistoryPanel({ history }: { history: BriefingRunHistoryContract }) {
  const model = createRunHistoryPanelModel(history);
  const [expandedRunId, setExpandedRunId] = useState<string | undefined>();
  const handleRunToggle = (runId: string, event: ToggleEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open) {
      setExpandedRunId(runId);
      return;
    }

    setExpandedRunId((currentRunId) => (currentRunId === runId ? undefined : currentRunId));
  };

  return (
    <section className="run-history-card" aria-label="Agent run history">
      <header className="run-history-header">
        <div>
          <p className="eyebrow">Run history</p>
          <h2>Runs</h2>
        </div>
      </header>

      <div className="run-table" aria-label="Agent runs table">
        <div className="run-table-head" aria-hidden="true">
          <span>Started</span>
          <span>Status</span>
          <span>Trigger</span>
          <span>Candidates</span>
          <span>Source checks</span>
          <span>Outcome</span>
        </div>
        {model.runs.map((run) => (
          <details
            key={run.runId}
            className="run-history-item"
            open={expandedRunId === run.runId}
            onToggle={(event) => handleRunToggle(run.runId, event)}
          >
            <summary>
              <span className="run-cell run-start-cell">
                <span className={`run-status-dot ${run.status}`} aria-label={run.statusLabel} />
                <span>
                  <strong>{run.startedLabel}</strong>
                  <small>{run.isLatest ? "Latest run" : run.heading}</small>
                </span>
              </span>
              <span className="run-cell">
                <span className={`run-status-badge ${run.status}`}>{run.statusLabel}</span>
              </span>
              <span className="run-cell">
                <strong>{formatLabel(run.cadence)}</strong>
                <small>{formatLabel(run.trigger)}</small>
              </span>
              <span className="run-cell">
                <strong>{run.apiMatchedCount}</strong>
                <small>candidate matches found</small>
              </span>
              <span className="run-cell">
                <strong>{run.checkedOrScrapedLabel}</strong>
                <small>source records checked</small>
              </span>
              <span className="run-cell run-output-cell">
                <strong>{run.aiOutputLabel}</strong>
                <small>{run.aiCallCount} AI attempt(s) recorded</small>
              </span>
            </summary>

            <div className="run-history-detail">
              <section className="run-history-section" aria-label={`${run.heading} count notes`}>
                <h4>How to read the counts</h4>
                <p>
                  Source checks are records inspected by source adapters. Candidate matches are the
                  smaller set that became run candidates, so source checks can be higher than
                  matches. AI attempts are recorded provider attempts, not necessarily one call per
                  listing.
                </p>
              </section>

              <section className="run-detail-grid" aria-label={`${run.heading} pipeline counts`}>
                <RunMetric label="Candidate matches found" value={String(run.apiMatchedCount)} />
                <RunMetric label="Source records checked" value={run.checkedOrScrapedLabel} />
                <RunMetric label="Skipped prior" value={String(run.skippedCount)} />
                <RunMetric label="AI attempts recorded" value={String(run.aiCallCount)} />
                <RunMetric label="Triaged" value={String(run.counts.candidatesTriaged)} />
                <RunMetric label="Source failures" value={String(run.counts.sourceFailures)} />
              </section>

              <section className="run-output-grid" aria-label={`${run.heading} AI output`}>
                <RunMetric label="Meets criteria" value={String(run.counts.confirmedMatches)} />
                <RunMetric label="Needs review" value={String(run.counts.reviewNeeded)} />
                <RunMetric label="Does not meet criteria" value={String(run.counts.rejected)} />
              </section>

              <section
                className="run-history-section"
                aria-label={`${run.heading} output listings`}
              >
                <h4>Output listings</h4>
                {run.candidateSummaries.length === 0 ? (
                  <p>No candidate output recorded for this run.</p>
                ) : (
                  <div className="run-output-list">
                    {run.candidateSummaries.map((candidate) => (
                      <article key={`${run.runId}-${candidate.listingId}`}>
                        <span>{formatLabel(candidate.bucket)}</span>
                        <strong>{candidate.title}</strong>
                        <small>{candidate.suggestedAction}</small>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section
                className="run-history-section"
                aria-label={`${run.heading} source coverage`}
              >
                <h4>Source/API coverage</h4>
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
                        {coverage.candidateCount} API match(es), {coverage.checkedCount} checked,{" "}
                        {coverage.rawArtifactPointers.length} storage pointer(s)
                        {coverage.failureCode ? ` · ${coverage.failureCode}` : ""}
                      </p>
                      {coverage.failureMessage ? <p>{coverage.failureMessage}</p> : null}
                    </article>
                  ))}
                </div>
              </section>

              <section
                className="run-history-section"
                aria-label={`${run.heading} provider metadata`}
              >
                <h4>AI calls</h4>
                {run.providerMetadata.length === 0 ? (
                  <p>No AI call metadata recorded for this run.</p>
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
                aria-label={`${run.heading} storage pointers`}
              >
                <h4>Stored pointers</h4>
                {run.artifactPointers.length === 0 ? (
                  <p>No storage pointers recorded for this run.</p>
                ) : (
                  <>
                    <p>
                      These are D1 storage keys for evidence metadata rows retained by the run. They
                      are not openable files yet because there is no artifact viewer route.
                    </p>
                    <div className="artifact-pointer-grid">
                      {run.artifactPointers.map((artifact) => (
                        <div id={artifact.id} key={artifact.id} className="artifact-pointer-row">
                          <span>{artifact.label}</span>
                          <strong>{artifact.storageKey}</strong>
                          {artifact.contentType ? <small>{artifact.contentType}</small> : null}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </div>
          </details>
        ))}
      </div>
    </section>
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

function createRunArtifactPointers(
  run: BriefingRunHistoryRun,
  sourceCoverage: SourceCoverageSummary[],
): RunHistoryArtifactPointer[] {
  const pointers = uniquePointers([
    ...run.rawArtifactPointers.filter((pointer) => !isSyntheticFixturePointer(pointer)),
    ...sourceCoverage.flatMap((coverage) => coverage.rawArtifactPointers),
    ...run.candidateSummaries.flatMap((candidate) => candidate.evidenceSummary.rawArtifactPointers),
  ]).filter((pointer) => !isSyntheticFixturePointer(pointer));

  return pointers.map((pointer, index) => {
    const id = `artifact-${slugify(run.runId)}-${index}`;

    return {
      id,
      label: `${pointer.owner.toUpperCase()} pointer`,
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

function isSyntheticFixtureCoverage(coverage: SourceCoverageSummary): boolean {
  return (
    coverage.source.startsWith("fixture-") || coverage.failureCode?.startsWith("fixture-") === true
  );
}

function isSyntheticFixturePointer(pointer: EvidenceStoragePointer): boolean {
  return pointer.key.includes("source-failure") || pointer.key.includes("fixture-");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueNonEmpty(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
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
          <LeafletListingMap model={model} selectedId={selectedId} onSelect={onSelect} />
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

function LeafletListingMap({
  model,
  selectedId,
  onSelect,
  className = "leaflet-map",
}: {
  model: ReturnType<typeof createMapReviewModel>;
  selectedId?: string;
  onSelect: (listingId: string) => void;
  className?: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<LeafletMap | null>(null);
  const groceryMarkersRef = useRef<Marker[]>([]);
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

      leaflet.tileLayer(leafletTileLayer.url, leafletTileLayer).addTo(map);
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
      groceryMarkersRef.current = nextMarkers.groceryMarkers;
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
      groceryMarkersRef.current.forEach((marker) => marker.remove());
      listingMarkersRef.current.forEach((marker) => marker.remove());
      subwayOverlayRef.current?.remove();
      groceryMarkersRef.current = [];
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

    groceryMarkersRef.current.forEach((marker) => marker.remove());
    listingMarkersRef.current.forEach((marker) => marker.remove());
    const nextMarkers = syncLeafletMap({
      fitToListings: false,
      leaflet,
      map,
      model,
      onSelect,
      selectedId,
    });
    groceryMarkersRef.current = nextMarkers.groceryMarkers;
    listingMarkersRef.current = nextMarkers.listingMarkers;
  }, [model, onSelect, selectedId]);

  return <div ref={mapContainerRef} className={className} />;
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
  groceryMarkers: Marker[];
  listingMarkers: Marker[];
};

type GroceryStoreBrand = "whole-foods" | "trader-joes";

type GroceryStoreLocation = {
  id: string;
  brand: GroceryStoreBrand;
  name: string;
  address: string;
  borough: string;
  latitude: number;
  longitude: number;
  sourceUrl: string;
};

const groceryStoreLocations: GroceryStoreLocation[] = [
  {
    id: "tj-72nd-broadway",
    brand: "trader-joes",
    name: "Trader Joe's 72nd & Broadway",
    address: "2073 Broadway, New York, NY 10023",
    borough: "Manhattan",
    latitude: 40.77895,
    longitude: -73.98258,
    sourceUrl: "https://locations.traderjoes.com/ny/new-york/542/",
  },
  {
    id: "tj-chelsea",
    brand: "trader-joes",
    name: "Trader Joe's Chelsea",
    address: "675 6th Ave, New York, NY 10010",
    borough: "Manhattan",
    latitude: 40.74129,
    longitude: -73.99375,
    sourceUrl: "https://locations.traderjoes.com/ny/new-york/543/",
  },
  {
    id: "tj-east-village",
    brand: "trader-joes",
    name: "Trader Joe's East Village",
    address: "436 East 14th St, New York, NY 10009",
    borough: "Manhattan",
    latitude: 40.73164,
    longitude: -73.98194,
    sourceUrl: "https://locations.traderjoes.com/ny/new-york/546/",
  },
  {
    id: "tj-essex-crossing",
    brand: "trader-joes",
    name: "Trader Joe's Essex Crossing",
    address: "400 Grand St. (Cellar), New York, NY 10002",
    borough: "Manhattan",
    latitude: 40.71567,
    longitude: -73.98611,
    sourceUrl: "https://locations.traderjoes.com/ny/new-york/538/",
  },
  {
    id: "tj-harlem",
    brand: "trader-joes",
    name: "Trader Joe's Harlem",
    address: "123 W 125th St, New York, NY 10027",
    borough: "Manhattan",
    latitude: 40.80844,
    longitude: -73.94558,
    sourceUrl: "https://locations.traderjoes.com/ny/new-york/576/",
  },
  {
    id: "tj-murray-hill",
    brand: "trader-joes",
    name: "Trader Joe's Murray Hill",
    address: "200 E 32nd St, New York, NY 10016",
    borough: "Manhattan",
    latitude: 40.74447,
    longitude: -73.97915,
    sourceUrl: "https://locations.traderjoes.com/ny/new-york/544/",
  },
  {
    id: "tj-soho",
    brand: "trader-joes",
    name: "Trader Joe's SoHo",
    address: "233 Spring Street, New York, NY 10013",
    borough: "Manhattan",
    latitude: 40.72568,
    longitude: -74.00476,
    sourceUrl: "https://locations.traderjoes.com/ny/new-york/539/",
  },
  {
    id: "tj-union-square",
    brand: "trader-joes",
    name: "Trader Joe's Union Square",
    address: "142 E 14th St, New York, NY 10003",
    borough: "Manhattan",
    latitude: 40.7341,
    longitude: -73.98853,
    sourceUrl: "https://locations.traderjoes.com/ny/new-york/540/",
  },
  {
    id: "tj-bridgemarket",
    brand: "trader-joes",
    name: "Trader Joe's Upper East Side - Bridgemarket",
    address: "405 E. 59th Street, New York, NY 10022",
    borough: "Manhattan",
    latitude: 40.759,
    longitude: -73.95994,
    sourceUrl: "https://locations.traderjoes.com/ny/new-york/571/",
  },
  {
    id: "tj-upper-west-side",
    brand: "trader-joes",
    name: "Trader Joe's Upper West Side",
    address: "670 Columbus Ave, New York, NY 10025",
    borough: "Manhattan",
    latitude: 40.79077,
    longitude: -73.96771,
    sourceUrl: "https://locations.traderjoes.com/ny/new-york/545/",
  },
  {
    id: "tj-city-point",
    brand: "trader-joes",
    name: "Trader Joe's Brooklyn - City Point",
    address: "445 Gold St, Brooklyn, NY 11201",
    borough: "Brooklyn",
    latitude: 40.69118,
    longitude: -73.98306,
    sourceUrl: "https://locations.traderjoes.com/ny/brooklyn/547/",
  },
  {
    id: "tj-williamsburg",
    brand: "trader-joes",
    name: "Trader Joe's Brooklyn - Williamsburg",
    address: "200 Kent Ave, Brooklyn, NY 11249",
    borough: "Brooklyn",
    latitude: 40.7177,
    longitude: -73.96465,
    sourceUrl: "https://locations.traderjoes.com/ny/brooklyn/548/",
  },
  {
    id: "tj-court-street",
    brand: "trader-joes",
    name: "Trader Joe's Brooklyn",
    address: "130 Court St, Brooklyn, NY 11201",
    borough: "Brooklyn",
    latitude: 40.69039,
    longitude: -73.99202,
    sourceUrl: "https://locations.traderjoes.com/ny/brooklyn/558/",
  },
  {
    id: "tj-forest-hills",
    brand: "trader-joes",
    name: "Trader Joe's Forest Hills",
    address: "69-65 Yellowstone Blvd, Queens, NY 11375",
    borough: "Queens",
    latitude: 40.72278,
    longitude: -73.84618,
    sourceUrl: "https://locations.traderjoes.com/ny/queens/578/",
  },
  {
    id: "tj-long-island-city",
    brand: "trader-joes",
    name: "Trader Joe's Long Island City",
    address: "22-43 Jackson Ave, Queens, NY 11101",
    borough: "Queens",
    latitude: 40.7453,
    longitude: -73.94531,
    sourceUrl: "https://locations.traderjoes.com/ny/queens/565/",
  },
  {
    id: "tj-rego-park",
    brand: "trader-joes",
    name: "Trader Joe's Rego Park",
    address: "9030 Metropolitan Ave, Queens, NY 11374",
    borough: "Queens",
    latitude: 40.71265,
    longitude: -73.86155,
    sourceUrl: "https://locations.traderjoes.com/ny/queens/557/",
  },
  {
    id: "tj-south-shore",
    brand: "trader-joes",
    name: "Trader Joe's Staten Island - South Shore",
    address: "6400 Amboy Rd, Staten Island, NY 10309",
    borough: "Staten Island",
    latitude: 40.51906,
    longitude: -74.22085,
    sourceUrl: "https://locations.traderjoes.com/ny/staten-island/580/",
  },
  {
    id: "tj-staten-island",
    brand: "trader-joes",
    name: "Trader Joe's Staten Island",
    address: "2385 Richmond Ave, Staten Island, NY 10314",
    borough: "Staten Island",
    latitude: 40.58162,
    longitude: -74.16554,
    sourceUrl: "https://locations.traderjoes.com/ny/staten-island/559/",
  },
  {
    id: "wf-upper-east-side",
    brand: "whole-foods",
    name: "Whole Foods Market Upper East Side",
    address: "1551 3rd Ave, New York, NY 10128",
    borough: "Manhattan",
    latitude: 40.78038,
    longitude: -73.95231,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/uppereastside",
  },
  {
    id: "wf-columbus-circle",
    brand: "whole-foods",
    name: "Whole Foods Market Columbus Circle",
    address: "10 Columbus Cir, Ste Sc101, New York, NY 10019",
    borough: "Manhattan",
    latitude: 40.76847,
    longitude: -73.98273,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/columbuscircle",
  },
  {
    id: "wf-manhattan-west",
    brand: "whole-foods",
    name: "Whole Foods Market Manhattan West",
    address: "450 W 33rd St, New York, NY 10001",
    borough: "Manhattan",
    latitude: 40.75323,
    longitude: -73.99807,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/manhattanwest",
  },
  {
    id: "wf-midtown-east",
    brand: "whole-foods",
    name: "Whole Foods Market Midtown East",
    address: "226 E 57th St, New York, NY 10022",
    borough: "Manhattan",
    latitude: 40.76,
    longitude: -73.96619,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/midtown-east",
  },
  {
    id: "wf-stuytown",
    brand: "whole-foods",
    name: "Whole Foods Market Stuytown",
    address: "409 E 14th St, New York, NY 10009",
    borough: "Manhattan",
    latitude: 40.73171,
    longitude: -73.98279,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/stuytown",
  },
  {
    id: "wf-hells-kitchen",
    brand: "whole-foods",
    name: "Whole Foods Market Hell's Kitchen",
    address: "525 W 52nd St, New York, NY 10019",
    borough: "Manhattan",
    latitude: 40.76665,
    longitude: -73.99194,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/hellskitchen",
  },
  {
    id: "wf-harlem",
    brand: "whole-foods",
    name: "Whole Foods Market Harlem",
    address: "100 W 125th St, New York, NY 10027",
    borough: "Manhattan",
    latitude: 40.80828,
    longitude: -73.94554,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/harlem",
  },
  {
    id: "wf-upper-west-side",
    brand: "whole-foods",
    name: "Whole Foods Market Upper West Side",
    address: "808 Columbus Ave, New York, NY 10025",
    borough: "Manhattan",
    latitude: 40.79536,
    longitude: -73.96543,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/upperwestside",
  },
  {
    id: "wf-nomad",
    brand: "whole-foods",
    name: "Whole Foods Market NoMad",
    address: "63 Madison Ave, New York, NY 10016",
    borough: "Manhattan",
    latitude: 40.74375,
    longitude: -73.98636,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/nomad",
  },
  {
    id: "wf-tribeca",
    brand: "whole-foods",
    name: "Whole Foods Market Tribeca",
    address: "270 Greenwich St, New York, NY 10007",
    borough: "Manhattan",
    latitude: 40.71562,
    longitude: -74.01168,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/tribeca",
  },
  {
    id: "wf-bowery",
    brand: "whole-foods",
    name: "Whole Foods Market Bowery",
    address: "95 East Houston St, New York, NY 10002",
    borough: "Manhattan",
    latitude: 40.72496,
    longitude: -73.99229,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/bowery",
  },
  {
    id: "wf-chelsea",
    brand: "whole-foods",
    name: "Whole Foods Market Chelsea",
    address: "250 7th Ave, New York, NY 10001",
    borough: "Manhattan",
    latitude: 40.74485,
    longitude: -73.99521,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/chelsea",
  },
  {
    id: "wf-union-square",
    brand: "whole-foods",
    name: "Whole Foods Market Union Square",
    address: "4 Union Square S, New York, NY 10003",
    borough: "Manhattan",
    latitude: 40.73591,
    longitude: -73.99108,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/unionsquare",
  },
  {
    id: "wf-one-wall-street",
    brand: "whole-foods",
    name: "Whole Foods Market One Wall Street",
    address: "66 Broadway, New York, NY 10005",
    borough: "Manhattan",
    latitude: 40.70645,
    longitude: -74.01305,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/onewallstreet",
  },
  {
    id: "wf-bryant-park",
    brand: "whole-foods",
    name: "Whole Foods Market Bryant Park",
    address: "1095 6th Ave, New York, NY 10036",
    borough: "Manhattan",
    latitude: 40.7544,
    longitude: -73.9845,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/bryantpark",
  },
  {
    id: "wf-lenox-hill",
    brand: "whole-foods",
    name: "Whole Foods Market Lenox Hill",
    address: "1175 3rd Ave, New York, NY 10065",
    borough: "Manhattan",
    latitude: 40.76783,
    longitude: -73.96294,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/lenoxhill",
  },
  {
    id: "wf-brooklyn-third-street",
    brand: "whole-foods",
    name: "Whole Foods Market Brooklyn",
    address: "214 3rd St, Brooklyn, NY 11215",
    borough: "Brooklyn",
    latitude: 40.67494,
    longitude: -73.98764,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/thirdand3rd",
  },
  {
    id: "wf-williamsburg",
    brand: "whole-foods",
    name: "Whole Foods Market Williamsburg",
    address: "238 Bedford Ave, Brooklyn, NY 11249",
    borough: "Brooklyn",
    latitude: 40.7167,
    longitude: -73.95962,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/williamsburg",
  },
  {
    id: "wf-fort-greene",
    brand: "whole-foods",
    name: "Whole Foods Market Fort Greene",
    address: "292 Ashland Pl, Brooklyn, NY 11217",
    borough: "Brooklyn",
    latitude: 40.68668,
    longitude: -73.97788,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/fortgreene",
  },
  {
    id: "wf-industry-city",
    brand: "whole-foods",
    name: "Whole Foods Market Industry City",
    address: "167 41st St, Brooklyn, NY 11232",
    borough: "Brooklyn",
    latitude: 40.6551,
    longitude: -74.00628,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/industrycity",
  },
  {
    id: "wf-grand-street",
    brand: "whole-foods",
    name: "Whole Foods Market Grand Street",
    address: "774 Grand Street, Brooklyn, NY 11211",
    borough: "Brooklyn",
    latitude: 40.71129,
    longitude: -73.94401,
    sourceUrl: "https://www.wholefoodsmarket.com/stores/grandstreet",
  },
];

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
  const groceryMarkers = groceryStoreLocations.map((store) => {
    const marker = leaflet
      .marker([store.latitude, store.longitude], {
        icon: createGroceryLeafletIcon(leaflet, store),
        keyboard: true,
        title: `${store.name} grocery context`,
        zIndexOffset: -120,
      })
      .addTo(map);

    marker.bindPopup(createGroceryPopup(store));
    return marker;
  });

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

  return { groceryMarkers, listingMarkers };
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
    html: `<span class="leaflet-listing-pin ${candidate.pinState}${selected ? " selected" : ""}"><span class="leaflet-listing-pin-label">${label}</span></span>`,
    iconAnchor: [16, 39],
    iconSize: [32, 40],
    popupAnchor: [0, -39],
  });
}

function createGroceryLeafletIcon(leaflet: LeafletModule, store: GroceryStoreLocation): DivIcon {
  const brandLabel = store.brand === "whole-foods" ? "Whole Foods" : "Trader Joe's";
  const logoText = store.brand === "whole-foods" ? "Whole\nFoods" : "Trader\nJoe's";

  return leaflet.divIcon({
    className: "",
    html: `<span class="leaflet-grocery-pin ${store.brand}" aria-label="${escapeHtml(
      `${brandLabel} location`,
    )}"><span>${escapeHtml(logoText)}</span></span>`,
    iconAnchor: [9, 9],
    iconSize: [18, 18],
    popupAnchor: [0, -10],
  });
}

function createListingPopup(candidate: MapReviewCandidate): string {
  return `<strong>${escapeHtml(candidate.listing.title)}</strong><br>${escapeHtml(
    candidate.listing.address,
  )}<br>${escapeHtml(formatMoney(candidate.listing.rent))} · ${candidate.listing.bedrooms ?? "?"} beds`;
}

function createGroceryPopup(store: GroceryStoreLocation): string {
  const sourceLabel =
    store.brand === "whole-foods" ? "Whole Foods store page" : "Trader Joe's store page";
  return `<strong>${escapeHtml(store.name)}</strong><br>${escapeHtml(store.address)}<br>${escapeHtml(
    store.borough,
  )}<br><a href="${escapeHtml(store.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(
    sourceLabel,
  )}</a>`;
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
        <span>Avg Rent</span>
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
        <strong>{formatAverageRent(listing)}</strong>
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
  onReviewDecision,
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
  onReviewDecision: (listingId: string, decision: "approve" | "reject") => void;
  onSourceOpen: (listing: ListingCandidate) => void;
  onReaction: (listing: ListingCandidate, reaction: GroupActionRecord["reaction"]) => void;
  onComment: (event: FormEvent<HTMLFormElement>) => void;
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
  const isReviewNeeded =
    listing.triageBucket === "review-needed" || listing.reviewStatus === "review";
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
            <button type="button" onClick={() => onReviewDecision(listing.id, "approve")}>
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
            <ListingInlineMap listing={listing} />
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
                <ListingInlineMap listing={listing} />
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

function ListingInlineMap({ listing }: { listing: ListingCandidate }) {
  const model = createMapReviewModel([listing], listing.id);

  return (
    <div className="listing-inline-map-shell" aria-label={`Interactive map for ${listing.title}`}>
      <LeafletListingMap
        model={model}
        selectedId={listing.id}
        onSelect={noopSelectListing}
        className="listing-inline-map"
      />
    </div>
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

function RunMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="run-metric">
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

export function formatAverageRent(listing: Pick<ListingCandidate, "rent" | "bedrooms">) {
  if (listing.rent === undefined || listing.bedrooms === undefined || listing.bedrooms <= 0) {
    return "?";
  }

  return formatMoney(listing.rent / listing.bedrooms);
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

function formatDateTimeLabel(value: string) {
  return value.slice(0, 16).replace("T", " ");
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
