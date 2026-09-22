import type {
  AiProviderAttemptMetadata,
  IntakeKind,
  SourceType,
  TriageBucket,
  TriageStatus,
} from "../listings";

export type TriageSource = SourceType | "nybits" | "openigloo" | "public-source";

export type TriageFactor =
  | "bedrooms"
  | "bathrooms"
  | "rent"
  | "wholeApartment"
  | "nycRental"
  | "moveIn"
  | "availability"
  | "sourceIntegrity"
  | "location";

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

type GeminiProviderMetadata = typeof import("../listings").GEMINI_PROVIDER_METADATA;

export type ProviderFailureMetadata = {
  provider: GeminiProviderMetadata["provider"];
  model: GeminiProviderMetadata["model"];
  failureCode: string;
  repairAttempted: boolean;
  validationErrors: string[];
};

export type TriageResult = {
  schemaVersion: "fit-evidence-v1";
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
  schemaVersion: "fit-evidence-v1";
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

export type GeminiTriageHandlingResult = {
  triage: TriageResult;
  providerMetadata: AiProviderAttemptMetadata;
  validationErrors: string[];
};

export type SourceEvidenceDisplayContract = {
  schemaVersion: "fit-evidence-v1";
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
