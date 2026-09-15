// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureListings } from "../../lib/fixtures";
import { createMapReviewModel } from "../../lib/map-review";
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
});
