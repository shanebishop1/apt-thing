"use client";

import { Moon, Settings, Sun } from "lucide-react";
import type { MapReviewModel } from "../../lib/map-review";
import { ListingEditor } from "./ListingEditor";
import { ListingIntake } from "./ListingIntake";
import { ListingSection, type ListingListGroup } from "./ListingSection";
import { MapReviewPanel } from "./MapReviewPanel";
import { RunHistoryPanel } from "./RunHistoryPanel";
import { InviteIdentityForm } from "./InviteIdentityForm";
import { useRunHistory } from "./useRunHistory";
import type { useSavedListings } from "./useSavedListings";

type AppTab = "dashboard" | "map" | "history" | "settings";
type ThemeMode = "dark" | "light";
type SavedListingsController = ReturnType<typeof useSavedListings>;

const appTabs: Array<{ id: AppTab; label: string }> = [
  { id: "dashboard", label: "List" },
  { id: "map", label: "Map" },
  { id: "history", label: "Runs" },
];

type SavedListWorkspaceProps = {
  controller: SavedListingsController;
  activeTab: AppTab;
  themeMode: ThemeMode;
  isDetailOverlayOpen: boolean;
  listingGroups: ListingListGroup[];
  mapReview: MapReviewModel;
  onTabChange: (tab: AppTab) => void;
  onSelectListing: (listingId: string) => void;
  onThemeToggle: () => void;
  onCloseDetail: () => void;
};

export function SavedListWorkspace({
  controller,
  activeTab,
  themeMode,
  isDetailOverlayOpen,
  listingGroups,
  mapReview,
  onTabChange,
  onSelectListing,
  onThemeToggle,
  onCloseDetail,
}: SavedListWorkspaceProps) {
  const runHistory = useRunHistory(controller.identity, activeTab === "history");

  return (
    <>
      <nav className="app-tabs" aria-label="Apartment search workspace sections">
        {appTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "active" : undefined}
            onClick={() => onTabChange(tab.id)}
            aria-pressed={activeTab === tab.id}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className="theme-toggle"
          onClick={onThemeToggle}
          aria-pressed={themeMode === "dark"}
          aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
          title={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
        >
          <span aria-hidden="true">
            {themeMode === "dark" ? <Sun className="nav-icon" /> : <Moon className="nav-icon" />}
          </span>
        </button>
        <button
          type="button"
          className={`settings-toggle${activeTab === "settings" ? " active" : ""}`}
          onClick={() => onTabChange("settings")}
          aria-pressed={activeTab === "settings"}
          aria-label="Settings"
          title="Settings"
        >
          <span aria-hidden="true">
            <Settings className="nav-icon" />
          </span>
        </button>
      </nav>

      {activeTab === "dashboard" ? (
        <div className="workspace-grid">
          <section className="list-panel" aria-label="Saved listing review queue">
            <div className="panel-heading listing-panel-heading">
              <h2>Listings</h2>
              <ListingIntake
                identity={controller.identity}
                url={controller.url}
                message={controller.message}
                apiBusy={controller.apiBusy}
                onUrlChange={controller.setUrl}
                onSubmit={controller.onCreate}
              />
            </div>
            <ListingSection
              groups={listingGroups}
              selectedId={controller.selectedListing?.id}
              onSelect={onSelectListing}
              onSourceOpen={controller.onSourceOpen}
            />
          </section>
          <div
            className={
              isDetailOverlayOpen
                ? "listing-detail-shell mobile-detail-open"
                : "listing-detail-shell"
            }
          >
            <ListingEditor
              identity={controller.identity}
              listing={controller.selectedListing}
              actions={controller.selectedActions}
              commentText={controller.commentText}
              onCommentTextChange={controller.setCommentText}
              onFieldChange={controller.onFieldChange}
              onStatusChange={controller.onStatusChange}
              onReviewDecision={controller.onReviewDecision}
              onSourceOpen={controller.onSourceOpen}
              onReaction={controller.onReaction}
              onComment={controller.onComment}
              onClose={onCloseDetail}
            />
          </div>
        </div>
      ) : null}

      {activeTab === "map" ? (
        <MapReviewPanel
          identity={controller.identity}
          model={mapReview}
          selectedId={controller.selectedListing?.id}
          actions={controller.selectedActions}
          commentText={controller.commentText}
          isDetailOverlayOpen={isDetailOverlayOpen}
          onSelect={onSelectListing}
          onCommentTextChange={controller.setCommentText}
          onFieldChange={controller.onFieldChange}
          onStatusChange={controller.onStatusChange}
          onReviewDecision={controller.onReviewDecision}
          onSourceOpen={controller.onSourceOpen}
          onReaction={controller.onReaction}
          onComment={controller.onComment}
          onCloseDetail={onCloseDetail}
        />
      ) : null}

      {activeTab === "history" ? (
        <RunHistoryPanel state={runHistory.state} onRefresh={runHistory.refresh} />
      ) : null}

      {activeTab === "settings" ? (
        <InviteIdentityForm
          mode="settings"
          identityForm={controller.identityForm}
          identity={controller.identity}
          message={controller.message}
          onChange={controller.onIdentityChange}
          onSubmit={controller.onIdentitySubmit}
        />
      ) : null}
    </>
  );
}

export type { AppTab, ThemeMode };
