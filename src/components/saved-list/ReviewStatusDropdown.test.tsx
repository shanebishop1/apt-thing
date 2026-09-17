import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureListings } from "@/lib/fixtures";
import { ReviewStatusDropdown } from "./ReviewStatusDropdown";

afterEach(cleanup);

describe("ReviewStatusDropdown", () => {
  it("reports a new status once and stays quiet when the current status is re-picked", async () => {
    const user = userEvent.setup();
    const listing = { ...fixtureListings[0]!, id: "status-listing", reviewStatus: "new" as const };
    const onStatusChange = vi.fn();

    const { rerender } = render(
      <ReviewStatusDropdown listing={listing} onStatusChange={onStatusChange} />,
    );
    const select = () =>
      screen.getByRole("combobox", {
        name: `Change review status for ${listing.title}`,
      }) as HTMLSelectElement;

    expect(select().value).toBe("new");
    await user.selectOptions(select(), "interested");
    expect(onStatusChange).toHaveBeenCalledWith(listing.id, "interested");

    const interestedListing = { ...listing, reviewStatus: "interested" as const };
    rerender(<ReviewStatusDropdown listing={interestedListing} onStatusChange={onStatusChange} />);
    await user.selectOptions(select(), "interested");
    expect(onStatusChange).toHaveBeenCalledTimes(1);
  });

  it("locks the control while review is pending and never offers review as a choice", () => {
    const listing = {
      ...fixtureListings[0]!,
      id: "pending-listing",
      reviewStatus: "review" as const,
    };

    render(<ReviewStatusDropdown listing={listing} disabled onStatusChange={vi.fn()} />);
    const select = screen.getByRole("combobox", {
      name: `Change review status for ${listing.title}`,
    }) as HTMLSelectElement;

    expect(select.disabled).toBe(true);
    expect(select.value).toBe("review");
    expect(screen.getByRole("option", { name: "review" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("option", { name: "interested" })).toHaveProperty("disabled", false);
  });
});
