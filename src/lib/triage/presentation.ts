import { AI_TRIAGE_SCHEMA_VERSION } from "./rubric";
import { uniqueStrings } from "./evidence";
import { isBucket, isConfidenceNumber } from "./schema";
import type { SourceEvidenceDisplayContract, TriageResult } from "./types";

export function createSourceEvidenceDisplayContract(
  triage: TriageResult,
): SourceEvidenceDisplayContract {
  assertTriageInvariants(triage);

  return {
    schemaVersion: AI_TRIAGE_SCHEMA_VERSION,
    consumers: ["saved-list", "map-detail", "group-review", "briefing"],
    fields: {
      bucket: triage.bucket,
      suggestedAction: triage.suggestedAction,
      whyItFits: triage.reasons,
      concerns: triage.concerns,
      confidence: triage.confidence,
      sourceLinks: uniqueStrings(triage.evidence.map((item) => item.sourceUrl)),
      evidenceQuotes: triage.evidence.map((item) => item.quote),
      artifactPointers: triage.evidence.flatMap((item) => item.artifactPointer ?? []),
      downgradeHistory: triage.downgradeReasons,
      rejectionHistory: triage.rejectionReasons,
      ownership: triage.ownership,
    },
  };
}

export function assertTriageInvariants(triage: TriageResult): void {
  if (
    !triage.ownership.groupId ||
    !triage.ownership.runId ||
    !triage.ownership.listingId ||
    !triage.ownership.sourceUrl
  ) {
    throw new Error("Triage ownership must include groupId, runId, listingId, and sourceUrl.");
  }
  if (!isBucket(triage.bucket) || triage.bucket === "untriaged") {
    throw new Error("Bucketed candidates must have a valid triage bucket.");
  }
  if (
    !isConfidenceNumber(triage.confidence.overall) ||
    Object.keys(triage.confidence.factors).length === 0
  ) {
    throw new Error("Bucketed candidates must include overall and per-factor confidence.");
  }
  if (
    triage.evidence.length === 0 ||
    triage.evidence.some((item) => !item.quote.trim() || !item.sourceUrl.trim())
  ) {
    throw new Error("Bucketed candidates must include quoted evidence with source URLs.");
  }
  if (
    triage.bucket === "confirmed-match" &&
    triage.deterministicHardConstraints.some((check) => check.status !== "pass")
  ) {
    throw new Error("Confirmed matches cannot violate or bypass deterministic hard constraints.");
  }
  if (triage.providerFailure && triage.bucket === "confirmed-match") {
    throw new Error("Invalid AI/provider output cannot be persisted as a confirmed match.");
  }
  createDisplayContractShapeCheck(triage);
}

function createDisplayContractShapeCheck(triage: TriageResult): void {
  const sourceLinks = uniqueStrings(triage.evidence.map((item) => item.sourceUrl));
  const evidenceQuotes = triage.evidence.map((item) => item.quote);

  if (sourceLinks.length === 0 || evidenceQuotes.length === 0) {
    throw new Error("Source evidence display contract is not consumable by downstream surfaces.");
  }
}
