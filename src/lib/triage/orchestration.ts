import { AI_TRIAGE_SCHEMA_VERSION } from "./rubric";
import { normalizeEvidence, normalizeOwnership, uniqueStrings } from "./evidence";
import { buildConfidence, evaluateDeterministicHardConstraints } from "./rules";
import type { TriageCandidateInput, TriageResult } from "./types";

export function assignFitEvidenceTriage(candidate: TriageCandidateInput): TriageResult {
  const ownership = normalizeOwnership(candidate);
  const evidence = normalizeEvidence(candidate);
  const checks = evaluateDeterministicHardConstraints(candidate, evidence);
  const rejectionReasons = checks
    .filter((check) => check.status === "fail")
    .map((check) => check.reason);
  const downgradeReasons = checks
    .filter((check) => check.status === "unknown" || check.status === "review-needed")
    .map((check) => check.reason);
  const reasons = checks.filter((check) => check.status === "pass").map((check) => check.reason);
  const reviewNeeded = downgradeReasons.length > 0 || Boolean(candidate.manualReviewRequired);
  const bucket =
    rejectionReasons.length > 0 ? "rejected" : reviewNeeded ? "review-needed" : "confirmed-match";
  const concerns = uniqueStrings([
    ...(candidate.concerns ?? []),
    ...downgradeReasons,
    ...rejectionReasons,
    ...(candidate.manualReviewRequired
      ? ["Manual/provider review is required before confirmation."]
      : []),
  ]);

  return {
    schemaVersion: AI_TRIAGE_SCHEMA_VERSION,
    bucket,
    status: bucket === "review-needed" ? "partial" : "success",
    ownership,
    confidence: buildConfidence(checks, bucket),
    evidence,
    deterministicHardConstraints: checks,
    reasons: uniqueStrings(reasons),
    concerns,
    downgradeReasons: uniqueStrings(downgradeReasons),
    rejectionReasons: uniqueStrings(rejectionReasons),
    suggestedAction: suggestedAction(bucket, candidate.userQualified),
    shouldPersist: true,
  };
}

function suggestedAction(bucket: TriageResult["bucket"], userQualified: boolean): string {
  if (bucket === "confirmed-match") {
    return "Share as a confirmed match candidate with preserved evidence.";
  }
  if (bucket === "rejected") {
    return userQualified
      ? "Keep saved for rejection history because a user pasted or qualified this listing."
      : "Keep rejection history and avoid repeated manual review.";
  }

  return "Send to manual roommate/operator review before confirmation.";
}
