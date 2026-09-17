import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureListings } from "@/lib/fixtures";
import { createMapReviewModel } from "@/lib/map-review";
import { MapReviewPanel } from "./MapReviewPanel";

afterEach(cleanup);

describe("MapReviewPanel", () => {
  it("selects a mapped listing from the synchronized candidate list", async () => {
    const user = userEvent.setup();
    const listing = fixtureListings.find((candidate) => candidate.title.includes("Williamsburg"))!;
    const model = createMapReviewModel([listing], listing.id);
    const onSelect = vi.fn();

    render(
      <MapReviewPanel
        model={model}
        selectedId={listing.id}
        commentText=""
        isDetailOverlayOpen={false}
        onSelect={onSelect}
        onCommentTextChange={vi.fn()}
        onFieldChange={vi.fn()}
        onStatusChange={vi.fn()}
        onReviewDecision={vi.fn()}
        onSourceOpen={vi.fn()}
        onReaction={vi.fn()}
        onComment={vi.fn()}
        onCloseDetail={vi.fn()}
      />,
    );

    await user.click(screen.getByText(listing.title, { selector: "strong" }));

    expect(onSelect).toHaveBeenCalledWith(listing.id);
  });

  it("shows the nearest two stations with routes and a walking-time hint", () => {
    const listing = {
      ...fixtureListings[0]!,
      id: "realtyapi-union-square",
      title: "Live listing near Union Square",
      address: "1 Irving Place",
      location: { latitude: 40.7347, longitude: -73.9905 },
    };
    const model = createMapReviewModel([listing], listing.id);

    renderPanel(model, listing.id);

    const detail = screen.getByLabelText("Selected map listing detail");
    const stations = [...detail.querySelectorAll("li")].map((item) => item.textContent ?? "");

    expect(stations).toHaveLength(2);
    expect(stations[0]).toContain("14 St-Union Sq");
    expect(stations[0]).toContain("4/5/6/L/N/Q/R/W");
    expect(stations[0]).toMatch(/~\d+ min walk/u);
  });

  it("explains that subway context needs coordinates", () => {
    const listing = {
      ...fixtureListings[0]!,
      id: "listing-without-coordinates",
      title: "Pasted listing without a geocode",
      address: "Address pending",
    };
    const model = createMapReviewModel([listing], listing.id);

    renderPanel(model, listing.id);

    expect(screen.getByText("No coordinates for this listing yet.")).toBeDefined();
  });
});

function renderPanel(model: ReturnType<typeof createMapReviewModel>, selectedId: string) {
  render(
    <MapReviewPanel
      model={model}
      selectedId={selectedId}
      commentText=""
      isDetailOverlayOpen={false}
      onSelect={vi.fn()}
      onCommentTextChange={vi.fn()}
      onFieldChange={vi.fn()}
      onStatusChange={vi.fn()}
      onReviewDecision={vi.fn()}
      onSourceOpen={vi.fn()}
      onReaction={vi.fn()}
      onComment={vi.fn()}
      onCloseDetail={vi.fn()}
    />,
  );
}
