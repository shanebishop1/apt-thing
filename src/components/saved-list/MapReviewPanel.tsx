"use client";

import type { FormEvent } from "react";
import type { GroupActionRecord } from "@/lib/agent-contracts";
import { createMapReviewModel, type MapReviewCandidate, walkingMinutes } from "@/lib/map-review";
import type { ListingGroupActions } from "@/lib/group-actions";
import type {
  FieldProvenance,
  InviteIdentity,
  ListingCandidate,
  ReviewStatus,
} from "@/lib/listings";
import { Fact, formatLabel, formatListingAddedAge, formatMoney } from "./listing-presentation";
import { ListingEditor } from "./ListingEditor";
import { LeafletListingMap } from "./map/LeafletListingMap";

export function MapReviewPanel({
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
  identity?: InviteIdentity | undefined;
  model: ReturnType<typeof createMapReviewModel>;
  selectedId?: string | undefined;
  actions?: ListingGroupActions | undefined;
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
      <span>{formatLabel(candidate.pinState)}</span>
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
  candidate?: MapReviewCandidate | undefined;
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
                  {subway.station} ({subway.routes.join("/")}) · {subway.distanceMeters}m · ~
                  {walkingMinutes(subway.distanceMeters)} min walk
                </li>
              ))}
            </ul>
          ) : (
            <p>No coordinates for this listing yet.</p>
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
