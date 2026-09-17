"use client";

import type { ChangeEvent } from "react";
import { ChevronDown } from "lucide-react";
import type { ListingCandidate, ReviewStatus } from "@/lib/listings";
import { REVIEW_STATUSES } from "@/lib/listings";
import { formatLabel } from "./listing-presentation";

const selectableReviewStatuses: Exclude<ReviewStatus, "review">[] = REVIEW_STATUSES.filter(
  (status): status is Exclude<ReviewStatus, "review"> => status !== "review",
);

export type ReviewStatusDropdownProps = {
  listing: ListingCandidate;
  disabled?: boolean;
  onStatusChange: (listingId: string, status: ReviewStatus) => void;
};

/**
 * A native `<select>` wearing the saved-list status pill. The pill draws the coloured dot,
 * the current label and the chevron; the select is laid transparently over it so the browser
 * supplies the popup, keyboard handling and screen-reader semantics.
 */
export function ReviewStatusDropdown({
  listing,
  disabled = false,
  onStatusChange,
}: ReviewStatusDropdownProps) {
  const isPendingReview = listing.reviewStatus === "review";

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextStatus = event.target.value as ReviewStatus;
    if (disabled || nextStatus === "review" || nextStatus === listing.reviewStatus) {
      return;
    }

    onStatusChange(listing.id, nextStatus);
  }

  return (
    <span className="status-control detail-status-control">
      <span className={`status-dropdown-trigger status-${listing.reviewStatus}`}>
        <span className="status-option-dot" aria-hidden="true" />
        <span className="status-dropdown-value">{formatLabel(listing.reviewStatus)}</span>
        <ChevronDown className="status-dropdown-chevron" aria-hidden="true" />
        <select
          className="status-dropdown-select"
          aria-label={`Change review status for ${listing.title}`}
          disabled={disabled}
          value={listing.reviewStatus}
          onChange={handleChange}
        >
          {/* `review` is a machine-set holding state: shown when current, never selectable. */}
          {isPendingReview ? (
            <option value="review" disabled>
              {formatLabel("review")}
            </option>
          ) : null}
          {selectableReviewStatuses.map((status) => (
            <option key={status} value={status}>
              {formatLabel(status)}
            </option>
          ))}
        </select>
      </span>
    </span>
  );
}
