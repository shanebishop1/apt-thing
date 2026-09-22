/**
 * Public extraction entrypoint.
 *
 * Implementation is intentionally split into leaf modules by contract, batch
 * orchestration, fixture/source extraction, normalization, and triage mapping.
 * Keep this file limited to the stable public module surface.
 */
export type {
  GeminiTriageAnalysisResult,
  GeminiTriageAnalyzer,
  ManualProviderFixture,
  SingleLinkExtractionFixture,
  SingleLinkExtractionResult,
  StreetEasyBatchGeminiAnalysisResult,
  StreetEasyBatchInput,
  StreetEasyBatchResult,
  StreetEasyListingDetails,
  StreetEasySearchResult,
  StreetEasyUrlResolutionInput,
} from "./extraction/contracts";

export { extractSingleLinkFixture } from "./extraction/fixture-extraction";
export {
  runStreetEasyBatchFixture,
  runStreetEasyBatchWithGeminiAnalysis,
} from "./extraction/batch";
export { createTriageCandidateFromListing } from "./extraction/triage-candidates";
