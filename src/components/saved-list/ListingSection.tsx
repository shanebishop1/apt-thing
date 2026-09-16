"use client";

import type { ListingCandidate } from "@/lib/listings";
import { formatAverageRent, formatLabel } from "./listing-presentation";

export type ListingListGroup = {
  id: string;
  label: string;
  listings: ListingCandidate[];
};

type ListingSectionProps = {
  groups?: ListingListGroup[];
  selectedId?: string;
  onSelect: (listingId: string) => void;
  onSourceOpen: (listing: ListingCandidate) => void;
};

export function ListingSection({
  groups = [],
  selectedId,
  onSelect,
  onSourceOpen,
}: ListingSectionProps) {
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
