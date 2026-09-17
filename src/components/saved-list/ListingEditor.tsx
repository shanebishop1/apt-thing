"use client";

import { useState, type FormEvent } from "react";
import { Pencil, X } from "lucide-react";
import type { GroupActionRecord } from "@/lib/agent-contracts";
import type { InviteIdentity, ListingCandidate, ReviewStatus } from "@/lib/listings";
import type { FieldProvenance } from "@/lib/listings";
import type { ListingGroupActions as ListingGroupActionsState } from "@/lib/group-actions";
import { Fact, formatLabel, formatListingAddedAge, formatMoney } from "./listing-presentation";
import { ListingFieldDialog } from "./ListingFieldDialog";
import { ListingGroupActions, ReactionScoreBadge } from "./ListingGroupActions";
import { ListingMedia } from "./ListingMedia";
import { ReviewStatusDropdown } from "./ReviewStatusDropdown";

export type ListingEditorProps = {
  identity?: InviteIdentity | undefined;
  listing?: ListingCandidate | undefined;
  actions?: ListingGroupActionsState | undefined;
  commentText: string;
  onCommentTextChange: (value: string) => void;
  onFieldChange: (listingId: string, field: FieldProvenance["field"], rawValue: string) => void;
  onStatusChange: (listingId: string, status: ReviewStatus) => void;
  onReviewDecision: (listingId: string, decision: "approve" | "reject") => void;
  onSourceOpen: (listing: ListingCandidate) => void;
  onReaction: (listing: ListingCandidate, reaction: GroupActionRecord["reaction"]) => void;
  onComment: (event: FormEvent<HTMLFormElement>) => void;
  onClose?: () => void;
};

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
}: ListingEditorProps) {
  const [isEditingFields, setIsEditingFields] = useState(false);
  const [isAboutExpanded, setIsAboutExpanded] = useState(false);
  const selectedListingId = listing?.id;
  const [shownListingId, setShownListingId] = useState(selectedListingId);

  // Another listing means a fresh panel: no half-finished field edit, no expanded blurb.
  // Adjusting during render keeps the reset in the same commit as the new listing.
  if (selectedListingId !== shownListingId) {
    setShownListingId(selectedListingId);
    setIsEditingFields(false);
    setIsAboutExpanded(false);
  }

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
  const isRejectedListing =
    listing.triageBucket === "rejected" || listing.reviewStatus === "rejected";
  const isReviewNeeded =
    !isRejectedListing &&
    (listing.triageBucket === "review-needed" || listing.reviewStatus === "review");
  const lockStatusUntilReviewDecision = isReviewNeeded;
  const aboutPreview = getListingAboutPreview(listing.description);
  const aboutText = isAboutExpanded ? listing.description : aboutPreview;
  const canExpandAbout = Boolean(listing.description && aboutPreview !== listing.description);

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

      <ListingMedia identity={identity} listing={listing} />

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

      <ListingGroupActions
        identity={identity}
        listing={listing}
        actions={actions}
        commentText={commentText}
        onCommentTextChange={onCommentTextChange}
        onReaction={onReaction}
        onComment={onComment}
      />

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
              · {lastFieldProvenance?.field ?? "no edits yet"}
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

      <ListingFieldDialog
        listing={listing}
        isOpen={isEditingFields}
        onOpenChange={setIsEditingFields}
        onFieldChange={onFieldChange}
      />
    </article>
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
