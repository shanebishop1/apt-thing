"use client";

import { useEffect, useState, useTransition } from "react";
import { fixtureListings } from "@/lib/fixtures";
import {
  createGroupScopedDuplicateKey,
  createListingFromUrl,
  defaultSearchGroup,
  type FieldProvenance,
  type InviteIdentity,
  type ListingCandidate,
  type ReviewStatus,
  resolveSearchGroup,
  updateListingField,
  updateReviewStatus,
} from "@/lib/listings";

const storageVersion = "v2";
const identityStorageKey = `apt-thing:${storageVersion}:identity`;
const themeStorageKey = `apt-thing:${storageVersion}:theme`;

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

const designOptions = [
  { id: "split", name: "Split Review" },
  { id: "board", name: "Status Board" },
  { id: "map", name: "Map Desk" },
  { id: "table", name: "Dense Table" },
  { id: "room", name: "Roommate Room" },
] as const;

type DesignId = (typeof designOptions)[number]["id"];
type ThemeId = "light" | "dark";

type SharedViewProps = {
  identity: InviteIdentity;
  isPending: boolean;
  listings: ListingCandidate[];
  message: string;
  selectedListing?: ListingCandidate;
  selectedId: string;
  url: string;
  onFieldChange: (
    listing: ListingCandidate,
    field: FieldProvenance["field"],
    value: string,
  ) => void;
  onIdentityChange: (field: keyof InviteIdentity, value: string) => void;
  onSelect: (listingId: string) => void;
  onStatusChange: (listing: ListingCandidate, status: ReviewStatus) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onUrlChange: (value: string) => void;
};

export function SavedListApp() {
  const [activeDesign, setActiveDesign] = useState<DesignId>("split");
  const [theme, setTheme] = useState<ThemeId>("light");
  const [isThemeReady, setIsThemeReady] = useState(false);
  const [identity, setIdentity] = useState<InviteIdentity>({
    groupId: defaultSearchGroup.id,
    inviteCode: defaultSearchGroup.inviteCode,
    displayName: "Roommate",
  });
  const [listings, setListings] = useState<ListingCandidate[]>(fixtureListings);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState(
    "Paste a listing URL to add it to this group's review list.",
  );
  const [selectedId, setSelectedId] = useState<string>(fixtureListings[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(themeStorageKey);

      if (savedTheme === "light" || savedTheme === "dark") {
        setTheme(savedTheme);
        return;
      }

      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setTheme("dark");
      }
    } finally {
      setIsThemeReady(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    if (!isThemeReady) {
      return;
    }

    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      setMessage("Could not save theme preference in this browser.");
    }
  }, [isThemeReady, theme]);

  useEffect(() => {
    try {
      const savedIdentity = window.localStorage.getItem(identityStorageKey);

      if (savedIdentity) {
        setIdentity(JSON.parse(savedIdentity) as InviteIdentity);
      }
    } catch {
      setMessage("Local browser identity storage is unavailable; using the default invite.");
    }
  }, []);

  useEffect(() => {
    const listingsStorageKey = createListingsStorageKey(identity.groupId);

    try {
      const savedListings = window.localStorage.getItem(listingsStorageKey);

      if (savedListings) {
        const parsedListings = JSON.parse(savedListings) as ListingCandidate[];
        setListings(parsedListings);
        setSelectedId(parsedListings[0]?.id ?? "");
        return;
      }

      const groupFixtures = fixtureListings.filter(
        (listing) => listing.groupId === identity.groupId,
      );
      setListings(groupFixtures);
      setSelectedId(groupFixtures[0]?.id ?? "");
    } catch {
      setMessage("Local browser listing storage is unavailable; showing fixture listings only.");
    }
  }, [identity.groupId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(identityStorageKey, JSON.stringify(identity));
    } catch {
      setMessage("Could not save invite identity in this browser.");
    }
  }, [identity]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        createListingsStorageKey(identity.groupId),
        JSON.stringify(listings),
      );
    } catch {
      setMessage("Could not save listings in this browser.");
    }
  }, [identity.groupId, listings]);

  const selectedListing = listings.find((listing) => listing.id === selectedId) ?? listings[0];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(() => {
      try {
        const group = resolveSearchGroup(identity.inviteCode);

        if (!group) {
          setMessage("Use a hardcoded G1 invite code before saving listings.");
          return;
        }

        const activeIdentity = { ...identity, groupId: group.id, inviteCode: group.inviteCode };
        const duplicateKey = createGroupScopedDuplicateKey(activeIdentity.groupId, url);
        const duplicate = listings.find(
          (listing) => createGroupScopedDuplicateKey(listing.groupId, listing.url) === duplicateKey,
        );

        if (duplicate) {
          setSelectedId(duplicate.id);
          setMessage("Duplicate listing found. Opening the existing saved record instead.");
          return;
        }

        const listing = createListingFromUrl(url, activeIdentity);
        setIdentity(activeIdentity);
        setListings((currentListings) => [listing, ...currentListings]);
        setSelectedId(listing.id);
        setUrl("");
        setMessage(
          "Saved a manual-needed listing stub. Add missing fields if extraction is incomplete.",
        );
      } catch {
        setMessage("Enter a valid apartment listing URL, including https://.");
      }
    });
  }

  function updateIdentity(field: keyof InviteIdentity, value: string) {
    setIdentity((currentIdentity) => {
      if (field !== "inviteCode") {
        return { ...currentIdentity, [field]: value };
      }

      const group = resolveSearchGroup(value);

      return {
        ...currentIdentity,
        groupId: group?.id ?? currentIdentity.groupId,
        inviteCode: value,
      };
    });
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

  const viewProps: SharedViewProps = {
    identity,
    isPending,
    listings,
    message,
    selectedId,
    selectedListing,
    url,
    onFieldChange: updateField,
    onIdentityChange: updateIdentity,
    onSelect: setSelectedId,
    onStatusChange: updateStatus,
    onSubmit: handleSubmit,
    onUrlChange: setUrl,
  };

  return (
    <main className="prototype" data-design={activeDesign}>
      <DesignSwitcher
        activeDesign={activeDesign}
        theme={theme}
        onChange={setActiveDesign}
        onThemeChange={setTheme}
      />
      {activeDesign === "split" ? <SplitReview {...viewProps} /> : null}
      {activeDesign === "board" ? <StatusBoard {...viewProps} /> : null}
      {activeDesign === "map" ? <MapDesk {...viewProps} /> : null}
      {activeDesign === "table" ? <DenseTable {...viewProps} /> : null}
      {activeDesign === "room" ? <RoommateRoom {...viewProps} /> : null}
    </main>
  );
}

function DesignSwitcher({
  activeDesign,
  theme,
  onChange,
  onThemeChange,
}: {
  activeDesign: DesignId;
  theme: ThemeId;
  onChange: (design: DesignId) => void;
  onThemeChange: (theme: ThemeId) => void;
}) {
  return (
    <nav className="design-switcher" aria-label="Design options">
      <strong>Apt review prototype</strong>
      <div className="design-tabs" role="tablist" aria-label="Choose design direction">
        {designOptions.map((option) => (
          <button
            type="button"
            key={option.id}
            role="tab"
            aria-selected={activeDesign === option.id}
            className={activeDesign === option.id ? "active" : ""}
            onClick={() => onChange(option.id)}
          >
            {option.name}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="theme-toggle"
        onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
        aria-pressed={theme === "dark"}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      </button>
    </nav>
  );
}

function SplitReview(props: SharedViewProps) {
  return (
    <section className="layout split-layout" aria-label="Split review layout">
      <aside className="left-rail">
        <AppHeader title="Review list" subtitle="Private group workspace" />
        <IntakeForm {...props} compact />
        <ListingList {...props} />
      </aside>
      <section className="main-detail">
        <ToolStrip {...props} />
        <ListingDetail {...props} />
      </section>
    </section>
  );
}

function StatusBoard(props: SharedViewProps) {
  return (
    <section className="layout board-layout" aria-label="Status board layout">
      <header className="board-top">
        <AppHeader title="Status board" subtitle="Drag later; click for now" />
        <IntakeForm {...props} />
      </header>
      <div className="board-columns">
        {reviewStatuses.map((status) => (
          <section key={status} className="board-column" aria-label={`${status} listings`}>
            <h2>{status}</h2>
            {props.listings
              .filter((listing) => listing.reviewStatus === status)
              .map((listing) => (
                <ListingButton
                  key={listing.id}
                  listing={listing}
                  selected={listing.id === props.selectedId}
                  onSelect={props.onSelect}
                  variant="stacked"
                />
              ))}
          </section>
        ))}
      </div>
      <aside className="board-inspector">
        <ListingDetail {...props} condensed />
      </aside>
    </section>
  );
}

function MapDesk(props: SharedViewProps) {
  return (
    <section className="layout map-layout" aria-label="Map desk layout">
      <header className="map-command">
        <AppHeader title="Map desk" subtitle="Saved places, source checks, and next actions" />
        <IntakeForm {...props} compact />
      </header>
      <section className="map-canvas" aria-label="Map preview">
        {props.listings.map((listing, index) => (
          <button
            type="button"
            key={listing.id}
            className={`map-marker marker-${index + 1} ${listing.id === props.selectedId ? "active" : ""}`}
            onClick={() => props.onSelect(listing.id)}
            aria-label={`Select ${listing.title}`}
          >
            <span>{index + 1}</span>
          </button>
        ))}
      </section>
      <aside className="map-side">
        <ListingList {...props} compact />
      </aside>
      <section className="map-bottom">
        <ListingDetail {...props} condensed />
      </section>
    </section>
  );
}

function DenseTable(props: SharedViewProps) {
  return (
    <section className="layout table-layout" aria-label="Dense table layout">
      <header className="table-header">
        <AppHeader title="Saved list" subtitle="Compact spreadsheet-style review" />
        <IntakeForm {...props} compact />
      </header>
      <div className="listing-table" role="table" aria-label="Saved listings table">
        <div className="table-row table-head" role="row">
          <span>Listing</span>
          <span>Area</span>
          <span>Rent</span>
          <span>Beds/Baths</span>
          <span>Status</span>
        </div>
        {props.listings.map((listing) => (
          <button
            type="button"
            key={listing.id}
            className={`table-row ${listing.id === props.selectedId ? "selected" : ""}`}
            onClick={() => props.onSelect(listing.id)}
            role="row"
          >
            <span>{listing.title}</span>
            <span>{listing.neighborhood ?? "Unknown"}</span>
            <span>{formatMoney(listing.rent)}</span>
            <span>
              {listing.bedrooms ?? "?"}/{listing.bathrooms ?? "?"}
            </span>
            <span>{listing.reviewStatus}</span>
          </button>
        ))}
      </div>
      <ListingDetail {...props} condensed />
    </section>
  );
}

function RoommateRoom(props: SharedViewProps) {
  const selected = props.selectedListing;

  return (
    <section className="layout room-layout" aria-label="Roommate room layout">
      <header className="room-header">
        <AppHeader title="Roommate room" subtitle="One place to decide what is worth touring" />
        <IdentityPanel {...props} />
      </header>
      <section className="room-focus">
        <IntakeForm {...props} compact />
        <ListingDetail {...props} condensed />
      </section>
      <aside className="room-stack">
        <h2>Queue</h2>
        <ListingList {...props} compact />
      </aside>
      <aside className="room-notes">
        <h2>Today</h2>
        <p>
          StreetEasy batch checked preferred Manhattan areas. Zillow remains manual-needed when
          provider data is incomplete.
        </p>
        {selected ? (
          <p>
            Current focus: {selected.title}, {selected.reviewStatus}.
          </p>
        ) : null}
      </aside>
    </section>
  );
}

function AppHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="app-header">
      <p>Apt Thing</p>
      <h1>{title}</h1>
      <span>{subtitle}</span>
    </div>
  );
}

function ToolStrip(props: SharedViewProps) {
  return (
    <div className="tool-strip" aria-label="Workspace summary">
      <span>{props.listings.length} saved</span>
      <span>
        {props.listings.filter((listing) => listing.reviewStatus === "touring").length} touring
      </span>
      <IdentityPanel {...props} inline />
    </div>
  );
}

function IntakeForm(props: SharedViewProps & { compact?: boolean }) {
  return (
    <section
      className={props.compact ? "intake compact" : "intake"}
      aria-label="Paste listing intake"
    >
      <form onSubmit={props.onSubmit} className="intake-form">
        <label>
          Paste listing URL
          <input
            type="url"
            placeholder="https://streeteasy.com/..."
            value={props.url}
            onChange={(event) => props.onUrlChange(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={props.isPending}>
          {props.isPending ? "Saving" : "Add"}
        </button>
      </form>
      <p>{props.message}</p>
    </section>
  );
}

function IdentityPanel(props: SharedViewProps & { inline?: boolean }) {
  return (
    <div className={props.inline ? "identity inline" : "identity"} aria-label="Invite identity">
      <label>
        Invite
        <input
          value={props.identity.inviteCode}
          onChange={(event) => props.onIdentityChange("inviteCode", event.target.value)}
        />
      </label>
      <label>
        Name
        <input
          value={props.identity.displayName}
          onChange={(event) => props.onIdentityChange("displayName", event.target.value)}
        />
      </label>
    </div>
  );
}

function ListingList(props: SharedViewProps & { compact?: boolean }) {
  return (
    <section
      className={props.compact ? "listing-list compact" : "listing-list"}
      aria-label="Saved listings"
    >
      {!props.compact ? <h2>Saved</h2> : null}
      {props.listings.map((listing) => (
        <ListingButton
          key={listing.id}
          listing={listing}
          selected={listing.id === props.selectedId}
          onSelect={props.onSelect}
        />
      ))}
    </section>
  );
}

function ListingButton({
  listing,
  onSelect,
  selected,
  variant,
}: {
  listing: ListingCandidate;
  onSelect: (listingId: string) => void;
  selected: boolean;
  variant?: "stacked";
}) {
  return (
    <button
      type="button"
      className={`listing-button ${selected ? "selected" : ""} ${variant ?? ""}`}
      onClick={() => onSelect(listing.id)}
    >
      <strong>{listing.title}</strong>
      <span>
        {listing.neighborhood ?? "Unknown"} · {formatMoney(listing.rent)} ·{" "}
        {listing.bedrooms ?? "?"}BR
      </span>
      <small>
        {listing.source} / {listing.reviewStatus}
      </small>
    </button>
  );
}

function ListingDetail(props: SharedViewProps & { condensed?: boolean }) {
  const listing = props.selectedListing;

  if (!listing) {
    return null;
  }

  return (
    <article
      className={props.condensed ? "detail condensed" : "detail"}
      aria-label="Listing detail"
    >
      <header className="detail-top">
        <div>
          <p>
            {listing.source} / {listing.extractionStatus}
          </p>
          <h2>{listing.title}</h2>
          <span>
            {listing.address}
            {listing.neighborhood ? `, ${listing.neighborhood}` : ""}
          </span>
        </div>
        <a href={listing.url} target="_blank" rel="noreferrer">
          Source
        </a>
      </header>

      <section className="facts" aria-label="Listing facts">
        <DataPoint label="Rent" value={formatMoney(listing.rent)} />
        <DataPoint label="Beds" value={String(listing.bedrooms ?? "?")} />
        <DataPoint label="Baths" value={String(listing.bathrooms ?? "?")} />
        <DataPoint label="Available" value={listing.availableAt ?? "TBD"} />
      </section>

      <section className="status-control" aria-label="Review status">
        {reviewStatuses.map((status) => (
          <button
            type="button"
            key={status}
            className={listing.reviewStatus === status ? "active" : ""}
            onClick={() => props.onStatusChange(listing, status)}
          >
            {status}
          </button>
        ))}
      </section>

      <section className="edit-fields" aria-label="Editable fields">
        {editableFields.map((field) => (
          <label key={field}>
            {field}
            <input
              value={String(listing[field] ?? "")}
              onChange={(event) => props.onFieldChange(listing, field, event.target.value)}
            />
          </label>
        ))}
      </section>

      <section className="evidence" aria-label="Evidence and concerns">
        <div>
          <h3>Evidence</h3>
          {listing.evidence.map((evidence) => (
            <p key={`${evidence.claim}-${evidence.quote}`}>
              <strong>{evidence.claim}:</strong> {evidence.quote}
            </p>
          ))}
        </div>
        <div>
          <h3>Concerns</h3>
          {listing.concerns.length > 0 ? (
            listing.concerns.map((concern) => <p key={concern}>{concern}</p>)
          ) : (
            <p>No concerns yet.</p>
          )}
        </div>
      </section>
    </article>
  );
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="data-point">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function createListingsStorageKey(groupId: string) {
  return `apt-thing:${storageVersion}:groups:${groupId}:listings`;
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
