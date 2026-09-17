"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import {
  EDITABLE_LISTING_FIELDS,
  NUMERIC_LISTING_FIELDS,
  type FieldProvenance,
  type ListingCandidate,
} from "@/lib/listings";

const numericFields = new Set<FieldProvenance["field"]>(NUMERIC_LISTING_FIELDS);

export type ListingFieldDialogProps = {
  listing: ListingCandidate;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onFieldChange: (listingId: string, field: FieldProvenance["field"], rawValue: string) => void;
};

export function ListingFieldDialog({
  listing,
  isOpen,
  onOpenChange,
  onFieldChange,
}: ListingFieldDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const firstEditInputRef = useRef<HTMLInputElement | null>(null);
  const editFieldsDialogId = `${listing.id}-edit-fields-dialog`;
  const editFieldsTitleId = `${listing.id}-edit-fields-title`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) {
      return;
    }

    // jsdom has no modal dialog implementation; the markup still renders there.
    if (!dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    }

    firstEditInputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) {
      return;
    }

    // A click that lands on the dialog element itself landed on the backdrop; a click
    // anywhere in the panel targets one of its children instead.
    function handleBackdropClick(event: MouseEvent) {
      if (event.target === dialog) {
        onOpenChange(false);
      }
    }

    dialog.addEventListener("click", handleBackdropClick);
    return () => dialog.removeEventListener("click", handleBackdropClick);
  }, [isOpen, onOpenChange]);

  if (!isOpen) {
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      id={editFieldsDialogId}
      className="field-edit-modal"
      aria-labelledby={editFieldsTitleId}
      onCancel={() => onOpenChange(false)}
      onClose={() => onOpenChange(false)}
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
          onClick={() => onOpenChange(false)}
        >
          <X className="summary-icon" aria-hidden="true" />
        </button>
      </header>
      <section className="edit-grid" aria-label="Editable saved-list fields">
        {EDITABLE_LISTING_FIELDS.map((field) => (
          <label key={field}>
            {field}
            <input
              ref={field === EDITABLE_LISTING_FIELDS[0] ? firstEditInputRef : undefined}
              type={numericFields.has(field) ? "number" : "text"}
              inputMode={numericFields.has(field) ? "decimal" : "text"}
              enterKeyHint="done"
              value={String(listing[field] ?? "")}
              onChange={(event) => onFieldChange(listing.id, field, event.target.value)}
            />
          </label>
        ))}
      </section>
    </dialog>
  );
}
