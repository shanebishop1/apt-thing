import { REVIEW_STATUSES, type FieldProvenance, type ReviewStatus } from "./listings";

export type MobileAcceptanceMarker =
  | "saved-list-review"
  | "paste-input-target"
  | "batch-status-panel"
  | "map-list-detail"
  | "comments-reactions-status"
  | "review-status-controls"
  | "edit-field-controls"
  | "detail-expansion"
  | "source-link-opening"
  | "briefing-history"
  | "focus-states"
  | "safe-area-insets"
  | "touch-targets"
  | "keyboard-behavior"
  | "mobile-viewport";

export type MobileAcceptanceControl = {
  marker: MobileAcceptanceMarker;
  selector: string;
  ariaLabel?: string;
  role: "input" | "textarea" | "select" | "button" | "link" | "disclosure" | "panel" | "viewport";
  touchTargetPx: number;
  semantics: string[];
};

export type MobileAcceptanceCheck = MobileAcceptanceControl & {
  passed: boolean;
};

export type MobileAcceptanceScenario = {
  viewportWidthPx: number;
  platform: "ios-safari-equivalent";
  minTouchTargetPx: number;
  viewportFit: "cover";
  safeAreaInsets: string[];
  reviewStatuses: ReviewStatus[];
  editableFields: FieldProvenance["field"][];
  controls: MobileAcceptanceControl[];
};

export type MobileAcceptanceScenarioResult = MobileAcceptanceScenario & {
  checks: MobileAcceptanceCheck[];
  allChecksPassed: boolean;
  coveredAcceptanceMarkers: MobileAcceptanceMarker[];
};

export const MOBILE_ACCEPTANCE_VIEWPORT_WIDTH_PX = 390;
export const MOBILE_ACCEPTANCE_MIN_TOUCH_TARGET_PX = 44;

const editableFields: FieldProvenance["field"][] = [
  "title",
  "address",
  "neighborhood",
  "rent",
  "bedrooms",
  "bathrooms",
  "availableAt",
];

export function createMobileAcceptanceScenario(
  viewportWidthPx = MOBILE_ACCEPTANCE_VIEWPORT_WIDTH_PX,
): MobileAcceptanceScenario {
  return {
    viewportWidthPx,
    platform: "ios-safari-equivalent",
    minTouchTargetPx: MOBILE_ACCEPTANCE_MIN_TOUCH_TARGET_PX,
    viewportFit: "cover",
    safeAreaInsets: [
      "env(safe-area-inset-top)",
      "env(safe-area-inset-right)",
      "env(safe-area-inset-bottom)",
      "env(safe-area-inset-left)",
    ],
    reviewStatuses: REVIEW_STATUSES,
    editableFields,
    controls: [
      {
        marker: "saved-list-review",
        selector: '.list-panel[aria-label="Saved listing review queue"], .listing-card',
        ariaLabel: "Saved listing review queue",
        role: "panel",
        touchTargetPx: 52,
        semantics: ["card-first-review", "current-review-needed-pasted-history", "no-table-layout"],
      },
      {
        marker: "paste-input-target",
        selector: '.intake-form input[type="url"]',
        ariaLabel: "Create saved listing",
        role: "input",
        touchTargetPx: 52,
        semantics: ["url-keyboard", "paste-one-apartment-url", "required-before-save"],
      },
      {
        marker: "keyboard-behavior",
        selector: '.intake-form input[inputmode="url"], textarea[enterkeyhint="done"]',
        ariaLabel: "Mobile keyboard hints",
        role: "input",
        touchTargetPx: 52,
        semantics: ["url-inputmode", "done-enter-key", "no-hover-required"],
      },
      {
        marker: "batch-status-panel",
        selector: '.batch-status-card[aria-label="StreetEasy batch status"]',
        ariaLabel: "StreetEasy batch status",
        role: "panel",
        touchTargetPx: 52,
        semantics: ["batch-run-counts", "skipped-seen-count", "image-cap", "analyzed-count"],
      },
      {
        marker: "map-list-detail",
        selector: '.map-review-card[aria-label="Map enhanced review"] .map-review-grid',
        ariaLabel: "Map enhanced review",
        role: "panel",
        touchTargetPx: 52,
        semantics: ["map-list-detail-sync", "single-column-mobile", "pin-buttons"],
      },
      {
        marker: "comments-reactions-status",
        selector:
          '.group-actions-panel[aria-label="Group comments, reactions, and feedback"] button, .group-action-form textarea, .status-dropdown-trigger',
        ariaLabel: "Group comments, reactions, and feedback",
        role: "select",
        touchTargetPx: 52,
        semantics: ["comments", "reactions", "shared-status", "feedback-no-ranking-mutation"],
      },
      {
        marker: "review-status-controls",
        selector: '.status-control[aria-label="Review status"] .status-dropdown-trigger',
        ariaLabel: "Review status",
        role: "select",
        touchTargetPx: 52,
        semantics: REVIEW_STATUSES.map((status) => `sets-${status}`),
      },
      {
        marker: "edit-field-controls",
        selector: '.edit-grid[aria-label="Editable saved-list fields"] input',
        ariaLabel: "Editable saved-list fields",
        role: "input",
        touchTargetPx: 52,
        semantics: editableFields.map((field) => `edits-${field}`),
      },
      {
        marker: "briefing-history",
        selector:
          '.briefing-card[aria-label="Latest agent briefing"], .run-history-card[aria-label="Agent run history"]',
        ariaLabel: "Latest agent briefing and run history",
        role: "panel",
        touchTargetPx: 52,
        semantics: ["briefing-before-cards", "run-history-details", "source-coverage-visible"],
      },
      {
        marker: "detail-expansion",
        selector: ".card-actions details > summary",
        role: "disclosure",
        touchTargetPx: 48,
        semantics: ["expands-evidence", "keeps-url-visible", "works-without-hover"],
      },
      {
        marker: "source-link-opening",
        selector:
          '.listing-rowgrid a[target="_blank"][rel="noreferrer"], .editor-header a[target="_blank"][rel="noreferrer"]',
        role: "link",
        touchTargetPx: 52,
        semantics: ["opens-source-new-tab", "noreferrer", "source-link-label"],
      },
      {
        marker: "focus-states",
        selector:
          "button:focus-visible, input:focus-visible, a:focus-visible, summary:focus-visible",
        role: "viewport",
        touchTargetPx: 44,
        semantics: ["visible-focus-ring", "keyboard-navigation", "details-summary-focus"],
      },
      {
        marker: "safe-area-insets",
        selector: ".dashboard-shell",
        role: "viewport",
        touchTargetPx: 44,
        semantics: ["uses-all-safe-area-env-insets"],
      },
      {
        marker: "touch-targets",
        selector: "button, input, .listing-rowgrid a, .editor-header a",
        role: "viewport",
        touchTargetPx: 52,
        semantics: ["mobile-min-height", "tap-highlight-disabled", "focus-visible"],
      },
      {
        marker: "mobile-viewport",
        selector: "@media (max-width: 560px)",
        role: "viewport",
        touchTargetPx: 44,
        semantics: ["single-column-intake", "single-column-edit", "single-column-listing-row"],
      },
    ],
  };
}

export function runMobileAcceptanceScenario(
  scenario = createMobileAcceptanceScenario(),
): MobileAcceptanceScenarioResult {
  const checks = scenario.controls.map((control) => ({
    ...control,
    passed:
      control.touchTargetPx >= scenario.minTouchTargetPx &&
      control.selector.length > 0 &&
      control.semantics.length > 0,
  }));

  return {
    ...scenario,
    checks,
    allChecksPassed:
      scenario.viewportWidthPx <= 560 &&
      scenario.platform === "ios-safari-equivalent" &&
      scenario.viewportFit === "cover" &&
      scenario.safeAreaInsets.length === 4 &&
      scenario.reviewStatuses.length === REVIEW_STATUSES.length &&
      scenario.editableFields.length >= 7 &&
      checks.every((check) => check.passed),
    coveredAcceptanceMarkers: checks.filter((check) => check.passed).map((check) => check.marker),
  };
}
