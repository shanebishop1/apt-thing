import { isEvidence } from "./schema";
import type { TriageCandidateInput, TriageEvidence, TriageFactor, TriageOwnership } from "./types";

export function normalizeOwnership(candidate: TriageCandidateInput): TriageOwnership {
  return {
    groupId: candidate.ownership.groupId,
    runId: candidate.ownership.runId,
    listingId: candidate.ownership.listingId,
    sourceUrl: candidate.ownership.sourceUrl ?? candidate.sourceUrl,
  };
}

export function normalizeEvidence(candidate: TriageCandidateInput): TriageEvidence[] {
  const inputEvidence = (candidate.evidence ?? []).filter(isEvidence);

  if (inputEvidence.length > 0) {
    return inputEvidence;
  }

  return [
    {
      factor: "source",
      claim: "Source link captured for triage.",
      quote: candidate.sourceUrl,
      sourceUrl: candidate.sourceUrl,
      artifactPointer: {
        kind: "source-page",
        pointerId: `${candidate.ownership.groupId}:${candidate.ownership.listingId}:source`,
        storageOwner: "local-fixture",
        url: candidate.sourceUrl,
      },
    },
  ];
}

export function mergeEvidence(
  primary: TriageEvidence[],
  secondary: TriageEvidence[],
): TriageEvidence[] {
  const merged = new Map<string, TriageEvidence>();

  for (const item of [...primary, ...secondary]) {
    merged.set(`${item.factor}:${item.sourceUrl}:${item.quote}`, item);
  }

  return [...merged.values()];
}

export function firstEvidence(
  evidence: TriageEvidence[],
  factor: TriageFactor,
): TriageEvidence | undefined {
  return evidence.find((item) => item.factor === factor) ?? evidence[0];
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}
