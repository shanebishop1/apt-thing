"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown } from "lucide-react";
import type { ListingCandidate, ReviewStatus } from "../../lib/listings";
import { REVIEW_STATUSES } from "../../lib/listings";
import { formatLabel } from "./listing-presentation";

const selectableReviewStatuses: Exclude<ReviewStatus, "review">[] = REVIEW_STATUSES.filter(
  (status): status is Exclude<ReviewStatus, "review"> => status !== "review",
);

export type ReviewStatusDropdownProps = {
  listing: ListingCandidate;
  disabled?: boolean;
  onStatusChange: (listingId: string, status: ReviewStatus) => void;
};

export function ReviewStatusDropdown({
  listing,
  disabled = false,
  onStatusChange,
}: ReviewStatusDropdownProps) {
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

    const currentIndex = selectableReviewStatuses.findIndex((status) => status === activeStatus);
    const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex =
      (safeCurrentIndex + direction + selectableReviewStatuses.length) %
      selectableReviewStatuses.length;
    setActiveStatus(selectableReviewStatuses[nextIndex]!);
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
        {selectableReviewStatuses.map((status) => {
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
