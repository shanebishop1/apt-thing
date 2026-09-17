"use client";

import { useRef, type FormEvent, type ToggleEvent } from "react";
import { Plus } from "lucide-react";
import type { InviteIdentity } from "@/lib/listings";

type ListingIntakeProps = {
  identity?: InviteIdentity | undefined;
  url: string;
  message: string;
  apiBusy: boolean;
  onUrlChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function ListingIntake({
  identity,
  url,
  message,
  apiBusy,
  onUrlChange,
  onSubmit,
}: ListingIntakeProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleToggle(event: ToggleEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open) {
      inputRef.current?.focus();
    }
  }

  return (
    <details className="add-listing-control" onToggle={handleToggle}>
      <summary aria-label="Add listing">
        <Plus className="summary-icon" aria-hidden="true" />
      </summary>
      <form onSubmit={onSubmit} className="intake-form compact">
        <label>
          <span className="sr-only">Source URL</span>
          <input
            ref={inputRef}
            type="url"
            inputMode="url"
            enterKeyHint="go"
            autoCapitalize="none"
            autoComplete="url"
            aria-describedby="intake-feedback"
            placeholder="https://streeteasy.com/building/..."
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={apiBusy || !identity}>
          {apiBusy ? "Saving…" : "Add"}
        </button>
        <p id="intake-feedback" role="status" aria-live="polite">
          {message || " "}
        </p>
      </form>
    </details>
  );
}
