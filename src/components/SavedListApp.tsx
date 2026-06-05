"use client";

import { useEffect, useState, useTransition } from "react";
import { fixtureListings } from "@/lib/fixtures";
import {
  createDuplicateKey,
  createListingFromUrl,
  type FieldProvenance,
  type InviteIdentity,
  type ListingCandidate,
  type ReviewStatus,
  updateListingField,
  updateReviewStatus,
} from "@/lib/listings";

const listingsStorageKey = "apt-thing:listings";
const identityStorageKey = "apt-thing:identity";

const reviewStatuses: ReviewStatus[] = ["new", "interested", "touring", "rejected"];
const editableFields: FieldProvenance["field"][] = [
  "title",
  "address",
  "neighborhood",
  "rent",
  "bedrooms",
  "bathrooms",
  "availableAt",
];

export function SavedListApp() {
  const [identity, setIdentity] = useState<InviteIdentity>({
    inviteCode: "apt-g1",
    displayName: "Roommate",
  });
  const [listings, setListings] = useState<ListingCandidate[]>(fixtureListings);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState(
    "Paste a listing URL to create an editable saved-list record.",
  );
  const [selectedId, setSelectedId] = useState<string>(fixtureListings[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const savedIdentity = window.localStorage.getItem(identityStorageKey);
    const savedListings = window.localStorage.getItem(listingsStorageKey);

    if (savedIdentity) {
      setIdentity(JSON.parse(savedIdentity) as InviteIdentity);
    }

    if (savedListings) {
      const parsedListings = JSON.parse(savedListings) as ListingCandidate[];
      setListings(parsedListings);
      setSelectedId(parsedListings[0]?.id ?? "");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(identityStorageKey, JSON.stringify(identity));
  }, [identity]);

  useEffect(() => {
    window.localStorage.setItem(listingsStorageKey, JSON.stringify(listings));
  }, [listings]);

  const selectedListing = listings.find((listing) => listing.id === selectedId) ?? listings[0];
  const savedCount = listings.length;
  const touringCount = listings.filter((listing) => listing.reviewStatus === "touring").length;
  const manualNeededCount = listings.filter(
    (listing) => listing.extractionStatus === "manual-needed",
  ).length;
  const priceFitCount = listings.filter((listing) => listing.fitFlags.includes("price_fit")).length;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(() => {
      try {
        const duplicateKey = createDuplicateKey(url);
        const duplicate = listings.find(
          (listing) => createDuplicateKey(listing.url) === duplicateKey,
        );

        if (duplicate) {
          setSelectedId(duplicate.id);
          setMessage("Duplicate listing found. Opening the existing saved record instead.");
          return;
        }

        const listing = createListingFromUrl(url, identity);
        setListings((currentListings) => [listing, ...currentListings]);
        setSelectedId(listing.id);
        setUrl("");
        setMessage(
          "Saved a manual-needed listing stub. Add missing fields when extraction is incomplete.",
        );
      } catch {
        setMessage("Enter a valid apartment listing URL, including https://.");
      }
    });
  }

  function updateIdentity(field: keyof InviteIdentity, value: string) {
    setIdentity((currentIdentity) => ({ ...currentIdentity, [field]: value }));
  }

  function updateStatus(listing: ListingCandidate, status: ReviewStatus) {
    setListings((currentListings) =>
      currentListings.map((currentListing) =>
        currentListing.id === listing.id
          ? updateReviewStatus(currentListing, status)
          : currentListing,
      ),
    );
  }

  function updateField(listing: ListingCandidate, field: FieldProvenance["field"], value: string) {
    const numericFields = new Set<FieldProvenance["field"]>(["rent", "bedrooms", "bathrooms"]);
    const parsedValue = numericFields.has(field) ? Number(value) : value;

    if (numericFields.has(field) && Number.isNaN(parsedValue)) {
      setMessage(`${field} must be a number.`);
      return;
    }

    setListings((currentListings) =>
      currentListings.map((currentListing) =>
        currentListing.id === listing.id
          ? updateListingField(currentListing, field, parsedValue, identity.displayName)
          : currentListing,
      ),
    );
    setMessage(`Updated ${field} with provenance for ${identity.displayName}.`);
  }

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Private G1 dashboard</p>
          <h1 id="page-title">AI apartment saved list</h1>
          <p className="lede">
            Paste StreetEasy, Zillow, or any apartment URL. The scaffold creates a normalized
            saved-list record, dedupes URLs, and keeps manual edits auditable while live extraction
            is built next.
          </p>
        </div>
        <div className="identity-card" aria-label="Invite identity">
          <label>
            Invite code
            <input
              value={identity.inviteCode}
              onChange={(event) => updateIdentity("inviteCode", event.target.value)}
            />
          </label>
          <label>
            Display name
            <input
              value={identity.displayName}
              onChange={(event) => updateIdentity("displayName", event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="intake-panel" aria-label="Paste listing intake">
        <form onSubmit={handleSubmit} className="intake-form">
          <label>
            Listing URL
            <input
              type="url"
              placeholder="https://streeteasy.com/..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={isPending}>
            {isPending ? "Saving..." : "Save listing"}
          </button>
        </form>
        <p className="message">{message}</p>
      </section>

      <section className="metrics" aria-label="Saved-list summary">
        <Metric label="Saved" value={savedCount} />
        <Metric label="Touring" value={touringCount} />
        <Metric label="Manual-needed" value={manualNeededCount} />
        <Metric label="Price fit" value={priceFitCount} />
      </section>

      <section className="workspace">
        <div className="list-panel" aria-label="Saved listings">
          {listings.map((listing) => (
            <button
              type="button"
              key={listing.id}
              className={`listing-row ${listing.id === selectedListing?.id ? "selected" : ""}`}
              onClick={() => setSelectedId(listing.id)}
            >
              <span className="row-source">{listing.source}</span>
              <strong>{listing.title}</strong>
              <span>
                {formatMoney(listing.rent)} · {listing.bedrooms ?? "?"} beds ·{" "}
                {listing.bathrooms ?? "?"} baths
              </span>
              <span className={`status ${listing.reviewStatus}`}>{listing.reviewStatus}</span>
            </button>
          ))}
        </div>

        {selectedListing ? (
          <article className="detail-panel" aria-label="Listing detail">
            <div className="detail-heading">
              <div>
                <p className="eyebrow">
                  {selectedListing.source} · {selectedListing.extractionStatus}
                </p>
                <h2>{selectedListing.title}</h2>
                <p>
                  {selectedListing.address}
                  {selectedListing.neighborhood ? ` · ${selectedListing.neighborhood}` : ""}
                </p>
              </div>
              <a href={selectedListing.url} target="_blank" rel="noreferrer">
                Open source
              </a>
            </div>

            <div className="status-buttons" aria-label="Review status">
              {reviewStatuses.map((status) => (
                <button
                  type="button"
                  key={status}
                  className={selectedListing.reviewStatus === status ? "active" : ""}
                  onClick={() => updateStatus(selectedListing, status)}
                >
                  {status}
                </button>
              ))}
            </div>

            <div className="flags" aria-label="Fit flags">
              {selectedListing.fitFlags.map((flag) => (
                <span key={flag}>{flag.replaceAll("_", " ")}</span>
              ))}
            </div>

            <div className="edit-grid" aria-label="Editable fields">
              {editableFields.map((field) => (
                <label key={field}>
                  {field}
                  <input
                    value={String(selectedListing[field] ?? "")}
                    onChange={(event) => updateField(selectedListing, field, event.target.value)}
                  />
                </label>
              ))}
            </div>

            <div className="evidence-grid">
              <section>
                <h3>Evidence</h3>
                {selectedListing.evidence.map((evidence) => (
                  <p key={`${evidence.claim}-${evidence.quote}`}>
                    <strong>{evidence.claim}:</strong> {evidence.quote}
                  </p>
                ))}
              </section>
              <section>
                <h3>Concerns</h3>
                {selectedListing.concerns.length > 0 ? (
                  selectedListing.concerns.map((concern) => <p key={concern}>{concern}</p>)
                ) : (
                  <p>No concerns yet.</p>
                )}
              </section>
            </div>

            <section className="provenance">
              <h3>Latest provenance</h3>
              {selectedListing.fieldProvenance.slice(-5).map((entry) => (
                <p
                  key={`${entry.field}-${entry.updatedAt}-${entry.editedValue ?? entry.originalValue}`}
                >
                  {entry.field}: {entry.source} {entry.actor ? `by ${entry.actor}` : ""}
                </p>
              ))}
            </section>
          </article>
        ) : null}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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
