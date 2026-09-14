"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { FieldProvenance, ListingCandidate } from "../../lib/listings";

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
  const firstEditInputRef = useRef<HTMLInputElement | null>(null);
  const editFieldsDialogId = `${listing.id}-edit-fields-dialog`;
  const editFieldsTitleId = `${listing.id}-edit-fields-title`;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    firstEditInputRef.current?.focus();

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onOpenChange]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="field-modal-backdrop" onClick={() => onOpenChange(false)}>
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
            onClick={() => onOpenChange(false)}
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
  );
}
