import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { g3cBriefingRunHistoryFixture } from "../lib/agent-contract-fixtures";
import type { BriefingRunHistoryContract, BriefingRunHistoryRun } from "../lib/agent-contracts";
import { fixtureListings } from "../lib/fixtures";
import { defaultSearchGroup, type ListingCandidate } from "../lib/listings";
import {
  GroupActionSummary,
  ListingEditor,
  ReactionScoreBadge,
  RunHistoryPanel,
  SavedListApp,
  createRunHistoryPanelModel,
  formatAverageRent,
} from "./SavedListApp";
import { runMobileAcceptanceScenario, type MobileAcceptanceMarker } from "../lib/mobile-acceptance";
import type { GroupActionRecord } from "../lib/agent-contracts";

const savedListingsStorageKey = `apt-thing:v1:groups:${defaultSearchGroup.id}:saved-listings`;

describe("run history panel", () => {
  it("derives table rows for manual, daily, and future hourly-compatible runs", () => {
    const history = createHistoryWithCadenceVariants();
    const model = createRunHistoryPanelModel(history);

    expect(model.runs.map((run) => run.cadence)).toEqual(["hourly", "daily", "manual"]);
    expect(model.runs.map((run) => run.statusLabel)).toEqual(["running", "partial", "success"]);
    expect(model.runs[1]?.apiMatchedCount).toBeGreaterThan(0);
    expect(model.runs[1]?.checkedOrScrapedCount).toBeGreaterThan(0);
    expect(model.runs[1]?.checkedOrScrapedLabel).not.toBe("Not separately recorded");
    expect(model.runs[1]?.skippedCount).toBeGreaterThan(0);
    expect(model.runs[1]?.aiOutputLabel).toContain("yes");
    expect(model.runs[1]?.candidateSummaries.length).toBeGreaterThan(0);
    expect(model.runs[1]?.counts.sourceFailures).toBe(0);
    expect(model.runs[1]?.sourceCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "streeteasy", status: "success", checkedCount: 4 }),
      ]),
    );
    expect(model.runs[1]?.sourceCoverage).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "fixture-secondary-source" })]),
    );
    expect(model.runs[1]?.providerMetadata).toContain("google-direct / gemini-3.5-flash");
    expect(model.runs[1]?.artifactPointers.some((pointer) => pointer.ownerLabel === "D1")).toBe(
      true,
    );
  });

  it("renders a clean run table with expandable pipeline details", () => {
    const history = createHistoryWithCadenceVariants();
    const markup = renderToStaticMarkup(React.createElement(RunHistoryPanel, { history }));

    expect(markup).toContain('aria-label="Agent run history"');
    expect(markup).toContain('class="run-table"');
    expect(markup).toContain("Run history");
    expect(markup).toContain("Runs");
    expect(markup).toContain("Candidates");
    expect(markup).toContain("Source checks");
    expect(markup).toContain("Candidate matches found");
    expect(markup).toContain("Source records checked");
    expect(markup).toContain("AI attempts recorded");
    expect(markup).toContain("How to read the counts");
    expect(markup).toContain("Meets criteria");
    expect(markup).toContain("Does not meet criteria");
    expect(markup).toContain("Output listings");
    expect(markup).toContain("Source/API coverage");
    expect(markup).not.toContain("fixture-source-unavailable");
    expect(markup).not.toContain("fixture-secondary-source");
    expect(markup).toContain("AI calls");
    expect(markup).toContain("google-direct / gemini-3.5-flash");
    expect(markup).toContain("Stored pointers");
    expect(markup).toContain("D1 storage keys for evidence metadata rows");
    expect(markup).toContain("D1 pointer");
    expect(markup).toContain('class="artifact-pointer-grid"');
    expect(markup).toContain('class="artifact-pointer-row"');
    expect(markup).not.toContain("D1 artifact");
    expect(markup).not.toContain('href="#artifact-');
    expect(markup).not.toContain("source-failure");
    expect(markup).not.toContain("Supported cadence values");
    expect(markup).not.toContain("Run ledger");
    expect(markup).not.toContain("<h4>Failures</h4>");
    expect(markup).not.toContain("<details open");
    expect(markup).not.toContain("No failures.");
    expect(markup).not.toContain("Timestamps");
  });
});

describe("run history verification guardrails", () => {
  it("keeps group listing reads from sending invite codes in query strings", () => {
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");

    expect(componentSource).toContain('"X-Invite-Code": activeIdentity.inviteCode');
    expect(componentSource).toContain('"X-Display-Name": activeIdentity.displayName');
    expect(componentSource).not.toContain("&inviteCode=");
  });

  it("keeps history mobile-first without desktop table markup", () => {
    const markup = renderRunHistoryMarkup();
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(markup).toContain('class="run-table"');
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain('role="table"');
    expect(css).toMatch(
      /@media \(max-width: 860px\)[\s\S]*\.run-history-header,[\s\S]*grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*\.run-table-head/);
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*\.run-cell::before/);
    expect(css).not.toMatch(/display:\s*table|table-layout:/);
  });

  it("does not expose a push-notification dependency in history surfaces", () => {
    const markup = renderRunHistoryMarkup();
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");

    expect(markup).not.toMatch(/push notification|email|slack|sms/i);
    expect(componentSource).not.toMatch(
      /\b(Notification|PushManager|pushManager|serviceWorker|showNotification)\b/,
    );
  });
});

describe("map review realism guardrails", () => {
  it("uses Leaflet with apartment pins and an interactive MTA subway overlay", () => {
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(componentSource).toContain("/api/map/tiles/{z}/{x}/{y}.png?inviteCode=");
    expect(componentSource).toContain("detectRetina: false");
    expect(componentSource).toContain("createLeafletTileUrl(identity)");
    expect(componentSource).not.toContain("NEXT_PUBLIC_STADIA_MAPS_API_KEY");
    expect(componentSource).not.toContain("api_key=");
    expect(componentSource).toContain("Leaflet NYC apartment map");
    expect(componentSource).toContain("syncLeafletMap");
    expect(componentSource).toContain("MTA_SUBWAY_FEATURE_SERVICE");
    expect(componentSource).toContain("MTA_Subway_Routes_Stops/FeatureServer");
    expect(componentSource).toContain("fetchSubwayGeoJson");
    expect(componentSource).toContain("groceryStoreLocations");
    expect(componentSource).toContain("latitude: 40.73067");
    expect(componentSource).toContain("longitude: -73.98077");
    expect(componentSource).toContain("createGroceryLeafletIcon");
    expect(componentSource).toContain("createGroceryPopup");
    expect(componentSource).toContain("https://locations.traderjoes.com/ny/");
    expect(componentSource).toContain("https://www.wholefoodsmarket.com/stores");
    expect(componentSource).toContain("Trader Joe's Staten Island - South Shore");
    expect(componentSource).toContain("Whole Foods Market Grand Street");
    expect(componentSource).toContain("leaflet.circleMarker");
    expect(componentSource).toContain("Routes: ");
    expect(componentSource).toContain('import("leaflet")');
    expect(componentSource).not.toContain("createPoiLeafletIcon");
    expect(componentSource).not.toContain("leaflet-poi-pin");
    expect(componentSource).toContain("scrollWheelZoom: true");
    expect(componentSource).not.toContain("onWheel={handleWheel}");
    expect(componentSource).not.toContain('<div className="map-attribution">');
    expect(componentSource).not.toContain("Listing coordinates use source/provider fixtures");
    expect(componentSource).not.toContain("Fixture candidate map shell");
    expect(css).toContain('@import "leaflet/dist/leaflet.css";');
    expect(css).toContain(".leaflet-map");
    expect(css).toContain(".leaflet-control-zoom");
    expect(css).toContain(".leaflet-listing-pin");
    expect(css).toContain(".leaflet-grocery-pin");
    expect(css).toContain(".leaflet-grocery-pin.whole-foods");
    expect(css).toContain(".leaflet-grocery-pin.trader-joes");
    expect(css).toContain(".leaflet-subway-station");
    expect(css).not.toContain(".leaflet-poi-pin");
    expect(css.includes(".map-attribution")).toBe(false);
    expect(css.includes(".zone-overlay")).toBe(false);
    expect(css.includes(".map-tile-layer")).toBe(false);
    expect(css.includes(".map-zoom-controls")).toBe(false);
    expect(css.includes(".map-pin")).toBe(false);
    expect(componentSource.includes("Preferred Manhattan zone")).toBe(false);
    expect(componentSource.includes("Brooklyn/Queens fallback context")).toBe(false);
    expect((componentSource.match(/brand: "trader-joes"/g) ?? []).length).toBe(18);
    expect((componentSource.match(/brand: "whole-foods"/g) ?? []).length).toBe(21);
    const mapShellBlock = css.slice(css.indexOf(".map-shell {"), css.indexOf(".leaflet-map"));
    expect(mapShellBlock).not.toContain("repeating-linear-gradient");
    expect(mapShellBlock).not.toContain("#d8d3c2");
  });

  it("keeps the map page focused and opens mobile map selections in the detail modal", () => {
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(componentSource).not.toContain("Map-enhanced review");
    expect(componentSource).not.toContain("Apartment pins with interactive MTA subway lines");
    expect(componentSource).not.toContain('className="map-mode-tabs"');
    expect(componentSource).toContain("isDetailOverlayOpen={isDetailOverlayOpen}");
    expect(componentSource).toContain("onSelect={handleListingSelect}");
    expect(componentSource).toContain("map-listing-detail-shell mobile-detail-open");
    expect(componentSource).toContain("listing={selected?.listing}");
    expect(css).toMatch(/\.map-listing-detail-shell \{[\s\S]*display: none;/);
    expect(css).toMatch(/@media \(max-width: 860px\)[\s\S]*\.map-detail \{[\s\S]*display: none;/);
  });
});

describe("listing detail attribution", () => {
  it("shows AI attribution for batch-created listings in the detail header", () => {
    const batchListing = fixtureListings.find((listing) => !listing.userQualified)!;
    const markup = renderListingEditorMarkup(batchListing);

    expect(markup).toContain("Added by AI");
  });

  it("shows the submitting user for pasted URL listings in the detail header", () => {
    const userListing = fixtureListings.find((listing) => listing.userQualified)!;
    const markup = renderListingEditorMarkup(userListing);

    expect(markup).toContain(`Added by ${userListing.submittedBy}`);
  });

  it("keeps detail attribution right-aligned with the header actions", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.editor-header-actions \{[\s\S]*justify-content: flex-end;/);
    expect(css).toMatch(/\.listing-added-by \{[\s\S]*text-align: right;/);
  });

  it("keeps compact listing rows in non-overlapping grid columns", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(css).toMatch(
      /\.listing-row-button \{[\s\S]*grid-template-columns: minmax\(74px, max-content\) minmax\(0, 1fr\) minmax\(72px, max-content\);/,
    );
    expect(css).toMatch(/\.listing-row-main \{[\s\S]*min-width: 0;/);
    expect(css).toMatch(/\.listing-row-button > strong:last-child \{[\s\S]*white-space: nowrap;/);
  });

  it("labels compact listing rows with average rent per bedroom", () => {
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");

    expect(componentSource).toContain("<span>Avg Rent</span>");
    expect(componentSource).toContain("<strong>{formatAverageRent(listing)}</strong>");
    expect(formatAverageRent({ rent: 14500, bedrooms: 5 })).toBe("$2,900");
    expect(formatAverageRent({ rent: 10150, bedrooms: 6 })).toBe("$1,692");
    expect(formatAverageRent({ rent: 14500 })).toBe("?");
    expect(formatAverageRent({ bedrooms: 5 })).toBe("?");
  });

  it("opens listing detail as a dismissible full-screen overlay on mobile widths", () => {
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const markup = renderListingEditorMarkup(fixtureListings[0]!);

    expect(componentSource).toContain("const [isDetailOverlayOpen, setIsDetailOverlayOpen]");
    expect(componentSource).toContain("function handleListingSelect");
    expect(componentSource).toContain("setIsDetailOverlayOpen(true)");
    expect(componentSource).toContain("mobile-detail-open");
    expect(componentSource).toContain("onClose={() => setIsDetailOverlayOpen(false)}");
    expect(markup).toContain('class="listing-detail-close"');
    expect(markup).toContain('aria-label="Close listing detail"');
    expect(css).toMatch(
      /@media \(max-width: 860px\)[\s\S]*\.listing-detail-shell \{[\s\S]*display: none;/,
    );
    expect(css).toMatch(
      /\.listing-detail-shell\.mobile-detail-open \{[\s\S]*position: fixed;[\s\S]*inset: 0;[\s\S]*z-index: 1000;/,
    );
    expect(css).toMatch(
      /\.listing-detail-shell\.mobile-detail-open \.editor-panel \{[\s\S]*height: 100dvh;[\s\S]*overflow: auto;/,
    );
    expect(css).toMatch(/\.listing-detail-close \{[\s\S]*display: inline-grid;/);
  });

  it("keeps map list cards from overflowing wrapped title and context text", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.map-list-item \{[\s\S]*grid-template-rows: auto auto auto auto;/);
    expect(css).toMatch(/\.map-list-item \{[\s\S]*line-height: 1\.18;/);
    expect(css.indexOf(".map-list-item {", css.indexOf("button,"))).toBeGreaterThan(
      css.indexOf("button,"),
    );
    expect(css).toMatch(
      /\.map-list-item span,[\s\S]*\.map-list-item small \{[\s\S]*white-space: nowrap;/,
    );
    expect(css).toMatch(/\.map-list-item strong \{[\s\S]*-webkit-line-clamp: 2;/);
    expect(css).toMatch(/\.map-list-item strong \{[\s\S]*overflow-wrap: anywhere;/);
  });

  it("renders status above the conditional listing photo carousel", () => {
    const listingWithPhotos = fixtureListings.find((listing) => listing.photos.length > 0)!;
    const markup = renderListingEditorMarkup(listingWithPhotos);

    expect(markup).toContain('class="listing-photo-carousel"');
    expect(markup).toContain(`aria-label="Media for ${listingWithPhotos.title}"`);
    expect(markup.indexOf('class="status-control detail-status-control"')).toBeGreaterThan(
      markup.indexOf(listingWithPhotos.address),
    );
    expect(markup.indexOf('class="listing-photo-carousel"')).toBeGreaterThan(
      markup.indexOf('class="status-control detail-status-control"'),
    );
    expect(markup.indexOf('aria-label="Listing facts"')).toBeGreaterThan(
      markup.indexOf('class="listing-photo-carousel"'),
    );
  });

  it("adds a map selector to the photo carousel that uses only the current listing", () => {
    const listingWithPhotos = fixtureListings.find((listing) => listing.photos.length > 0)!;
    const markup = renderListingEditorMarkup(listingWithPhotos);
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(markup).toContain('class="listing-photo-thumbnail listing-map-thumbnail"');
    expect(markup).toContain(`aria-label="Show map for ${listingWithPhotos.title}"`);
    expect(markup).toContain('class="listing-photo-media-strip"');
    expect(markup.indexOf('class="listing-photo-thumbnail listing-map-thumbnail"')).toBeLessThan(
      markup.indexOf('class="listing-photo-thumbnails"'),
    );
    expect(markup.indexOf('class="listing-photo-thumbnail listing-map-thumbnail"')).toBeLessThan(
      markup.indexOf(`aria-label="Show photo 1 of ${listingWithPhotos.photos.length}`),
    );
    expect(componentSource).toContain("createMapReviewModel([listing], listing.id)");
    expect(componentSource).toContain("<ListingInlineMap identity={identity} listing={listing} />");
    expect(componentSource).toContain("identity?: InviteIdentity;");
    expect(componentSource).toContain('className="listing-inline-map"');
    expect(componentSource).toContain(
      'className="listing-photo-media-strip listing-photo-modal-media-strip"',
    );
    expect(css).toMatch(/\.listing-photo-media-strip \{[\s\S]*grid-template-columns:/);
    expect(css).toMatch(/\.listing-photo-thumbnails \{[\s\S]*overflow-x: auto;/);
    const mapThumbnailBlock = css.match(/\.listing-map-thumbnail \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(mapThumbnailBlock).not.toContain("position: sticky");
  });

  it("lets side arrow keys navigate both inline and enlarged photo carousels", () => {
    const listingWithPhotos = fixtureListings.find((listing) => listing.photos.length > 0)!;
    const markup = renderListingEditorMarkup(listingWithPhotos);
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");

    expect(markup).toContain('tabindex="0"');
    expect(componentSource).toContain("const handlePhotoCarouselKeyDown");
    expect(componentSource).toContain("onKeyDown={handlePhotoCarouselKeyDown}");
    expect(componentSource).toContain('event.key === "ArrowLeft"');
    expect(componentSource).toContain('event.key === "ArrowRight"');
    expect(componentSource).toContain('window.addEventListener("keydown", handleModalKeyDown)');
  });

  it("shows the inline listing map even when a listing has no photos", () => {
    const listingWithoutPhotos: ListingCandidate = {
      ...fixtureListings[0]!,
      id: "no-photo-map-listing",
      title: "No photo map listing",
      photos: [],
      imageEvidence: [],
    };

    const markup = renderListingEditorMarkup(listingWithoutPhotos);

    expect(markup).toContain(`aria-label="Media for ${listingWithoutPhotos.title}"`);
    expect(markup).toContain('class="listing-inline-map"');
    expect(markup).toContain(`Interactive map for ${listingWithoutPhotos.title}`);
    expect(markup).not.toContain('class="listing-photo-thumbnails"');
  });

  it("shows listing descriptions above the group section", () => {
    const listingWithDescription: ListingCandidate = {
      ...fixtureListings[0]!,
      description: "Private roof deck, in-unit laundry, and oversized bedrooms.",
    };
    const markup = renderListingEditorMarkup(listingWithDescription);

    expect(markup).toContain('aria-label="Listing description"');
    expect(markup).toContain("About");
    expect(markup).toContain(listingWithDescription.description);
    expect(markup.indexOf('aria-label="Listing description"')).toBeLessThan(
      markup.indexOf('aria-label="Group comments and reactions"'),
    );
  });

  it("shows approve/reject controls for review-needed listings", () => {
    const reviewListing = fixtureListings.find(
      (listing) => listing.triageBucket === "review-needed",
    )!;
    const markup = renderListingEditorMarkup({
      ...reviewListing,
      reviewStatus: "review",
    });

    expect(markup).toContain('aria-label="Review decision"');
    expect(markup).toContain("Approve");
    expect(markup).toContain("Reject and remove");
  });

  it("locks the status dropdown until a review-needed listing is approved or rejected", () => {
    const reviewListing = fixtureListings.find(
      (listing) => listing.triageBucket === "review-needed",
    )!;
    const approvedListing: ListingCandidate = {
      ...reviewListing,
      triageBucket: "confirmed-match",
      reviewStatus: "new",
    };

    const reviewMarkup = renderListingEditorMarkup({
      ...reviewListing,
      reviewStatus: "review",
    });
    const approvedMarkup = renderListingEditorMarkup(approvedListing);

    expect(reviewMarkup).toMatch(
      /<button type="button" class="status-dropdown-trigger status-review"[^>]*disabled=""/,
    );
    expect(reviewMarkup).not.toContain('class="status-dropdown-option status-review');
    expect(approvedMarkup).toMatch(
      /<button type="button" class="status-dropdown-trigger status-new"/,
    );
    expect(approvedMarkup).not.toMatch(
      /<button type="button" class="status-dropdown-trigger status-new"[^>]*disabled=""/,
    );
    expect(approvedMarkup).not.toContain('class="status-dropdown-option status-review');
  });

  it("styles pending review controls with disabled status and hover states", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.status-dropdown-trigger:disabled,[\s\S]*cursor: not-allowed;/);
    expect(css).toMatch(/\.status-dropdown-trigger:disabled,[\s\S]*background: color-mix/);
    expect(css).toMatch(/\.review-decision-actions \.review-approve-button:hover/);
    expect(css).toMatch(/\.review-decision-actions \.secondary-danger:hover/);
    expect(css).toMatch(
      /@media \(max-width: 860px\)[\s\S]*\.review-decision-panel \{[\s\S]*grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 860px\)[\s\S]*\.review-decision-panel \.eyebrow,[\s\S]*display: none;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 860px\)[\s\S]*\.review-decision-actions \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
  });

  it("keeps the field edit modal above status dropdown and map layers", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.detail-status-control \{[\s\S]*z-index: 1100;/);
    expect(css).toMatch(/\.field-modal-backdrop \{[\s\S]*z-index: 1200;/);
  });

  it("collapses long listing descriptions behind a view more control", () => {
    const listingWithLongDescription: ListingCandidate = {
      ...fixtureListings[0]!,
      description:
        "Private roof deck headline\n\nThis first paragraph gives enough context about the apartment, bedrooms, shared space, and location without forcing the whole broker writeup into the first screen.\n\nThis second paragraph should stay hidden until the roommate chooses to expand the About section.",
    };
    const markup = renderListingEditorMarkup(listingWithLongDescription);

    expect(markup).toContain("Private roof deck headline");
    expect(markup).toContain("This first paragraph gives enough context");
    expect(markup).toContain("View more");
    expect(markup).not.toContain("This second paragraph should stay hidden");
  });

  it("shows time since the listing was added in the detail facts", () => {
    const fourDayOldListing: ListingCandidate = {
      ...fixtureListings[0]!,
      createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const markup = renderListingEditorMarkup(fourDayOldListing);

    expect(markup).toContain("Added");
    expect(markup).toContain("4 days");
  });

  it("renders map-only media without photo thumbnails when there are no photos", () => {
    const listingWithoutPhotos = fixtureListings.find((listing) => listing.photos.length === 0)!;
    const markup = renderListingEditorMarkup(listingWithoutPhotos);

    expect(markup).toContain('class="listing-photo-carousel"');
    expect(markup).toContain(`aria-label="Media for ${listingWithoutPhotos.title}"`);
    expect(markup).toContain('class="listing-inline-map"');
    expect(markup).not.toContain('class="listing-photo-thumbnails"');
    expect(markup).not.toMatch(/\d+ notes/);
    expect(markup).not.toContain("No invite");
  });
});

describe("T-1.6 mobile-first and accessibility acceptance guardrails", () => {
  it("renders only the invite gate before a valid identity is saved", () => {
    const markup = renderToStaticMarkup(React.createElement(SavedListApp));

    expect(markup).toContain('aria-label="Invite gate"');
    expect(markup).toContain('aria-label="Invite identity"');
    expect(markup).toContain("Invite code");
    expect(markup).toContain("Display name");
    expect(markup).toContain("Enter shared list");
    expect(markup).toContain("No active group");
    expect(markup).not.toContain('aria-label="Apartment search workspace sections"');
    expect(markup).not.toContain('aria-label="Saved listing review queue"');
    expect(markup).not.toContain('aria-label="Add listing"');
    expect(markup).not.toContain('aria-label="Listing detail panel"');
    expect(markup).not.toContain("Listings");
    expect(markup).not.toContain("Map");
    expect(markup).not.toContain("Briefing");
    expect(markup).not.toContain("Runs");
  });

  it("keeps identity persistence behind explicit save and then loads the shared snapshot", () => {
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");

    expect(componentSource).toContain("function handleIdentitySubmit");
    expect(componentSource).toContain("writeInviteIdentity(");
    expect(componentSource).toContain(
      "void refreshSharedSnapshot(resolution.identity, { silent: true });",
    );
    expect(componentSource).toContain("Invite code or display name is invalid.");
    expect(componentSource).toContain('if (!savedIdentity || savedIdentity.kind !== "valid")');
  });

  it("covers every mobile acceptance marker required by the hardening story", () => {
    const acceptance = runMobileAcceptanceScenario();
    const expectedMarkers: MobileAcceptanceMarker[] = [
      "saved-list-review",
      "paste-input-target",
      "batch-status-panel",
      "map-list-detail",
      "comments-reactions-status",
      "review-status-controls",
      "edit-field-controls",
      "detail-expansion",
      "source-link-opening",
      "run-history",
      "focus-states",
      "safe-area-insets",
      "touch-targets",
      "keyboard-behavior",
      "mobile-viewport",
    ];

    expect(acceptance.allChecksPassed).toBe(true);
    expect(acceptance.platform).toBe("ios-safari-equivalent");
    expect(acceptance.viewportFit).toBe("cover");
    expect(acceptance.coveredAcceptanceMarkers).toEqual(expect.arrayContaining(expectedMarkers));
  });

  it("renders mobile-safe labels, live feedback, keyboard hints, and stateful controls", () => {
    const markup = renderToStaticMarkup(React.createElement(SavedListApp));

    expect(markup).toContain('class="dashboard-shell"');
    expect(markup).toContain('aria-label="Invite gate"');
    expect(markup).toContain('aria-label="Invite identity"');
    expect(markup).toContain("Enter shared list");
    expect(markup).not.toContain('aria-label="Apartment search workspace sections"');
    expect(markup).not.toContain('class="theme-toggle"');
    expect(markup).not.toContain("☀");
    expect(markup).not.toContain("☾");
    expect(markup).not.toContain("⚙");
    expect(markup).not.toContain(">Light</button>");
    expect(markup).not.toContain(">Dark</button>");
    expect(markup).not.toContain('class="summary-grid"');
    expect(markup).not.toContain('class="intake-card"');
    expect(markup).not.toContain("Queue</p>");
    expect(markup).not.toContain('aria-label="StreetEasy batch status"');
    expect(markup).not.toContain("StreetEasy manual batch");
    expect(markup).not.toContain('aria-label="Saved listing review queue"');
    expect(markup).not.toContain('aria-label="Add listing"');
    expect(markup).not.toContain('class="empty-state"');
    expect(markup).not.toContain("No listings.");
    expect(markup).not.toContain('<button type="submit" disabled="">Add</button>');
    expect(markup).not.toContain('aria-label="Listing table"');
    expect(markup).not.toContain('class="listing-table-head"');
    expect(markup).not.toContain("Map");
    expect(markup).not.toContain('aria-label="Map enhanced review"');
    expect(markup).not.toContain('aria-label="Listing detail panel"');
    expect(markup).not.toContain("No listing selected yet.");
    expect(markup).not.toContain('aria-label="Group comments and reactions"');
    expect(markup).not.toContain('aria-label="Extraction, batch, and triage state"');
    expect(markup).not.toContain('class="source-details"');
    expect(markup).not.toContain('class="state-grid panel-state"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain('inputMode="url"');
    expect(markup).not.toContain('enterKeyHint="go"');
    expect(markup).not.toContain('enterKeyHint="done"');
    expect(markup).not.toContain('aria-pressed="true"');
    expect(markup).not.toContain('class="status-control detail-status-control"');
    expect(markup).not.toContain('class="status-dropdown-trigger status-');
    expect(markup).not.toContain('aria-label="Change review status for');
    expect(markup).not.toContain('aria-label="React thumbs up to');
    expect(markup).not.toContain("Add comment");
    expect(markup).not.toContain('class="reaction-icon"');
    expect(markup).not.toContain("summary-icon");
    expect(markup).not.toContain("Add feedback");
    expect(markup).not.toContain("👍");
    expect(markup).not.toContain("👎");
    expect(markup).not.toContain("👀");
    expect(markup).not.toContain("❓");
    expect(markup).not.toContain(">thumbs up</button>");
    expect(markup).not.toContain("records · click a row");
    expect(markup).not.toContain("Source opened.");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain('role="table"');
  });

  it("does not ship unsupported newer JS calls in iOS Safari runtime paths", () => {
    const componentSource = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");
    const listingSource = readFileSync(new URL("../lib/listings.ts", import.meta.url), "utf8");

    expect(componentSource).not.toMatch(/\.at\(/);
    expect(componentSource).not.toMatch(/\.replaceAll\(/);
    expect(listingSource).not.toMatch(/\.at\(/);
    expect(listingSource).not.toMatch(/\.replaceAll\(/);
  });

  it("renders the reaction score badge with a partitioned hover popup", () => {
    const actions = {
      reactions: [
        createGroupAction("reaction-1", "Ari", {
          actionType: "reaction",
          reaction: "thumbs-up",
        }),
        createGroupAction("reaction-2", "Shane", {
          actionType: "reaction",
          reaction: "thumbs-up",
        }),
        createGroupAction("reaction-3", "Local reviewer", {
          actionType: "reaction",
          reaction: "thumbs-down",
        }),
      ],
      comments: [
        createGroupAction("comment-1", "Bo", {
          actionType: "comment",
          commentBody: "Ask whether the flex room has a window.",
        }),
      ],
      statusChanges: [
        createGroupAction("status-1", "Cam", {
          actionType: "status-change",
          status: "touring",
        }),
      ],
      sourceLinkOpens: [],
      feedback: [],
    };
    const markup = renderToStaticMarkup(
      React.createElement(ReactionScoreBadge, { reactions: actions.reactions }),
    );

    expect(markup).toContain('class="reaction-score-badge positive"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain(
      'aria-label="Reaction score: plus 2. Hover or focus to see who liked or passed."',
    );
    expect(markup).toContain("+2");
    expect(markup).toContain('class="reaction-score-popover"');
    expect(markup).toContain('class="reaction-name-group" aria-label="Liked"');
    expect(markup).toContain("<h4>Liked</h4>");
    expect(markup).toContain("<li>Ari</li>");
    expect(markup).toContain("<li>Shane</li>");
    expect(markup).toContain('class="reaction-name-group" aria-label="Passed"');
    expect(markup).toContain("<h4>Passed</h4>");
    expect(markup).toContain("<li>Local reviewer</li>");
    expect(markup).not.toContain("Current reactions");
    expect(markup).not.toContain("Score");
    expect(markup).not.toContain("likes ·");
    expect(markup).not.toContain("passs");
    expect(markup).not.toContain("statuses");
    expect(markup).not.toContain("status-change");
    expect(markup).not.toContain("set status");
    expect(markup).not.toContain("1 reactions");
  });

  it("hides the reaction score badge when there are no likes", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReactionScoreBadge, {
        reactions: [
          createGroupAction("reaction-1", "Bo", {
            actionType: "reaction",
            reaction: "thumbs-down",
          }),
        ],
      }),
    );

    expect(markup).toBe("");
  });

  it("counts likes without subtracting passes from the visible score", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReactionScoreBadge, {
        reactions: [
          createGroupAction("reaction-1", "Ari", {
            actionType: "reaction",
            reaction: "thumbs-up",
          }),
          createGroupAction("reaction-2", "Bo", {
            actionType: "reaction",
            reaction: "thumbs-down",
          }),
        ],
      }),
    );

    expect(markup).toContain("+1");
    expect(markup).toContain("<h4>Passed</h4>");
    expect(markup).toContain("<li>Bo</li>");
  });

  it("renders the score below the listing title and above listing facts", () => {
    const source = readFileSync(new URL("./SavedListApp.tsx", import.meta.url), "utf8");
    const titleIndex = source.indexOf("<h2>{listing.title}</h2>");
    const badgeIndex = source.indexOf(
      "<ReactionScoreBadge reactions={actions?.reactions ?? []} />",
    );
    const addressIndex = source.indexOf("{listing.address}");
    const factStripIndex = source.indexOf('<section className="fact-strip"');

    expect(badgeIndex).toBeGreaterThan(titleIndex);
    expect(badgeIndex).toBeLessThan(addressIndex);
    expect(badgeIndex).toBeLessThan(factStripIndex);
  });

  it("renders group digest comments without duplicating the reaction score", () => {
    const actions = {
      reactions: [
        createGroupAction("reaction-1", "Ari", {
          actionType: "reaction",
          reaction: "thumbs-up",
        }),
      ],
      comments: [
        createGroupAction("comment-1", "Bo", {
          actionType: "comment",
          commentBody: "Ask whether the flex room has a window.",
        }),
      ],
      statusChanges: [],
      sourceLinkOpens: [],
      feedback: [],
    };
    const markup = renderToStaticMarkup(React.createElement(GroupActionSummary, { actions }));

    expect(markup).toContain("Comments");
    expect(markup).toContain("Bo");
    expect(markup).toContain("Ask whether the flex room has a window.");
    expect(markup).not.toContain('class="reaction-score-badge');
  });

  it("locks safe-area, focus-visible, touch-target, map, and viewport CSS for iPhone Safari checks", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const layoutSource = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");

    expect(layoutSource).toContain('viewportFit: "cover"');
    expect(layoutSource).toContain('width: "device-width"');
    expect(css).toMatch(/summary:focus-visible \{[\s\S]*outline:/);
    expect(css).toMatch(/textarea:focus-visible,[\s\S]*summary:focus-visible \{/);
    expect(css).toMatch(
      /\.map-heading,[\s\S]*\.map-review-grid \{[\s\S]*grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(
      /\.listing-table-head,[\s\S]*\.listing-row-button \{[\s\S]*grid-template-columns: minmax\(74px, max-content\) minmax\(0, 1fr\) minmax\(72px, max-content\);/,
    );
    expect(css).toContain("--line-dark: #514036;");
    expect(css).toContain("--line-light: #cdbfae;");
    expect(css).toMatch(/\.listing-card \{[\s\S]*gap: 0;/);
    expect(css).toMatch(/\.listing-group-label \{[\s\S]*border-top: 1px solid var\(--line\);/);
    expect(css).toMatch(
      /@media \(max-width: 860px\)[\s\S]*\.listing-row-button \{[\s\S]*grid-template-columns: minmax\(74px, max-content\) minmax\(0, 1fr\) minmax\(72px, max-content\);/,
    );
    expect(css).toMatch(/padding-right: max\(10px, env\(safe-area-inset-right\)\)/);
    expect(css).toMatch(/padding-left: max\(10px, env\(safe-area-inset-left\)\)/);
    expect(css).toMatch(/\.memory-source-link,[\s\S]*textarea \{[\s\S]*min-height: 52px;/);
    expect(css).toMatch(/\.reaction-score-badge \{[\s\S]*background: color-mix/);
    expect(css).toMatch(/\.reaction-score-badge strong \{[\s\S]*background: transparent;/);
    expect(css).toMatch(/\.reaction-score-badge\.positive \{[\s\S]*#18864b/);
    expect(css).toMatch(/\.reaction-score-badge\.negative \{[\s\S]*#ba2c2c/);
    expect(css).toMatch(/\.reaction-score-badge\.neutral \{[\s\S]*var\(--neutral-score\)/);
    expect(css).toMatch(/\.reaction-name-group \+ \.reaction-name-group \{/);
    expect(css).toMatch(
      /\.reaction-score-badge:is\(:hover, :focus-visible\) \.reaction-score-popover \{[\s\S]*opacity: 1;/,
    );
    expect(css).toMatch(
      /\.listing-card\.selected \.listing-row-button \{[\s\S]*box-shadow: inset 3px 0 0 var\(--accent\);/,
    );
    expect(css).toMatch(
      /\.fact-strip \{[\s\S]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(
      /\.listing-card\.selected \.listing-row-button:hover,[\s\S]*\.listing-card\.selected \.listing-row-button:focus-visible \{[\s\S]*background: color-mix\(in srgb, var\(--accent-soft\) 72%, var\(--panel\)\);/,
    );
    expect(css).not.toMatch(/[^-]hover:[\s\S]*display|display:\s*table|table-layout:/);
  });
});

function createGroupAction(
  id: string,
  actorDisplayName: string,
  action: Pick<GroupActionRecord, "actionType" | "commentBody" | "reaction" | "status">,
): GroupActionRecord {
  return {
    id,
    contract: "group-action-v1",
    groupId: defaultSearchGroup.id,
    listingId: fixtureListings[0]!.id,
    actorDisplayName,
    actorIdentityToken: `${actorDisplayName.toLowerCase()}-token`,
    actor: {
      displayName: actorDisplayName,
      identityToken: `${actorDisplayName.toLowerCase()}-token`,
    },
    actionType: action.actionType,
    commentBody: action.commentBody,
    reaction: action.reaction,
    status: action.status,
    sourceUrl: fixtureListings[0]!.url,
    provenance: { source: "user-entered", visibleToGroup: true },
    createdAt: "2026-06-07T00:00:00.000Z",
  };
}

function renderListingEditorMarkup(listing: ListingCandidate): string {
  return renderToStaticMarkup(
    React.createElement(ListingEditor, {
      listing,
      commentText: "",
      onCommentTextChange: () => undefined,
      onFieldChange: () => undefined,
      onStatusChange: () => undefined,
      onReviewDecision: () => undefined,
      onSourceOpen: () => undefined,
      onReaction: () => undefined,
      onComment: (event) => event.preventDefault(),
    }),
  );
}

describe("saved-list persisted data compatibility", () => {
  it("renders older localStorage listings that do not have provider routing metadata", () => {
    const staleListing = { ...fixtureListings[0] } as Record<string, unknown>;
    delete staleListing.providerRouting;
    const storage = new Map<string, string>([
      [
        savedListingsStorageKey,
        JSON.stringify({
          version: "v1",
          groupId: defaultSearchGroup.id,
          listings: [staleListing],
          updatedAt: "2026-06-07T00:00:00.000Z",
        }),
      ],
    ]);
    const originalLocalStorage = globalThis.localStorage;

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });

    try {
      expect(() => renderToStaticMarkup(React.createElement(SavedListApp))).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalLocalStorage,
      });
    }
  });
});

function renderRunHistoryMarkup(): string {
  return renderToStaticMarkup(
    React.createElement(RunHistoryPanel, { history: createHistoryWithCadenceVariants() }),
  );
}

function createHistoryWithCadenceVariants(): BriefingRunHistoryContract {
  const latest = g3cBriefingRunHistoryFixture.latestRun;
  const manual = createRunVariant(latest, {
    runId: "agent-run-log-manual-fixture",
    cadence: "manual",
    trigger: "manual",
    status: "success",
    startedAt: "2026-06-06T14:00:00.000Z",
    completedAt: "2026-06-06T14:02:00.000Z",
    label: "manual",
    candidateCount: 1,
    sourceFailures: 0,
  });
  const hourly = createRunVariant(latest, {
    runId: "agent-run-log-hourly-fixture",
    cadence: "hourly",
    trigger: "fixture",
    status: "running",
    startedAt: "2026-06-07T13:00:00.000Z",
    completedAt: undefined,
    label: "hourly",
    candidateCount: 0,
    sourceFailures: 0,
  });

  return {
    ...g3cBriefingRunHistoryFixture,
    supportedCadences: ["manual", "daily", "hourly"],
    latestRun: latest,
    runs: [manual, latest, hourly],
  };
}

function createRunVariant(
  base: BriefingRunHistoryRun,
  options: {
    runId: string;
    cadence: BriefingRunHistoryRun["cadence"];
    trigger: BriefingRunHistoryRun["trigger"];
    status: BriefingRunHistoryRun["status"];
    startedAt: string;
    completedAt?: string;
    label: string;
    candidateCount: number;
    sourceFailures: number;
  },
): BriefingRunHistoryRun {
  const candidateSummaries = base.candidateSummaries.slice(0, options.candidateCount);
  const sourceCoverage =
    options.sourceFailures > 0
      ? base.sourceCoverage
      : [
          {
            ...base.sourceCoverage[0]!,
            checkedCount: Math.max(1, options.candidateCount),
            candidateCount: options.candidateCount,
            rawArtifactPointers: base.rawArtifactPointers.slice(0, 1),
          },
        ];

  return {
    ...base,
    runId: options.runId,
    cadence: options.cadence,
    trigger: options.trigger,
    status: options.status,
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    counts: {
      candidatesFound: options.candidateCount,
      candidatesSkippedSeen: 0,
      candidatesSkippedTriaged: 0,
      candidatesTriaged: candidateSummaries.length,
      confirmedMatches: candidateSummaries.filter(
        (candidate) => candidate.bucket === "confirmed-match",
      ).length,
      reviewNeeded: candidateSummaries.filter((candidate) => candidate.bucket === "review-needed")
        .length,
      rejected: candidateSummaries.filter((candidate) => candidate.bucket === "rejected").length,
      sourceFailures: options.sourceFailures,
    },
    candidateSummaries,
    sourceCoverage,
    providerMetadata: base.providerMetadata.map((metadata) => ({
      ...metadata,
      attemptId: `${metadata.attemptId}-${options.label}`,
      status: options.status === "running" ? "pending" : metadata.status,
      startedAt: options.startedAt,
      completedAt: options.completedAt,
    })),
    rawArtifactPointers: base.rawArtifactPointers.slice(0, options.candidateCount > 0 ? 1 : 0),
  };
}
