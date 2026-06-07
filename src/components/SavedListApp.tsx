"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import {
  appendGroupAction,
  createListingGroupActions,
  createReviewDashboardModel,
  createSavedListing,
  createSelectedListingStorageKey,
  findSelectedListing,
  getFixtureBatchRunSummary,
  getFixtureListingsForGroup,
  readGroupActions,
  readInviteIdentity,
  readSeenRejectedMemory,
  readSavedListings,
  updateSavedListingField,
  updateSavedListingStatus,
  upsertRejectedMemory,
  writeGroupActions,
  writeInviteIdentity,
  writeSeenRejectedMemory,
  writeSavedListings,
  type ListingGroupActions,
  type ReviewBatchRunSummary,
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
  createInviteIdentity,
  defaultSearchGroup,
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

const defaultIdentityForm = {
  inviteCode: defaultSearchGroup.inviteCode,
  displayName: "Local reviewer",
};
const defaultIdentity = createInviteIdentity(
  defaultIdentityForm.inviteCode,
  defaultIdentityForm.displayName,
)!;
const fixtureBatchRunSummary = getFixtureBatchRunSummary();
const fixtureBriefingRunHistory = g3cBriefingRunHistoryFixture;

type IdentityFormState = typeof defaultIdentityForm;
type FeedbackCategory = NonNullable<GroupActionRecord["feedback"]>["category"];

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
  title: string;
  eyebrow: string;
  description: string;
  listings: ListingCandidate[];
  selectedId?: string;
  emptyText: string;
  onSelect: (listingId: string) => void;
  onSourceOpen: (listing: ListingCandidate) => void;
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
  const [identity, setIdentity] = useState<InviteIdentity | undefined>(defaultIdentity);
  const [listings, setListings] = useState<ListingCandidate[]>(() =>
    getFixtureListingsForGroup(defaultSearchGroup.id),
  );
  const [groupActions, setGroupActions] = useState<GroupActionRecord[]>([]);
  const [seenRejectedMemory, setSeenRejectedMemory] = useState<SeenRejectedMemoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>(listings[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [commentText, setCommentText] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory>("fit");
  const [message, setMessage] = useState(
    "Local mock storage is ready. Add a source link or inspect the current batch review queue.",
  );
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    try {
      const savedIdentity = readInviteIdentity(window.localStorage);
      const activeIdentity =
        savedIdentity?.kind === "valid" ? savedIdentity.identity : defaultIdentity;

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
        setMessage(savedIdentity.feedback);
        return;
      }

      const hydratedListings = readSavedListings(window.localStorage, activeIdentity.groupId);
      const hydratedActions = readGroupActions(window.localStorage, activeIdentity.groupId);
      const hydratedMemory = readSeenRejectedMemory(window.localStorage, activeIdentity.groupId);
      const savedSelectedId = window.localStorage.getItem(
        createSelectedListingStorageKey(activeIdentity.groupId),
      );

      setIdentity(activeIdentity);
      setListings(hydratedListings);
      setGroupActions(hydratedActions);
      setSeenRejectedMemory(hydratedMemory);
      setSelectedId(findSelectedListing(hydratedListings, savedSelectedId)?.id ?? "");
      setMessage(
        savedIdentity
          ? "Re-opened the active group's locally saved listings."
          : "Loaded fixture listings, including the latest StreetEasy batch review queue.",
      );
    } catch {
      setMessage("Browser storage is unavailable; using fixture listings for this session.");
    } finally {
      setHasHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hasHydrated || !identity) {
      return;
    }

    try {
      writeSavedListings(window.localStorage, identity.groupId, listings);
    } catch {
      setMessage("Could not persist saved listings in this browser session.");
    }
  }, [hasHydrated, identity, listings]);

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

  const dashboard = useMemo(
    () => createReviewDashboardModel(listings, fixtureBatchRunSummary),
    [listings],
  );
  const mapReview = useMemo(
    () => createMapReviewModel(listings, selectedId),
    [listings, selectedId],
  );
  const selectedListing = identity ? findSelectedListing(listings, selectedId) : undefined;
  const counts = dashboard.counts;

  function handleIdentityChange(field: keyof IdentityFormState, value: string) {
    const nextForm = { ...identityForm, [field]: value };

    setIdentityForm(nextForm);

    try {
      const resolution = writeInviteIdentity(
        window.localStorage,
        nextForm.inviteCode,
        nextForm.displayName,
      );

      if (resolution.kind === "invalid") {
        setIdentity(undefined);
        setListings([]);
        setSelectedId("");
        setMessage(resolution.feedback);
        return;
      }

      const groupChanged = identity?.groupId !== resolution.identity.groupId;

      setIdentity(resolution.identity);

      if (groupChanged) {
        const hydratedListings = readSavedListings(
          window.localStorage,
          resolution.identity.groupId,
        );
        const hydratedActions = readGroupActions(window.localStorage, resolution.identity.groupId);
        const hydratedMemory = readSeenRejectedMemory(
          window.localStorage,
          resolution.identity.groupId,
        );
        const savedSelectedId = window.localStorage.getItem(
          createSelectedListingStorageKey(resolution.identity.groupId),
        );

        setListings(hydratedListings);
        setGroupActions(hydratedActions);
        setSeenRejectedMemory(hydratedMemory);
        setSelectedId(findSelectedListing(hydratedListings, savedSelectedId)?.id ?? "");
      }

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

    startTransition(() => {
      try {
        const result = createSavedListing(listings, url, identity);
        setListings(result.listings);

        if (result.kind === "rejected") {
          setMessage(result.feedback);
          return;
        }

        setSelectedId(result.listing.id);
        setUrl("");
        setMessage(result.feedback);
      } catch {
        setMessage("Unable to save this listing right now.");
      }
    });
  }

  function handleStatusChange(listingId: string, status: ReviewStatus) {
    if (!identity) {
      setMessage("Enter a valid invite code before updating group records.");
      return;
    }

    const listing = listings.find(
      (currentListing) =>
        currentListing.groupId === identity.groupId && currentListing.id === listingId,
    );

    const updatedListings = updateSavedListingStatus(listings, identity.groupId, listingId, status);
    const updatedListing = updatedListings.find(
      (currentListing) =>
        currentListing.groupId === identity.groupId && currentListing.id === listingId,
    );

    setListings(updatedListings);
    if (listing) {
      persistGroupActions(
        appendGroupAction(groupActions, identity, listing, { actionType: "status-change", status }),
      );
    }
    if (updatedListing?.reviewStatus === "rejected") {
      persistSeenRejectedMemory(
        upsertRejectedMemory(
          seenRejectedMemory,
          updatedListing,
          `Rejected by ${identity.displayName}`,
        ),
      );
    }
    setMessage(`Status updated to ${status}.`);
  }

  function handleSourceOpen(listing: ListingCandidate) {
    if (!identity) {
      setMessage("Enter a valid invite code before opening source links as a group action.");
      return;
    }

    persistGroupActions(
      appendGroupAction(groupActions, identity, listing, {
        actionType: "source-link-open",
        sourceUrl: listing.url,
      }),
    );
    setMessage("Original source opened and recorded for group review context.");
  }

  function handleReaction(listing: ListingCandidate, reaction: GroupActionRecord["reaction"]) {
    if (!identity || !reaction) {
      setMessage("Enter a valid invite code before reacting to group records.");
      return;
    }

    persistGroupActions(
      appendGroupAction(groupActions, identity, listing, { actionType: "reaction", reaction }),
    );
    setMessage(`Reaction recorded: ${reaction}.`);
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

    persistGroupActions(
      appendGroupAction(groupActions, identity, selectedListing, {
        actionType: "comment",
        commentBody: commentText,
      }),
    );
    setCommentText("");
    setMessage("Comment saved with roommate identity and listing provenance.");
  }

  function handleFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identity || !selectedListing) {
      setMessage("Open a listing with a valid invite before leaving feedback.");
      return;
    }

    if (!feedbackText.trim()) {
      setMessage("Add disagreement or feedback detail before saving.");
      return;
    }

    persistGroupActions(
      appendGroupAction(groupActions, identity, selectedListing, {
        actionType: "feedback",
        feedback: {
          category: feedbackCategory,
          summary: feedbackText.trim(),
          disagreement: true,
          target: feedbackCategory === "status" ? "shared-status" : "source-evidence",
          sourceEvidenceIds: selectedListing.evidencePointers.map((pointer) => pointer.id),
          doesNotMutateRanking: true,
        },
      }),
    );
    setFeedbackText("");
    setMessage("Feedback saved for briefing/history without changing ranking.");
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

    setListings((currentListings) =>
      updateSavedListingField(
        currentListings,
        identity.groupId,
        listingId,
        field,
        nextValue,
        identity.displayName,
      ),
    );
    setMessage(`Saved ${field} edit with local provenance for ${identity.displayName}.`);
  }

  function persistGroupActions(nextActions: GroupActionRecord[]) {
    setGroupActions(nextActions);

    if (!identity) {
      return;
    }

    try {
      writeGroupActions(window.localStorage, identity.groupId, nextActions);
    } catch {
      setMessage("Could not persist group review actions in this browser session.");
    }
  }

  function persistSeenRejectedMemory(nextMemory: SeenRejectedMemoryRecord[]) {
    setSeenRejectedMemory(nextMemory);

    if (!identity) {
      return;
    }

    try {
      writeSeenRejectedMemory(window.localStorage, identity.groupId, nextMemory);
    } catch {
      setMessage("Could not persist seen/rejected memory in this browser session.");
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="hero-panel">
        <div className="eyebrow">
          Apt Thing / {identity ? defaultSearchGroup.name : "valid invite required"}
        </div>
        <h1>Current availability, not spreadsheet chaos.</h1>
        <p>
          Pasted roommate finds and the latest StreetEasy batch candidates land in one mobile review
          stack: current matches first, batch review next, and user-qualified links never hidden.
        </p>
        <div className="hero-actions" aria-label="Active group identity">
          <label>
            Invite code
            <input
              autoCapitalize="none"
              autoComplete="off"
              value={identityForm.inviteCode}
              onChange={(event) => handleIdentityChange("inviteCode", event.target.value)}
            />
          </label>
          <label>
            Display name
            <input
              value={identityForm.displayName}
              onChange={(event) => handleIdentityChange("displayName", event.target.value)}
            />
          </label>
          <span>{identity ? `Active group: ${identity.groupId}` : "No active group"}</span>
        </div>
      </header>

      <section className="summary-grid" aria-label="Saved list summary">
        <SummaryCard label="Current" value={counts.currentMatches} tone="accent" />
        <SummaryCard label="Batch review" value={counts.reviewNeededBatch} />
        <SummaryCard label="Pasted visible" value={counts.userQualifiedPasted} />
        <SummaryCard label="Skipped seen" value={counts.skippedSeen + counts.skippedTriaged} />
      </section>

      <LatestBriefingPanel history={fixtureBriefingRunHistory} />

      <RunHistoryPanel history={fixtureBriefingRunHistory} />

      <BatchStatusPanel batchRun={fixtureBatchRunSummary} />

      <section className="intake-card" aria-label="Create saved listing">
        <div>
          <p className="eyebrow">Local/mock intake</p>
          <h2>Add one apartment URL</h2>
          <p id="intake-feedback" role="status" aria-live="polite">
            {message}
          </p>
        </div>
        <form onSubmit={handleCreate} className="intake-form">
          <label>
            Source listing URL
            <input
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
          <button type="submit" disabled={isPending || !identity}>
            {isPending ? "Saving…" : "Save listing"}
          </button>
        </form>
      </section>

      <MapReviewPanel
        model={mapReview}
        selectedId={selectedListing?.id}
        onSelect={setSelectedId}
        onSourceOpen={handleSourceOpen}
      />

      <div className="workspace-grid">
        <section className="list-panel" aria-label="Saved listing review queue">
          <div className="panel-heading">
            <p className="eyebrow">Card-first queue</p>
            <h2>Review stack</h2>
            <p>
              Cards are grouped for phone review. Each card exposes row fields, status, fit flags,
              extraction/batch/triage state, source opening, and inline evidence.
            </p>
          </div>
          <div className="section-stack">
            <ListingSection
              eyebrow="First"
              title="Current matches"
              description="Confirmed or strong active candidates that should be reviewed before history."
              listings={dashboard.currentMatches}
              selectedId={selectedListing?.id}
              emptyText="No current matches in this local queue yet."
              onSelect={setSelectedId}
              onSourceOpen={handleSourceOpen}
            />
            <ListingSection
              eyebrow="Second"
              title="Review-needed batch candidates"
              description="StreetEasy batch records that were not skipped but need human triage."
              listings={dashboard.reviewNeededBatch}
              selectedId={selectedListing?.id}
              emptyText="No batch candidates need review."
              onSelect={setSelectedId}
              onSourceOpen={handleSourceOpen}
            />
            <ListingSection
              eyebrow="Always visible"
              title="User-qualified pasted links"
              description="Roommate-pasted links stay reviewable even when extraction is partial or rejected."
              listings={dashboard.userQualifiedPasted}
              selectedId={selectedListing?.id}
              emptyText="No pasted links outside current matches yet."
              onSelect={setSelectedId}
              onSourceOpen={handleSourceOpen}
            />
            <ListingSection
              eyebrow="History"
              title="Rejected or lower-priority records"
              description="Kept for duplicate memory without cluttering the current batch review."
              listings={dashboard.history}
              selectedId={selectedListing?.id}
              emptyText="No history records yet."
              onSelect={setSelectedId}
              onSourceOpen={handleSourceOpen}
            />
          </div>
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
          feedbackText={feedbackText}
          feedbackCategory={feedbackCategory}
          onCommentTextChange={setCommentText}
          onFeedbackTextChange={setFeedbackText}
          onFeedbackCategoryChange={setFeedbackCategory}
          onFieldChange={handleFieldChange}
          onStatusChange={handleStatusChange}
          onSourceOpen={handleSourceOpen}
          onReaction={handleReaction}
          onComment={handleComment}
          onFeedback={handleFeedback}
        />
      </div>
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
          <h2>Every agent pass, compact enough for the group chat.</h2>
          <p>
            Supported cadences: {model.supportedCadences.join(", ")}. Manual and daily records are
            visible now, with hourly cadence preserved for the later scheduler path.
          </p>
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
                  <p>No source failures recorded for this run.</p>
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
                  <p>No provider metadata recorded.</p>
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
                  <p>No raw artifacts recorded for this run yet.</p>
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
          <h2>Today&apos;s agent readout, before the cards.</h2>
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
            eyebrow="Best new/current matches"
            candidates={model.bestMatches}
            emptyText="No current match surfaced in the latest briefing."
          />
          <BriefingCandidateGroup
            eyebrow="Review-needed candidates"
            candidates={model.reviewNeeded}
            emptyText="No review-needed candidate surfaced in the latest briefing."
          />
        </div>

        <section className="briefing-section" aria-label="Changed listings">
          <h3>Changed listings</h3>
          <BulletList items={model.changedListings} emptyText="No listing changes recorded." />
        </section>

        <section className="briefing-section memory-counts" aria-label="Skipped / seen memory">
          <h3>Skipped / seen memory</h3>
          <div className="briefing-count-grid">
            <Fact label="Seen skips" value={String(model.skippedSeenCount)} />
            <Fact label="Triaged skips" value={String(model.skippedTriagedCount)} />
            <Fact label="Memory rows" value={String(model.memoryRecordCount)} />
          </div>
          <p>
            Saved records remain in review/history sections; seen, rejected, and already-triaged
            listings stay explainable in memory without re-entering current matches.
          </p>
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
          <BulletList
            items={model.recommendationRationale}
            emptyText="No recommendation rationale recorded."
          />
        </section>

        <section className="briefing-section" aria-label="Concerns">
          <h3>Concerns</h3>
          <BulletList items={model.concerns} emptyText="No open concerns recorded." />
        </section>

        <section className="briefing-section next-actions" aria-label="Next actions">
          <h3>Next actions</h3>
          <BulletList items={model.nextActions} emptyText="No next actions recorded." />
        </section>

        <FeedbackSummarySection items={model.feedbackSummaries} />
      </div>
    </section>
  );
}

function MemoryRecordList({ records }: { records: LatestBriefingMemoryRecord[] }) {
  if (records.length === 0) {
    return <p className="empty-state">No seen/rejected memory records captured for this run.</p>;
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

function FeedbackSummarySection({ items }: { items: BriefingFeedbackSummaryItem[] }) {
  return (
    <section
      className="briefing-section feedback-summary-panel"
      aria-label="Feedback / disagreement summary"
    >
      <h3>Feedback / disagreement summary</h3>
      <p className="ranking-note">Briefing-only: does not change ranking or search behavior.</p>
      {items.length === 0 ? (
        <p>No comments, reactions, status disagreements, or feedback summaries recorded.</p>
      ) : (
        <div className="feedback-summary-list">
          {items.map((item) => (
            <article key={item.listingId} className="feedback-summary-item">
              <div className="feedback-attribution">
                <strong>Listing: {item.listingTitle}</strong>
                <span>Group: {item.groupId}</span>
                <span>Source: {formatLabel(item.source)}</span>
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                  Source record
                </a>
              </div>
              <div className="feedback-counts" aria-label={`Feedback counts for ${item.listingId}`}>
                <span>{item.commentCount} comments</span>
                <span>{item.reactionCount} reactions</span>
                <span>{item.statusChangeCount} statuses</span>
                <span>{item.disagreementCount} disagreements</span>
              </div>
              <BulletList items={item.summaries} emptyText="No written feedback summaries." />
              <small>
                Listing ID {item.listingId} · ranking/search mutation{" "}
                {item.doesNotMutateRanking ? "off" : "unknown"}
              </small>
            </article>
          ))}
        </div>
      )}
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
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
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

  return (
    <section className="map-review-card" aria-label="Map enhanced review">
      <div className="panel-heading map-heading">
        <div>
          <p className="eyebrow">Map-enhanced review</p>
          <h2>Browse the saved queue by location.</h2>
          <p>
            Fixture-backed OpenFreeMap context is layered on top of the saved-list dashboard: pins,
            zones, subway, amenities, confidence, concerns, and source links stay synchronized with
            the review stack.
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
        <div id="map-map" className="map-shell" aria-label="Fixture candidate map shell">
          <div className="zone-overlay preferred">Preferred Manhattan zone</div>
          <div className="zone-overlay fallback">Brooklyn/Queens fallback context</div>
          {model.locatedCandidates.map((candidate, index) => (
            <button
              type="button"
              key={candidate.listing.id}
              className={`map-pin ${candidate.pinState}${candidate.listing.id === selectedId ? " selected" : ""}`}
              style={pinPosition(index, model.locatedCandidates.length)}
              onClick={() => onSelect(candidate.listing.id)}
              aria-pressed={candidate.listing.id === selectedId}
              aria-label={`Select ${candidate.listing.title} on map`}
            >
              <span>{index + 1}</span>
            </button>
          ))}
          <div className="map-attribution">{model.attribution}</div>
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
      <span>{candidate.pinState.replaceAll("-", " ")}</span>
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
        <section>
          <h4>Open amenity context</h4>
          {candidate.contextAmenities.length > 0 ? (
            <ul>
              {candidate.contextAmenities.slice(0, 2).map((amenity) => (
                <li key={`${amenity.name}-${amenity.kind}`}>
                  {amenity.name} · {amenity.kind} · {amenity.distanceMeters}m
                </li>
              ))}
            </ul>
          ) : (
            <p>Amenity context pending for this fixture.</p>
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

function pinPosition(index: number, total: number): { left: string; top: string } {
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const row = Math.floor(index / columns);
  const column = index % columns;

  return {
    left: `${18 + column * (68 / columns)}%`,
    top: `${22 + row * 22}%`,
  };
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "accent" }) {
  return (
    <article className={tone === "accent" ? "summary-card accent" : "summary-card"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function BatchStatusPanel({ batchRun }: { batchRun: ReviewBatchRunSummary }) {
  return (
    <section className="batch-status-card" aria-label="StreetEasy batch status">
      <div>
        <p className="eyebrow">StreetEasy manual batch</p>
        <h2>
          {formatLabel(batchRun.status)} run · {batchRun.cadence}
        </h2>
        <p>
          Found {batchRun.counts.candidatesFound} candidates, saved{" "}
          {batchRun.counts.candidatesSaved}, skipped {batchRun.counts.candidatesSkippedSeen} seen
          and {batchRun.counts.candidatesSkippedTriaged} already triaged.
        </p>
      </div>
      <div className="batch-metrics" aria-label="Batch metrics">
        <Fact label="Analyzed" value={String(batchRun.counts.candidatesAnalyzed)} />
        <Fact label="Image cap" value={String(batchRun.maxImagesPerListing)} />
        <Fact label="Rejected" value={String(batchRun.counts.candidatesRejected)} />
      </div>
    </section>
  );
}

function ListingSection({
  title,
  eyebrow,
  description,
  listings,
  selectedId,
  emptyText,
  onSelect,
  onSourceOpen,
}: ListingSectionProps) {
  return (
    <section className="listing-section" aria-label={title}>
      <header className="section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span>{listings.length}</span>
      </header>
      {listings.length === 0 ? (
        <p className="empty-state">{emptyText}</p>
      ) : (
        <div className="listing-cards">
          {listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              selected={listing.id === selectedId}
              onSelect={onSelect}
              onSourceOpen={onSourceOpen}
            />
          ))}
        </div>
      )}
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
  const evidenceSummary = getEvidenceSummary(listing);
  const concernSummary = getConcernSummary(listing);
  const intakeKind = getProviderIntakeKind(listing);

  return (
    <article className={selected ? "listing-card selected" : "listing-card"}>
      <div className="card-topline">
        <span className="card-status">{listing.reviewStatus}</span>
        <span>{listing.userQualified ? "pasted" : "batch"}</span>
      </div>
      <h4>{listing.title}</h4>
      <div className="listing-rowgrid" aria-label="Minimum listing row fields">
        <span>{listing.neighborhood ?? "Neighborhood TBD"}</span>
        <strong>{formatMoney(listing.rent)}</strong>
        <span>{listing.bedrooms ?? "?"}BR</span>
        <a
          href={listing.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open source for ${listing.title}`}
          onClick={() => onSourceOpen(listing)}
        >
          Source
        </a>
      </div>
      <div className="state-grid" aria-label="Extraction and triage status">
        <span>{listing.source}</span>
        <span>{formatLabel(listing.extractionStatus)}</span>
        <span>{formatLabel(intakeKind)}</span>
        <span>{formatLabel(listing.triageStatus)}</span>
        <span>{formatLabel(listing.triageBucket)}</span>
      </div>
      <div className="pills compact" aria-label="Light fit flags">
        {listing.fitFlags.slice(0, 4).map((flag) => (
          <span key={flag}>{formatLabel(flag)}</span>
        ))}
        {listing.fitFlags.length === 0 ? <span>No flags yet</span> : null}
      </div>
      <p className="card-summary">{evidenceSummary}</p>
      <p className="card-concern">{concernSummary}</p>
      <div className="card-actions">
        <button type="button" onClick={() => onSelect(listing.id)} aria-pressed={selected}>
          {selected ? "Opened in panel" : "Open details"}
        </button>
        <details>
          <summary>Evidence</summary>
          <p>{evidenceSummary}</p>
          <p>{concernSummary}</p>
          <small>{listing.url}</small>
        </details>
      </div>
    </article>
  );
}

function ListingEditor({
  identity,
  listing,
  actions,
  commentText,
  feedbackText,
  feedbackCategory,
  onCommentTextChange,
  onFeedbackTextChange,
  onFeedbackCategoryChange,
  onFieldChange,
  onStatusChange,
  onSourceOpen,
  onReaction,
  onComment,
  onFeedback,
}: {
  identity?: InviteIdentity;
  listing?: ListingCandidate;
  actions?: ListingGroupActions;
  commentText: string;
  feedbackText: string;
  feedbackCategory: FeedbackCategory;
  onCommentTextChange: (value: string) => void;
  onFeedbackTextChange: (value: string) => void;
  onFeedbackCategoryChange: (value: FeedbackCategory) => void;
  onFieldChange: (listingId: string, field: FieldProvenance["field"], rawValue: string) => void;
  onStatusChange: (listingId: string, status: ReviewStatus) => void;
  onSourceOpen: (listing: ListingCandidate) => void;
  onReaction: (listing: ListingCandidate, reaction: GroupActionRecord["reaction"]) => void;
  onComment: (event: FormEvent<HTMLFormElement>) => void;
  onFeedback: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!listing) {
    return (
      <section className="editor-panel" aria-label="Listing detail panel">
        <p>No listing selected yet.</p>
      </section>
    );
  }

  const intakeKind = getProviderIntakeKind(listing);

  return (
    <article className="editor-panel" aria-label="Listing detail panel">
      <header className="editor-header">
        <div>
          <p className="eyebrow">Opened saved record</p>
          <h2>{listing.title}</h2>
          <span>
            {listing.address}
            {listing.neighborhood ? `, ${listing.neighborhood}` : ""}
          </span>
        </div>
        <a
          href={listing.url}
          target="_blank"
          rel="noreferrer"
          onClick={() => onSourceOpen(listing)}
        >
          Open source
        </a>
      </header>

      <section className="fact-strip" aria-label="Listing facts">
        <Fact label="Rent" value={formatMoney(listing.rent)} />
        <Fact label="Beds" value={String(listing.bedrooms ?? "?")} />
        <Fact label="Baths" value={String(listing.bathrooms ?? "?")} />
        <Fact label="Available" value={listing.availableAt ?? "TBD"} />
      </section>

      <section className="state-grid panel-state" aria-label="Extraction, batch, and triage state">
        <span>{listing.source}</span>
        <span>{formatLabel(listing.extractionStatus)}</span>
        <span>{formatLabel(intakeKind)}</span>
        <span>{formatLabel(listing.triageStatus)}</span>
        <span>{formatLabel(listing.triageBucket)}</span>
      </section>

      <section className="status-buttons" aria-label="Review status">
        {REVIEW_STATUSES.map((status) => (
          <button
            type="button"
            key={status}
            className={listing.reviewStatus === status ? "active" : ""}
            aria-pressed={listing.reviewStatus === status}
            aria-label={`Set review status to ${status}`}
            onClick={() => onStatusChange(listing.id, status)}
          >
            {status}
          </button>
        ))}
      </section>

      <section className="group-actions-panel" aria-label="Group comments, reactions, and feedback">
        <div className="reaction-row" aria-label="Roommate reactions">
          {(["thumbs-up", "thumbs-down", "tour", "question"] as const).map((reaction) => (
            <button
              type="button"
              key={reaction}
              aria-label={`React ${formatLabel(reaction)} to ${listing.title}`}
              onClick={() => onReaction(listing, reaction)}
            >
              {formatLabel(reaction)}
            </button>
          ))}
        </div>
        <form className="group-action-form" onSubmit={onComment}>
          <label>
            Comment
            <textarea
              enterKeyHint="done"
              aria-label={`Comment on ${listing.title}`}
              value={commentText}
              onChange={(event) => onCommentTextChange(event.target.value)}
              placeholder="Add a roommate-visible note"
            />
          </label>
          <button type="submit" disabled={!identity}>
            Save comment
          </button>
        </form>
        <form className="group-action-form" onSubmit={onFeedback}>
          <label>
            Feedback type
            <select
              aria-label={`Feedback type for ${listing.title}`}
              value={feedbackCategory}
              onChange={(event) => onFeedbackCategoryChange(event.target.value as FeedbackCategory)}
            >
              {(["fit", "status", "evidence", "location", "price", "other"] as const).map(
                (category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Disagreement / feedback
            <textarea
              enterKeyHint="done"
              aria-label={`Disagreement or feedback for ${listing.title}`}
              value={feedbackText}
              onChange={(event) => onFeedbackTextChange(event.target.value)}
              placeholder="Flag disagreement for briefing, not ranking changes"
            />
          </label>
          <button type="submit" disabled={!identity}>
            Save feedback
          </button>
        </form>
        <GroupActionSummary actions={actions} />
      </section>

      <section className="edit-grid" aria-label="Editable saved-list fields">
        {editableFields.map((field) => (
          <label key={field}>
            {field}
            <input
              type={numericFields.has(field) ? "number" : "text"}
              inputMode={numericFields.has(field) ? "decimal" : "text"}
              enterKeyHint="done"
              value={String(listing[field] ?? "")}
              onChange={(event) => onFieldChange(listing.id, field, event.target.value)}
            />
          </label>
        ))}
      </section>

      <section className="trust-grid" aria-label="Fit flags, evidence, concerns, and provenance">
        <div>
          <h3>Light fit flags</h3>
          <div className="pills">
            {listing.fitFlags.length > 0 ? (
              listing.fitFlags.map((flag) => <span key={flag}>{formatLabel(flag)}</span>)
            ) : (
              <span>No flags yet</span>
            )}
          </div>
        </div>
        <div>
          <h3>Evidence / concerns</h3>
          <p>{getEvidenceSummary(listing)}</p>
          <p>{getConcernSummary(listing)}</p>
        </div>
        <div>
          <h3>Last local edit</h3>
          <p>
            {listing.fieldProvenance.at(-1)?.actorDisplayName ??
              identity?.displayName ??
              "No active reviewer"}{" "}
            · {listing.fieldProvenance.at(-1)?.field ?? "fixture seed"}
          </p>
        </div>
      </section>
    </article>
  );
}

function GroupActionSummary({ actions }: { actions?: ListingGroupActions }) {
  if (!actions) {
    return (
      <p className="empty-state">Group actions load after a valid invite opens this record.</p>
    );
  }

  const latestActions = [
    ...actions.comments,
    ...actions.reactions,
    ...actions.statusChanges,
    ...actions.sourceLinkOpens,
    ...actions.feedback,
  ].slice(0, 6);

  return (
    <div className="group-action-summary" aria-label="Saved group action summary">
      <div className="action-counts">
        <span>{actions.comments.length} comments</span>
        <span>{actions.reactions.length} reactions</span>
        <span>{actions.statusChanges.length} statuses</span>
        <span>{actions.feedback.length} feedback</span>
      </div>
      {latestActions.length === 0 ? (
        <p className="empty-state">No group actions yet for this listing.</p>
      ) : (
        <ul>
          {latestActions.map((action) => (
            <li key={action.id}>
              <strong>{action.actorDisplayName}</strong> · {formatGroupAction(action)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatGroupAction(action: GroupActionRecord): string {
  if (action.commentBody) return action.commentBody;
  if (action.reaction) return `reacted ${formatLabel(action.reaction)}`;
  if (action.status) return `set status to ${action.status}`;
  if (action.feedback?.summary) return `${action.feedback.category}: ${action.feedback.summary}`;
  if (action.actionType === "source-link-open") return "opened the original source";

  return formatLabel(action.actionType);
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
    return "No concerns recorded.";
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

function formatLabel(value: string) {
  return value.replaceAll(/[-_]/g, " ");
}
