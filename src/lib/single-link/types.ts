import type { ProviderAttempt } from "../providers/http";
import type { InviteIdentity, ListingCandidate, ListingDraft, ListingEvidence } from "../listings";

export type SingleLinkExtractionEnv = {
  AI_RUNS_ENABLED?: string;
  GEMINI_API_KEY?: string;
  REALTYAPI_KEY?: string;
  REALTYAPI_BASE_URL?: string;
};

export type LiveSingleLinkExtractionResult = {
  listing: ListingCandidate;
  extraction: {
    ok: boolean;
    sourcePageFetched: boolean;
    providerCalled: boolean;
    provider?: "realtyapi" | "google-direct";
    model?: string;
    requestAttempts?: ProviderAttempt[];
    failureCode?: string;
    failureMessage?: string;
    rawText?: string;
  };
};

export type GeminiListingExtraction = ListingDraft & {
  evidence: ListingEvidence[];
  concerns: string[];
  confidence: number;
};

export type SourcePageMetadata = ListingDraft & {
  title?: string;
  evidence: ListingEvidence[];
};

export type SourcePageResult =
  | { ok: true; text: string; metadata: SourcePageMetadata }
  | { ok: false; failureCode: string; failureMessage: string };

export type ExtractionInput = {
  rawUrl: string;
  identity: InviteIdentity;
  env?: SingleLinkExtractionEnv;
  fetchImpl?: typeof fetch;
};
