import { withDefined } from "../utils/records";
import { SEARCH_CONFIG } from "../search-config";

import { FIT_EVIDENCE_RUBRIC, PUBLIC_MANUAL_SOURCES } from "./rubric";
import { firstEvidence, normalizeEvidence, normalizeText } from "./evidence";
import type {
  DeterministicHardConstraintResult,
  TriageCandidateInput,
  TriageConfidence,
  TriageEvidence,
  TriageFactor,
  TriageResult,
} from "./types";

const preferredManhattanNeighborhoods = new Set(
  FIT_EVIDENCE_RUBRIC.preferredManhattanNeighborhoods.map((neighborhood) =>
    normalizeText(neighborhood),
  ),
);
const exceptionalFallbackBoroughs = new Set(
  FIT_EVIDENCE_RUBRIC.exceptionalFallbackBoroughs.map((borough) => normalizeText(borough)),
);

export function evaluateDeterministicHardConstraints(
  candidate: TriageCandidateInput,
  evidence = normalizeEvidence(candidate),
): DeterministicHardConstraintResult[] {
  return [
    evaluateBedrooms(candidate, evidence),
    evaluateBathrooms(candidate, evidence),
    evaluateRent(candidate, evidence),
    evaluateWholeApartment(candidate, evidence),
    evaluateNycRental(candidate, evidence),
    evaluateMoveIn(candidate, evidence),
    evaluateAvailability(candidate, evidence),
    evaluateSourceIntegrity(candidate, evidence),
    evaluateLocation(candidate, evidence),
  ];
}

function evaluateBedrooms(
  candidate: TriageCandidateInput,
  evidence: TriageEvidence[],
): DeterministicHardConstraintResult {
  const relatedEvidence = firstEvidence(evidence, "bedrooms");
  const flexConfidence = candidate.realFiveBedroomConfidence ?? 0;

  if (typeof candidate.bedrooms !== "number") {
    return reviewCheck(
      "bedrooms",
      `Missing bedroom count; cannot confirm ${SEARCH_CONFIG.minBedrooms}BR fit.`,
      0.2,
      relatedEvidence,
      true,
    );
  }
  if (candidate.bedrooms >= FIT_EVIDENCE_RUBRIC.hardConstraints.bedroom.minimum) {
    return passCheck(
      "bedrooms",
      `Bedroom evidence supports a credible ${SEARCH_CONFIG.minBedrooms}BR layout.`,
      0.95,
      relatedEvidence,
    );
  }
  if (
    (candidate.layoutType === "flex" || candidate.layoutType === "convertible") &&
    flexConfidence >= FIT_EVIDENCE_RUBRIC.hardConstraints.bedroom.flexHighConfidenceThreshold
  ) {
    return passCheck(
      "bedrooms",
      `High-confidence flex evidence supports a credible ${SEARCH_CONFIG.minBedrooms}BR layout.`,
      flexConfidence,
      relatedEvidence,
    );
  }
  if (candidate.layoutType === "flex" || candidate.layoutType === "convertible") {
    return reviewCheck(
      "bedrooms",
      `Flex/convertible layout lacks high-confidence real-${SEARCH_CONFIG.minBedrooms}BR evidence.`,
      Math.max(0.35, flexConfidence),
      relatedEvidence,
      true,
    );
  }

  return failCheck(
    "bedrooms",
    `Bedroom count is below the ${SEARCH_CONFIG.minBedrooms}BR hard constraint.`,
    0.2,
    relatedEvidence,
  );
}

function evaluateBathrooms(
  candidate: TriageCandidateInput,
  evidence: TriageEvidence[],
): DeterministicHardConstraintResult {
  const relatedEvidence = firstEvidence(evidence, "bathrooms");

  if (typeof candidate.bathrooms !== "number") {
    return reviewCheck(
      "bathrooms",
      `Missing bathroom count; cannot confirm ${SEARCH_CONFIG.minBathrooms}+ baths.`,
      0.25,
      relatedEvidence,
      true,
    );
  }
  if (candidate.bathrooms >= FIT_EVIDENCE_RUBRIC.hardConstraints.bathrooms.minimum) {
    return passCheck(
      "bathrooms",
      `Bathroom evidence supports ${SEARCH_CONFIG.minBathrooms}+ bathrooms.`,
      0.95,
      relatedEvidence,
    );
  }

  return failCheck(
    "bathrooms",
    `Bathroom count is below the ${SEARCH_CONFIG.minBathrooms} bath hard constraint.`,
    0.2,
    relatedEvidence,
  );
}

function evaluateRent(
  candidate: TriageCandidateInput,
  evidence: TriageEvidence[],
): DeterministicHardConstraintResult {
  const relatedEvidence = firstEvidence(evidence, "rent");

  if (typeof candidate.rent !== "number") {
    return reviewCheck(
      "rent",
      "Missing rent; cannot confirm price fit.",
      0.25,
      relatedEvidence,
      true,
    );
  }
  if (candidate.rent <= FIT_EVIDENCE_RUBRIC.hardConstraints.maxRent) {
    return passCheck(
      "rent",
      `Rent is at or below the $${SEARCH_CONFIG.maxRent.toLocaleString("en-US")} hard ceiling.`,
      0.98,
      relatedEvidence,
    );
  }

  return failCheck(
    "rent",
    `Rent is above the $${SEARCH_CONFIG.maxRent.toLocaleString("en-US")} hard ceiling.`,
    0.1,
    relatedEvidence,
  );
}

function evaluateWholeApartment(
  candidate: TriageCandidateInput,
  evidence: TriageEvidence[],
): DeterministicHardConstraintResult {
  const relatedEvidence = firstEvidence(evidence, "wholeApartment");
  const text = normalizeText(`${candidate.title ?? ""} ${candidate.description ?? ""}`);

  if (
    candidate.occupancyType === "room-share" ||
    candidate.occupancyType === "individual-room" ||
    /\b(room share|room for rent|individual room)\b/.test(text)
  ) {
    return failCheck(
      "wholeApartment",
      "Listing appears to be a room share or individual room, not a whole-apartment rental.",
      0.1,
      relatedEvidence,
    );
  }
  if (candidate.wholeApartment === false) {
    return failCheck(
      "wholeApartment",
      "Listing is not a whole-apartment rental.",
      0.1,
      relatedEvidence,
    );
  }
  if (
    candidate.wholeApartment === true ||
    candidate.occupancyType === "whole-apartment" ||
    text.includes("whole apartment") ||
    text.includes("full-floor") ||
    text.includes("entire apartment")
  ) {
    return passCheck(
      "wholeApartment",
      "Evidence supports a whole-apartment rental.",
      0.9,
      relatedEvidence,
    );
  }

  return reviewCheck(
    "wholeApartment",
    "Whole-apartment status is ambiguous and needs review.",
    0.45,
    relatedEvidence,
    true,
  );
}

function evaluateNycRental(
  candidate: TriageCandidateInput,
  evidence: TriageEvidence[],
): DeterministicHardConstraintResult {
  const relatedEvidence = firstEvidence(evidence, "nycRental");
  const borough = normalizeText(candidate.borough ?? "");
  const address = normalizeText(candidate.address ?? "");
  const boroughs = new Set(["manhattan", "brooklyn", "queens", "bronx", "staten island"]);

  if (boroughs.has(borough) || address.includes("new york") || address.includes("ny")) {
    return passCheck("nycRental", "Location evidence supports a NYC rental.", 0.9, relatedEvidence);
  }

  return reviewCheck(
    "nycRental",
    "NYC borough/address evidence is missing or ambiguous.",
    0.45,
    relatedEvidence,
    true,
  );
}

function evaluateMoveIn(
  candidate: TriageCandidateInput,
  evidence: TriageEvidence[],
): DeterministicHardConstraintResult {
  const relatedEvidence = firstEvidence(evidence, "moveIn");
  const normalizedMonth = candidate.availableAt?.slice(0, 7);

  if (!candidate.availableAt) {
    return reviewCheck(
      "moveIn",
      `Move-in date is missing; ${SEARCH_CONFIG.moveIn.target} target cannot be confirmed.`,
      0.35,
      relatedEvidence,
      true,
    );
  }
  if (
    FIT_EVIDENCE_RUBRIC.hardConstraints.moveIn.acceptableMonths.some(
      (month) => month === normalizedMonth,
    )
  ) {
    return passCheck(
      "moveIn",
      `Move-in date is inside the ${SEARCH_CONFIG.moveIn.acceptableMonths.join(", ")} window (target ${SEARCH_CONFIG.moveIn.target}).`,
      0.9,
      relatedEvidence,
    );
  }

  return reviewCheck(
    "moveIn",
    `Move-in date is outside the ${SEARCH_CONFIG.moveIn.acceptableMonths.join(", ")} acceptable window.`,
    0.35,
    relatedEvidence,
    true,
  );
}

function evaluateAvailability(
  candidate: TriageCandidateInput,
  evidence: TriageEvidence[],
): DeterministicHardConstraintResult {
  const relatedEvidence = firstEvidence(evidence, "availability");
  const status = normalizeText(candidate.listingStatus ?? "active");

  if (status.includes("off-market") || status.includes("unavailable")) {
    return failCheck(
      "availability",
      "Listing is off-market or unavailable.",
      0.05,
      relatedEvidence,
    );
  }
  if (status.includes("pending")) {
    return reviewCheck(
      "availability",
      "Listing availability is pending and needs review.",
      0.45,
      relatedEvidence,
      true,
    );
  }

  return passCheck(
    "availability",
    "Listing availability does not show off-market/unavailable status.",
    0.85,
    relatedEvidence,
  );
}

function evaluateSourceIntegrity(
  candidate: TriageCandidateInput,
  evidence: TriageEvidence[],
): DeterministicHardConstraintResult {
  const relatedEvidence = firstEvidence(evidence, "sourceIntegrity");
  const text = normalizeText(`${candidate.title ?? ""} ${candidate.description ?? ""}`);

  if (candidate.scamSignal === "confirmed") {
    return failCheck("sourceIntegrity", "Confirmed scam signal present.", 0.05, relatedEvidence);
  }
  if (
    candidate.stayType === "short-term" ||
    text.includes("short-term") ||
    text.includes("nightly") ||
    text.includes("weekly")
  ) {
    return failCheck(
      "sourceIntegrity",
      "Listing is short-term-only rather than a standard rental.",
      0.1,
      relatedEvidence,
    );
  }
  if (candidate.scamSignal === "suspected") {
    return reviewCheck(
      "sourceIntegrity",
      "Suspected scam signal requires manual review.",
      0.3,
      relatedEvidence,
      true,
    );
  }
  if (candidate.manualReviewRequired || PUBLIC_MANUAL_SOURCES.has(candidate.source)) {
    return reviewCheck(
      "sourceIntegrity",
      `${candidate.sourceName ?? candidate.source} source/provider proof is pending and requires review.`,
      0.55,
      relatedEvidence,
      true,
    );
  }

  return passCheck(
    "sourceIntegrity",
    "Source integrity checks do not show scam or unsupported-source blockers.",
    0.85,
    relatedEvidence,
  );
}

function evaluateLocation(
  candidate: TriageCandidateInput,
  evidence: TriageEvidence[],
): DeterministicHardConstraintResult {
  const relatedEvidence = firstEvidence(evidence, "location");
  const neighborhood = normalizeText(candidate.neighborhood ?? "");
  const borough = normalizeText(candidate.borough ?? "");

  if (borough === "manhattan" && preferredManhattanNeighborhoods.has(neighborhood)) {
    return passCheck(
      "location",
      "Preferred Manhattan neighborhood evidence supports top fit.",
      0.95,
      relatedEvidence,
    );
  }
  if (borough === "manhattan") {
    return reviewCheck(
      "location",
      "Manhattan listing is outside the preferred neighborhood list.",
      0.65,
      relatedEvidence,
      true,
    );
  }
  if (exceptionalFallbackBoroughs.has(borough)) {
    return reviewCheck(
      "location",
      candidate.exceptionalFallbackEvidence
        ? `${candidate.borough} exceptional fallback can be considered below preferred Manhattan matches.`
        : `${candidate.borough} fallback needs exceptional-fit review before confirmation.`,
      candidate.exceptionalFallbackEvidence ? 0.7 : 0.55,
      relatedEvidence,
      true,
    );
  }

  return reviewCheck(
    "location",
    `Location is outside preferred Manhattan and exceptional ${SEARCH_CONFIG.exceptionalFallback.boroughs.join("/")} fallback handling.`,
    0.4,
    relatedEvidence,
    true,
  );
}

function passCheck(
  factor: TriageFactor,
  reason: string,
  confidence: number,
  evidence?: TriageEvidence,
): DeterministicHardConstraintResult {
  return withDefined<DeterministicHardConstraintResult>({
    factor,
    status: "pass",
    confidence,
    reason,
    evidence,
  });
}

function failCheck(
  factor: TriageFactor,
  reason: string,
  confidence: number,
  evidence?: TriageEvidence,
): DeterministicHardConstraintResult {
  return withDefined<DeterministicHardConstraintResult>({
    factor,
    status: "fail",
    confidence,
    reason,
    evidence,
  });
}

function reviewCheck(
  factor: TriageFactor,
  reason: string,
  confidence: number,
  evidence?: TriageEvidence,
  reviewOnly = false,
): DeterministicHardConstraintResult {
  return withDefined<DeterministicHardConstraintResult>({
    factor,
    status: reviewOnly ? "review-needed" : "unknown",
    confidence,
    reason,
    reviewOnly,
    evidence,
  });
}

export function buildConfidence(
  checks: DeterministicHardConstraintResult[],
  bucket: TriageResult["bucket"],
): TriageConfidence {
  const factors = Object.fromEntries(
    checks.map((check) => [check.factor, check.confidence]),
  ) as Record<TriageFactor, number>;
  const hardAverage = checks.reduce((sum, check) => sum + check.confidence, 0) / checks.length;
  const overall =
    bucket === "confirmed-match"
      ? Math.max(0.8, hardAverage)
      : bucket === "review-needed"
        ? Math.min(0.79, Math.max(0.45, hardAverage))
        : Math.min(0.35, hardAverage);

  return {
    realFiveBedroom: factors.bedrooms,
    twoPlusBathrooms: factors.bathrooms,
    priceFit: factors.rent,
    locationFit: factors.location,
    overall: Number(overall.toFixed(2)),
    factors,
  };
}
