import type { GeminiResponseSchema } from "./gemini-client";
import {
  GEMINI_PROVIDER_METADATA,
  type AiProviderAttemptMetadata,
  type IntakeKind,
  type SourceType,
  type TriageBucket,
  type TriageStatus,
} from "./listings";
import { withDefined } from "./utils/records";

export const AI_TRIAGE_SCHEMA_VERSION = "fit-evidence-v1" as const;

export const FIT_EVIDENCE_RUBRIC = {
  hardConstraints: {
    bedroom: {
      minimum: 5,
      flexHighConfidenceThreshold: 0.9,
      description:
        "Confirmed matches require a credible real 5BR layout or high-confidence flex/convertible evidence from text, photos, or floorplan.",
    },
    bathrooms: { minimum: 2 },
    maxRent: 15000,
    wholeApartmentNycRental: true,
    moveIn: {
      target: "2026-08-01",
      acceptableMonths: ["2026-07", "2026-08", "2026-09"],
    },
  },
  preferredManhattanNeighborhoods: [
    "Chelsea",
    "Flatiron",
    "NoMad",
    "East Village",
    "Lower East Side",
    "Greenwich Village",
    "Nolita",
    "SoHo",
  ],
  exceptionalFallbackBoroughs: ["Brooklyn", "Queens"],
  reviewOnlyChecks: [
    "missing-required-field",
    "low-confidence-flex-layout",
    "ambiguous-whole-apartment",
    "ambiguous-move-in-date",
    "zillow-provider-proof-pending",
    "non-first-class-public-source",
    "brooklyn-queens-exceptional-fallback",
  ],
  rejectionSignals: [
    "over-budget",
    "off-market-or-unavailable",
    "room-share-or-individual-room",
    "short-term-only",
    "confirmed-scam",
    "non-whole-apartment",
  ],
} as const;

export type TriageSource = SourceType | "nybits" | "openigloo" | "public-source";

/** The rubric factors every deterministic check and every Gemini verdict scores. */
export const TRIAGE_FACTORS = [
  "bedrooms",
  "bathrooms",
  "rent",
  "wholeApartment",
  "nycRental",
  "moveIn",
  "availability",
  "sourceIntegrity",
  "location",
] as const;

export const TRIAGE_BUCKETS = [
  "confirmed-match",
  "review-needed",
  "rejected",
] as const satisfies readonly TriageBucket[];

export type TriageFactor = (typeof TRIAGE_FACTORS)[number];
export type TriageCheckStatus = "pass" | "fail" | "unknown" | "review-needed";
export type ListingStatus = "active" | "available" | "pending" | "unavailable" | "off-market";
export type OccupancyType = "whole-apartment" | "room-share" | "individual-room" | "unknown";
export type StayType = "standard" | "short-term" | "unknown";
export type ScamSignal = "none" | "suspected" | "confirmed";
export type LayoutType = "standard" | "flex" | "convertible" | "unknown";
export type EvidenceArtifactKind =
  | "source-page"
  | "api-payload"
  | "screenshot"
  | "image"
  | "ai-output"
  | "manual-note";
export type EvidenceStorageOwner = "d1" | "r2" | "kv" | "local-fixture";

export type EvidenceArtifactPointer = {
  kind: EvidenceArtifactKind;
  pointerId: string;
  storageOwner: EvidenceStorageOwner;
  url?: string;
};

export type TriageEvidence = {
  factor: TriageFactor | "source" | "provider";
  claim: string;
  quote: string;
  sourceUrl: string;
  artifactPointer?: EvidenceArtifactPointer;
};

export type TriageOwnership = {
  groupId: string;
  runId: string;
  listingId: string;
  sourceUrl: string;
};

export type TriageCandidateInput = {
  ownership: Omit<TriageOwnership, "sourceUrl"> & { sourceUrl?: string };
  source: TriageSource;
  sourceName?: string;
  sourceUrl: string;
  intakeKind: IntakeKind;
  userQualified: boolean;
  title?: string;
  address?: string;
  neighborhood?: string;
  borough?: string;
  rent?: number;
  bedrooms?: number;
  bathrooms?: number;
  availableAt?: string;
  listingStatus?: ListingStatus | string;
  description?: string;
  evidence?: TriageEvidence[];
  concerns?: string[];
  manualReviewRequired?: boolean;
  layoutType?: LayoutType;
  realFiveBedroomConfidence?: number;
  wholeApartment?: boolean;
  occupancyType?: OccupancyType;
  stayType?: StayType;
  scamSignal?: ScamSignal;
  exceptionalFallbackEvidence?: boolean;
};

export type DeterministicHardConstraintResult = {
  factor: TriageFactor;
  status: TriageCheckStatus;
  confidence: number;
  reason: string;
  reviewOnly?: boolean;
  evidence?: TriageEvidence;
};

export type TriageConfidence = {
  realFiveBedroom: number;
  twoPlusBathrooms: number;
  priceFit: number;
  locationFit: number;
  overall: number;
  factors: Record<TriageFactor, number>;
};

export type ProviderFailureMetadata = {
  provider: typeof GEMINI_PROVIDER_METADATA.provider;
  model: typeof GEMINI_PROVIDER_METADATA.model;
  failureCode: string;
  repairAttempted: boolean;
  validationErrors: string[];
};

export type TriageResult = {
  schemaVersion: typeof AI_TRIAGE_SCHEMA_VERSION;
  bucket: TriageBucket;
  status: TriageStatus;
  ownership: TriageOwnership;
  confidence: TriageConfidence;
  evidence: TriageEvidence[];
  deterministicHardConstraints: DeterministicHardConstraintResult[];
  reasons: string[];
  concerns: string[];
  downgradeReasons: string[];
  rejectionReasons: string[];
  suggestedAction: string;
  shouldPersist: boolean;
  providerFailure?: ProviderFailureMetadata;
};

export type GeminiTriageOutput = {
  schemaVersion: typeof AI_TRIAGE_SCHEMA_VERSION;
  bucket: TriageBucket;
  confidence: {
    overall: number;
    factors: Record<string, number>;
  };
  evidence: TriageEvidence[];
  reasons: string[];
  concerns: string[];
  suggestedAction: string;
};

/**
 * The `responseSchema` the direct Gemini fit-triage call must send. Without it the model echoes the
 * request shape back (`{ schemaVersion, candidate }`, no bucket) or appends prose after the object.
 * Derived from `GeminiTriageOutput` and `TRIAGE_FACTORS` so the rubric stays the single source of
 * the factor keys.
 */
export const GEMINI_TRIAGE_RESPONSE_SCHEMA: GeminiResponseSchema = {
  type: "OBJECT",
  properties: {
    schemaVersion: { type: "STRING", enum: [AI_TRIAGE_SCHEMA_VERSION] },
    bucket: { type: "STRING", enum: TRIAGE_BUCKETS },
    confidence: {
      type: "OBJECT",
      properties: {
        overall: { type: "NUMBER", description: "0 to 1 confidence in the bucket." },
        factors: {
          type: "OBJECT",
          properties: Object.fromEntries(
            TRIAGE_FACTORS.map((factor) => [factor, { type: "NUMBER" } as GeminiResponseSchema]),
          ),
          required: TRIAGE_FACTORS,
        },
      },
      required: ["overall", "factors"],
    },
    evidence: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          factor: { type: "STRING", enum: [...TRIAGE_FACTORS, "source", "provider"] },
          claim: { type: "STRING" },
          quote: { type: "STRING", description: "Verbatim quote from the supplied listing text." },
          sourceUrl: { type: "STRING" },
        },
        required: ["factor", "claim", "quote", "sourceUrl"],
      },
    },
    reasons: { type: "ARRAY", items: { type: "STRING" } },
    concerns: { type: "ARRAY", items: { type: "STRING" } },
    suggestedAction: { type: "STRING" },
  },
  required: [
    "schemaVersion",
    "bucket",
    "confidence",
    "evidence",
    "reasons",
    "concerns",
    "suggestedAction",
  ],
};

export type GeminiTriageHandlingResult = {
  triage: TriageResult;
  providerMetadata: AiProviderAttemptMetadata;
  validationErrors: string[];
};

export type SourceEvidenceDisplayContract = {
  schemaVersion: typeof AI_TRIAGE_SCHEMA_VERSION;
  consumers: ["saved-list", "map-detail", "group-review", "briefing"];
  fields: {
    bucket: TriageBucket;
    suggestedAction: string;
    whyItFits: string[];
    concerns: string[];
    confidence: TriageConfidence;
    sourceLinks: string[];
    evidenceQuotes: string[];
    artifactPointers: EvidenceArtifactPointer[];
    downgradeHistory: string[];
    rejectionHistory: string[];
    ownership: TriageOwnership;
  };
};

const preferredManhattanNeighborhoods = new Set(
  FIT_EVIDENCE_RUBRIC.preferredManhattanNeighborhoods.map((neighborhood) =>
    normalizeText(neighborhood),
  ),
);
const exceptionalFallbackBoroughs = new Set(
  FIT_EVIDENCE_RUBRIC.exceptionalFallbackBoroughs.map((borough) => normalizeText(borough)),
);
const publicManualSources = new Set<TriageSource>([
  "zillow",
  "nybits",
  "openigloo",
  "public-source",
  "other",
  "craigslist",
  "renthop",
]);

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
  const bucket: TriageBucket =
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

export function handleGeminiTriageOutput({
  candidate,
  rawOutput,
  providerMetadata,
  repair,
}: {
  candidate: TriageCandidateInput;
  rawOutput: unknown;
  providerMetadata: AiProviderAttemptMetadata;
  repair?: (rawOutput: unknown, errors: string[]) => unknown;
}): GeminiTriageHandlingResult {
  if (providerMetadata.status === "failed") {
    const deterministic = assignFitEvidenceTriage({ ...candidate, manualReviewRequired: true });
    const failureCode = providerMetadata.failureCode ?? "gemini-provider-failed";
    const providerFailure: ProviderFailureMetadata = {
      provider: GEMINI_PROVIDER_METADATA.provider,
      model: GEMINI_PROVIDER_METADATA.model,
      failureCode,
      repairAttempted: false,
      validationErrors: [],
    };
    const triage: TriageResult = {
      ...deterministic,
      bucket: deterministic.bucket === "rejected" ? "rejected" : "review-needed",
      status: deterministic.bucket === "rejected" ? "success" : "failed",
      providerFailure,
      concerns: uniqueStrings([
        ...deterministic.concerns,
        "Gemini provider failed; manual review is required before confirmation.",
      ]),
      downgradeReasons: uniqueStrings([
        ...deterministic.downgradeReasons,
        "Gemini provider failed before trusted schema validation.",
      ]),
      suggestedAction: "Manual review required because Gemini provider output was unavailable.",
    };

    return {
      triage,
      providerMetadata: finalizeProviderMetadata(providerMetadata, "failed", "failed", failureCode),
      validationErrors: [],
    };
  }

  const firstValidation = validateGeminiTriageOutput(rawOutput);
  let repairedValidation = firstValidation;
  let repairedOutput = rawOutput;
  let repairAttempted = false;

  if (!firstValidation.ok && repair) {
    repairAttempted = true;
    repairedOutput = repair(rawOutput, firstValidation.errors);
    repairedValidation = validateGeminiTriageOutput(repairedOutput);
  }

  if (!repairedValidation.ok) {
    const deterministic = assignFitEvidenceTriage({ ...candidate, manualReviewRequired: true });
    const providerFailure: ProviderFailureMetadata = {
      provider: GEMINI_PROVIDER_METADATA.provider,
      model: GEMINI_PROVIDER_METADATA.model,
      failureCode: "gemini-output-schema-invalid",
      repairAttempted,
      validationErrors: repairedValidation.errors,
    };
    const triage: TriageResult = {
      ...deterministic,
      bucket: deterministic.bucket === "rejected" ? "rejected" : "review-needed",
      status: deterministic.bucket === "rejected" ? "success" : "failed",
      providerFailure,
      concerns: uniqueStrings([
        ...deterministic.concerns,
        "Gemini triage output failed schema validation and needs manual review.",
      ]),
      downgradeReasons: uniqueStrings([
        ...deterministic.downgradeReasons,
        "Gemini triage output failed schema validation.",
      ]),
      suggestedAction: "Manual review required because Gemini output could not be validated.",
    };

    return {
      triage,
      providerMetadata: finalizeProviderMetadata(
        providerMetadata,
        "failed",
        "failed",
        providerFailure.failureCode,
      ),
      validationErrors: repairedValidation.errors,
    };
  }

  const aiOutput = repairedValidation.output;
  const deterministic = assignFitEvidenceTriage(candidate);
  const triage: TriageResult = {
    ...deterministic,
    evidence: mergeEvidence(deterministic.evidence, aiOutput.evidence),
    reasons: uniqueStrings([...deterministic.reasons, ...aiOutput.reasons]),
    concerns: uniqueStrings([...deterministic.concerns, ...aiOutput.concerns]),
    suggestedAction: deterministic.suggestedAction,
  };

  return {
    triage,
    providerMetadata: finalizeProviderMetadata(providerMetadata, "success", "passed"),
    validationErrors: firstValidation.ok ? [] : firstValidation.errors,
  };
}

export function validateGeminiTriageOutput(
  rawOutput: unknown,
): { ok: true; output: GeminiTriageOutput } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(rawOutput)) {
    return { ok: false, errors: ["Gemini output must be an object."] };
  }

  if (rawOutput.schemaVersion !== AI_TRIAGE_SCHEMA_VERSION) {
    errors.push("schemaVersion must be fit-evidence-v1.");
  }
  if (!isBucket(rawOutput.bucket)) {
    errors.push("bucket must be confirmed-match, review-needed, or rejected.");
  }
  if (!isRecord(rawOutput.confidence)) {
    errors.push("confidence object is required.");
  } else {
    if (!isConfidenceNumber(rawOutput.confidence.overall)) {
      errors.push("confidence.overall must be a number from 0 to 1.");
    }
    if (!isRecord(rawOutput.confidence.factors)) {
      errors.push("confidence.factors object is required.");
    }
  }
  if (
    !Array.isArray(rawOutput.reasons) ||
    !rawOutput.reasons.every((item) => typeof item === "string")
  ) {
    errors.push("reasons must be an array of strings.");
  }
  if (
    !Array.isArray(rawOutput.concerns) ||
    !rawOutput.concerns.every((item) => typeof item === "string")
  ) {
    errors.push("concerns must be an array of strings.");
  }
  if (typeof rawOutput.suggestedAction !== "string" || !rawOutput.suggestedAction.trim()) {
    errors.push("suggestedAction is required.");
  }
  if (!Array.isArray(rawOutput.evidence) || rawOutput.evidence.length === 0) {
    errors.push("evidence must include at least one quoted source item.");
  } else {
    for (const item of rawOutput.evidence) {
      if (!isEvidence(item)) {
        errors.push("each evidence item must include factor, claim, quote, and sourceUrl.");
        break;
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, output: rawOutput as GeminiTriageOutput };
}

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

function evaluateBedrooms(
  candidate: TriageCandidateInput,
  evidence: TriageEvidence[],
): DeterministicHardConstraintResult {
  const relatedEvidence = firstEvidence(evidence, "bedrooms");
  const flexConfidence = candidate.realFiveBedroomConfidence ?? 0;

  if (typeof candidate.bedrooms !== "number") {
    return reviewCheck(
      "bedrooms",
      "Missing bedroom count; cannot confirm 5BR fit.",
      0.2,
      relatedEvidence,
      true,
    );
  }
  if (candidate.bedrooms >= FIT_EVIDENCE_RUBRIC.hardConstraints.bedroom.minimum) {
    return passCheck(
      "bedrooms",
      "Bedroom evidence supports a credible 5BR layout.",
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
      "High-confidence flex evidence supports a credible 5BR layout.",
      flexConfidence,
      relatedEvidence,
    );
  }
  if (candidate.layoutType === "flex" || candidate.layoutType === "convertible") {
    return reviewCheck(
      "bedrooms",
      "Flex/convertible layout lacks high-confidence real-5BR evidence.",
      Math.max(0.35, flexConfidence),
      relatedEvidence,
      true,
    );
  }

  return failCheck(
    "bedrooms",
    "Bedroom count is below the 5BR hard constraint.",
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
      "Missing bathroom count; cannot confirm 2+ baths.",
      0.25,
      relatedEvidence,
      true,
    );
  }
  if (candidate.bathrooms >= FIT_EVIDENCE_RUBRIC.hardConstraints.bathrooms.minimum) {
    return passCheck(
      "bathrooms",
      "Bathroom evidence supports 2+ bathrooms.",
      0.95,
      relatedEvidence,
    );
  }

  return failCheck(
    "bathrooms",
    "Bathroom count is below the 2 bath hard constraint.",
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
      "Rent is at or below the $15,000 hard ceiling.",
      0.98,
      relatedEvidence,
    );
  }

  return failCheck("rent", "Rent is above the $15,000 hard ceiling.", 0.1, relatedEvidence);
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
      "Move-in date is missing; August target cannot be confirmed.",
      0.35,
      relatedEvidence,
      true,
    );
  }
  if (
    FIT_EVIDENCE_RUBRIC.hardConstraints.moveIn.acceptableMonths.includes(
      normalizedMonth as "2026-07" | "2026-08" | "2026-09",
    )
  ) {
    return passCheck(
      "moveIn",
      "Move-in date is August 1 target or July/September acceptable alternative.",
      0.9,
      relatedEvidence,
    );
  }

  return reviewCheck(
    "moveIn",
    "Move-in date is outside July/August/September acceptable window.",
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
  if (candidate.manualReviewRequired || publicManualSources.has(candidate.source)) {
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
    "Location is outside preferred Manhattan and exceptional Brooklyn/Queens fallback handling.",
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

function buildConfidence(
  checks: DeterministicHardConstraintResult[],
  bucket: TriageBucket,
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

function normalizeOwnership(candidate: TriageCandidateInput): TriageOwnership {
  return {
    groupId: candidate.ownership.groupId,
    runId: candidate.ownership.runId,
    listingId: candidate.ownership.listingId,
    sourceUrl: candidate.ownership.sourceUrl ?? candidate.sourceUrl,
  };
}

function normalizeEvidence(candidate: TriageCandidateInput): TriageEvidence[] {
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

function mergeEvidence(primary: TriageEvidence[], secondary: TriageEvidence[]): TriageEvidence[] {
  const merged = new Map<string, TriageEvidence>();

  for (const item of [...primary, ...secondary]) {
    merged.set(`${item.factor}:${item.sourceUrl}:${item.quote}`, item);
  }

  return [...merged.values()];
}

function firstEvidence(
  evidence: TriageEvidence[],
  factor: TriageFactor,
): TriageEvidence | undefined {
  return evidence.find((item) => item.factor === factor) ?? evidence[0];
}

function suggestedAction(bucket: TriageBucket, userQualified: boolean): string {
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

function finalizeProviderMetadata(
  metadata: AiProviderAttemptMetadata,
  status: "success" | "failed",
  schemaValidation: "passed" | "failed",
  failureCode?: string,
): AiProviderAttemptMetadata {
  return withDefined<AiProviderAttemptMetadata>({
    ...metadata,
    status,
    completedAt: metadata.completedAt ?? new Date().toISOString(),
    schemaValidation,
    failureCode,
  });
}

function isBucket(value: unknown): value is TriageBucket {
  return value === "confirmed-match" || value === "review-needed" || value === "rejected";
}

function isEvidence(value: unknown): value is TriageEvidence {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.factor === "string" &&
    typeof value.claim === "string" &&
    typeof value.quote === "string" &&
    value.quote.trim().length > 0 &&
    typeof value.sourceUrl === "string" &&
    value.sourceUrl.trim().length > 0
  );
}

function isConfidenceNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function createDisplayContractShapeCheck(triage: TriageResult): void {
  const sourceLinks = uniqueStrings(triage.evidence.map((item) => item.sourceUrl));
  const evidenceQuotes = triage.evidence.map((item) => item.quote);

  if (sourceLinks.length === 0 || evidenceQuotes.length === 0) {
    throw new Error("Source evidence display contract is not consumable by downstream surfaces.");
  }
}
