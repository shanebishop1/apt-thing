import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fixtureListings } from "@/lib/fixtures";
import { ListingMedia } from "./ListingMedia";

describe("ListingMedia", () => {
  it("moves through media with arrows and closes the enlarged carousel with Escape", async () => {
    const user = userEvent.setup();
    const listing = {
      ...fixtureListings[0]!,
      id: "media-listing",
      title: "Carousel apartment",
      photos: ["https://example.com/one.jpg", "https://example.com/two.jpg"],
    };

    render(<ListingMedia listing={listing} />);
    const carousel = screen.getByRole("region", { name: `Media for ${listing.title}` });
    expect(screen.getByText("1 of 3")).toBeTruthy();

    carousel.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getByRole("img", { name: `${listing.title} photo 1` })).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: `Enlarge photo 1 of 2 for ${listing.title}` }),
    );
    expect(
      screen.getByRole("dialog", { name: `Enlarged photos for ${listing.title}` }),
    ).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: `Enlarged photos for ${listing.title}` }),
    ).toBeNull();
  });
});
