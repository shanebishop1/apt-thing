import type {
  AiExtractionOutput,
  AiProviderAttemptMetadata,
  AgentTriage,
  ExtractionJob,
  ExtractionStatus,
  ListingCandidate,
  ListingDraft,
  ListingEvidence,
  RealtyApiSearchQuery,
  TriageBucket,
  TriageStatus,
} from "../listings";

export type StreetEasyListingDetails = ListingDraft & {
  listingId: string;
  sourceUrl: string;
  urlPath: string;
  fullBathrooms?: number;
  halfBathrooms?: number;
  noFee?: boolean;
  status?: string;
};

export type StreetEasySearchResult = {
  listingId: string;
  sourceUrl: string;
  urlPath: string;
  page: number;
  location: string;
  details: StreetEasyListingDetails;
};

export type StreetEasyUrlResolutionInput = {
  kind: "streeteasy-realtyapi-url-resolution-fixture";
  sourceUrl: string;
  query: RealtyApiSearchQuery;
  locationCandidates: string[];
  pagesScanned: number[];
  searchResults: StreetEasySearchResult[];
};

export type ManualProviderFixture = ListingDraft & {
  kind: "zillow-manual-fixture" | "fallback-apartment-fixture";
  sourceUrl: string;
  status: ExtractionStatus;
  evidence: ListingEvidence[];
  concerns: string[];
  triageBucket?: TriageBucket;
  triageStatus?: TriageStatus;
  manualReviewRequired?: boolean;
  extractionFailureCode?: string;
};

export type SingleLinkExtractionFixture = StreetEasyUrlResolutionInput | ManualProviderFixture;

export type StreetEasyBatchInput = {
  kind: "streeteasy-batch-fixture";
  query: RealtyApiSearchQuery;
  results: StreetEasySearchResult[];
};

export type SingleLinkExtractionResult = {
  listing: ListingCandidate;
  extractionJob: ExtractionJob;
  output: AiExtractionOutput;
  resolutionJob?: import("../listings").StreetEasyUrlResolutionJob;
};

export type StreetEasyBatchResult = {
  run: import("../listings").StreetEasyBatchRun;
  listings: ListingCandidate[];
  extractionJobs: ExtractionJob[];
  skipped: Array<{ listingId: string; reason: "seen" | "triaged" }>;
};

export type GeminiTriageAnalysisInput = {
  listing: ListingCandidate;
  extractionJob: ExtractionJob;
  output: AiExtractionOutput;
  sourceResult: StreetEasySearchResult;
  concurrencyLimit: number;
  concurrencySlot: number;
  runId: string;
};

export type GeminiTriageAnalysisResult = {
  status: ExtractionStatus;
  triage: AgentTriage;
  providerMetadata: AiProviderAttemptMetadata;
};

export type GeminiTriageAnalyzer = (
  input: GeminiTriageAnalysisInput,
) => Promise<GeminiTriageAnalysisResult> | GeminiTriageAnalysisResult;

export type StreetEasyBatchGeminiAnalysisStatus = {
  listingId: string;
  sourceUrl: string;
  status: ExtractionStatus;
  triageStatus: TriageStatus;
  triageBucket: TriageBucket;
  providerMetadata: AiProviderAttemptMetadata;
};

export type StreetEasyBatchGeminiAnalysisSummary = {
  concurrencyLimit: number;
  maxObservedInFlight: number;
  listingStatuses: StreetEasyBatchGeminiAnalysisStatus[];
};

export type StreetEasyBatchGeminiAnalysisResult = StreetEasyBatchResult & {
  geminiAnalysis: StreetEasyBatchGeminiAnalysisSummary;
};

export type StreetEasyBatchExtractionRecord = {
  sourceResult: StreetEasySearchResult;
  listing: ListingCandidate;
  extractionJob: ExtractionJob;
  output: AiExtractionOutput;
};

export type BuildTriageOptions = {
  overrideBucket?: TriageBucket;
  overrideStatus?: TriageStatus;
};
