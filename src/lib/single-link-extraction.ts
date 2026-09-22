/**
 * Stable public entrypoint for live single-link extraction.
 *
 * The implementation is split into transport-aware adapters, source-page parsing, Gemini
 * extraction, and result normalization under ./single-link. Keep imports from this module intact.
 */
export {
  extractListingFromUrlLive,
  type LiveSingleLinkExtractionResult,
  type SingleLinkExtractionEnv,
} from "./single-link/orchestrator";
