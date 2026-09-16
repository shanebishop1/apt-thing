import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListingGroupActions } from "@/lib/group-actions";
import { createGroupIdentity, defaultSearchGroup } from "@/lib/listings";
import { fixtureListings } from "@/lib/fixtures";
import { ListingEditor } from "./ListingEditor";

vi.mock("leaflet", () => {
  const chain = () => ({
    addTo() {
      return this;
    },
    bindPopup() {
      return this;
    },
    on() {
      return this;
    },
    remove() {},
  });

  return {
    circleMarker: chain,
    divIcon: () => ({}),
    geoJSON: chain,
    layerGroup: chain,
    map: () => ({ fitBounds() {}, invalidateSize() {}, remove() {} }),
    marker: chain,
    tileLayer: chain,
  };
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ type: "FeatureCollection", features: [] }),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ListingEditor", () => {
  it("wires review decisions, reactions, and comments while locking pending status", async () => {
    const user = userEvent.setup();
    const listing = {
      ...fixtureListings[0]!,
      id: "editor-listing",
      title: "Editor callback apartment",
      groupId: defaultSearchGroup.id,
      photos: [],
      triageBucket: "review-needed" as const,
      reviewStatus: "review" as const,
      display: {
        ...fixtureListings[0]!.display,
        title: "Editor callback apartment",
        triageBucket: "review-needed" as const,
        reviewStatus: "review" as const,
      },
    };
    const identity = createGroupIdentity(defaultSearchGroup.id, "Ari")!;
    const actions: ListingGroupActions = {
      comments: [],
      reactions: [],
      statusChanges: [],
      sourceLinkOpens: [],
      feedback: [],
    };
    const onReviewDecision = vi.fn();
    const onReaction = vi.fn();
    const onCommentTextChange = vi.fn();
    const onComment = vi.fn();
    const onFieldChange = vi.fn();

    render(
      <ListingEditor
        identity={identity}
        listing={listing}
        actions={actions}
        commentText="Ask about windows"
        onCommentTextChange={onCommentTextChange}
        onFieldChange={onFieldChange}
        onStatusChange={vi.fn()}
        onReviewDecision={onReviewDecision}
        onSourceOpen={vi.fn()}
        onReaction={onReaction}
        onComment={onComment}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: `Change review status for ${listing.title}` }),
    ).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: `Edit fields for ${listing.title}` }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "rent" }), {
      target: { value: "16000" },
    });
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Reject and remove" }));
    await user.click(screen.getByRole("button", { name: `React thumbs up to ${listing.title}` }));

    await user.click(screen.getByText("Add comment"));
    const commentInput = screen.getByRole("textbox", { name: `Comment on ${listing.title}` });
    fireEvent.submit(commentInput.closest("form") as HTMLFormElement);

    expect(onReviewDecision.mock.calls).toEqual([
      [listing.id, "approve"],
      [listing.id, "reject"],
    ]);
    expect(onReaction).toHaveBeenCalledWith(listing, "thumbs-up");
    expect(onComment).toHaveBeenCalledTimes(1);
    expect(onFieldChange).toHaveBeenCalledWith(listing.id, "rent", "16000");
  });
});
