// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtureListings } from "../../lib/fixtures";
import { ReviewStatusDropdown } from "./ReviewStatusDropdown";

describe("ReviewStatusDropdown", () => {
  it("uses keyboard selection for an available status and locks pending review", async () => {
    const user = userEvent.setup();
    const listing = { ...fixtureListings[0]!, id: "status-listing", reviewStatus: "new" as const };
    const onStatusChange = vi.fn();

    const { rerender } = render(
      <ReviewStatusDropdown listing={listing} onStatusChange={onStatusChange} />,
    );
    const trigger = screen.getByRole("button", {
      name: `Change review status for ${listing.title}`,
    });
    await user.click(trigger);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onStatusChange).toHaveBeenCalledWith(listing.id, "interested");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    const pendingListing = { ...listing, reviewStatus: "review" as const };
    rerender(
      <ReviewStatusDropdown listing={pendingListing} disabled onStatusChange={onStatusChange} />,
    );
    expect(
      screen.getByRole("button", {
        name: `Change review status for ${pendingListing.title}`,
      }),
    ).toHaveProperty("disabled", true);
  });
});
