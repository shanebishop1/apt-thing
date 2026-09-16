"use client";

import { useEffect, useMemo, useState } from "react";
import { createMapReviewModel } from "@/lib/map-review";
import type { ReviewStatus } from "@/lib/listings";
import { InviteIdentityForm } from "./saved-list/InviteIdentityForm";
import { SavedListWorkspace, type AppTab, type ThemeMode } from "./saved-list/SavedListWorkspace";
import { useSavedListings } from "./saved-list/useSavedListings";
import type { ListingListGroup } from "./saved-list/ListingSection";

const themeStorageKey = "apt-thing-theme";
const listingStatusSortOrder: Record<ReviewStatus, number> = {
  review: 0,
  touring: 1,
  new: 2,
  interested: 3,
  unavailable: 4,
  gone: 5,
  rejected: 6,
};

export function SavedListApp() {
  const controller = useSavedListings();
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [isDetailOverlayOpen, setIsDetailOverlayOpen] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const selectedListing = controller.selectedListing;

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(themeStorageKey);
      if (savedTheme === "light" || savedTheme === "dark") setThemeMode(savedTheme);
    } catch {
      controller.onThemeStorageError();
    } finally {
      setHasHydrated(true);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `controller` is rebuilt every render; this effect must run once on mount and only calls it as an error sink
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    document.documentElement.dataset.theme = themeMode;
    try {
      window.localStorage.setItem(themeStorageKey, themeMode);
    } catch {
      controller.onThemeStorageError();
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `controller` is rebuilt every render; this effect must re-run on theme changes only and only calls it as an error sink
  }, [hasHydrated, themeMode]);

  useEffect(() => {
    if (!selectedListing) setIsDetailOverlayOpen(false);
  }, [selectedListing]);

  useEffect(() => {
    if (!isDetailOverlayOpen) return;

    function handleDetailOverlayKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDetailOverlayOpen(false);
      }
    }

    window.addEventListener("keydown", handleDetailOverlayKeyDown);
    return () => window.removeEventListener("keydown", handleDetailOverlayKeyDown);
  }, [isDetailOverlayOpen]);

  const mapReview = useMemo(
    () => createMapReviewModel(controller.listings, controller.selectedId),
    [controller.listings, controller.selectedId],
  );
  const listingGroups: ListingListGroup[] = useMemo(
    () => [
      {
        id: "all",
        label: "All listings",
        listings: controller.listings
          .map((listing, index) => ({ listing, index }))
          .sort(
            (left, right) =>
              listingStatusSortOrder[left.listing.reviewStatus] -
                listingStatusSortOrder[right.listing.reviewStatus] || left.index - right.index,
          )
          .map(({ listing }) => listing),
      },
    ],
    [controller.listings],
  );

  if (!controller.identity) {
    return (
      <main className="dashboard-shell" data-theme={themeMode}>
        <InviteIdentityForm
          mode="gate"
          identityForm={controller.identityForm}
          message={controller.message}
          onChange={controller.onIdentityChange}
          onSubmit={controller.onIdentitySubmit}
        />
      </main>
    );
  }

  function handleListingSelect(listingId: string) {
    controller.onListingSelect(listingId);
    setIsDetailOverlayOpen(true);
  }

  return (
    <main className="dashboard-shell" data-theme={themeMode}>
      <SavedListWorkspace
        controller={controller}
        activeTab={activeTab}
        themeMode={themeMode}
        isDetailOverlayOpen={isDetailOverlayOpen}
        listingGroups={listingGroups}
        mapReview={mapReview}
        onTabChange={setActiveTab}
        onSelectListing={handleListingSelect}
        onThemeToggle={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
        onCloseDetail={() => setIsDetailOverlayOpen(false)}
      />
    </main>
  );
}
