import { classifySource, createListingFromUrl, type ListingDraft } from "../listings";
import { areAiRunsEnabled } from "../ai-runs";
import { fetchWithRetry, type ProviderAttempt } from "../providers/http";
import { withDefined } from "../utils/records";
import { callGeminiForListingExtraction } from "./gemini";
import { extractStreetEasyViaRealtyApi } from "./realty-api";
import {
  markExtractionFailed,
  markManualNeeded,
  mergeDrafts,
  mergeExtraction,
} from "./normalization";
import { detectSourceContentMismatch, fetchSourcePage, sourceUrlTitle } from "./source-page";
import type { ExtractionInput, LiveSingleLinkExtractionResult } from "./types";

export async function extractListingFromUrlLive({
  rawUrl,
  identity,
  env,
  fetchImpl = fetch,
}: ExtractionInput): Promise<LiveSingleLinkExtractionResult> {
  const initialListing = createListingFromUrl(rawUrl, identity, { title: "Manual review needed" });
  if (!areAiRunsEnabled(env)) {
    const failureCode = "ai-runs-disabled";
    const failureMessage = "AI runs are paused. This link is saved for manual editing and review.";
    return {
      listing: markManualNeeded(initialListing, failureCode, failureMessage),
      extraction: {
        ok: false,
        sourcePageFetched: false,
        providerCalled: false,
        failureCode,
        failureMessage,
      },
    };
  }
  if (classifySource(initialListing.url) === "streeteasy") {
    const requestAttempts: ProviderAttempt[] = [];
    const boundedRealtyFetch = (input: RequestInfo | URL, init?: RequestInit) =>
      fetchWithRetry(input, init, {
        fetchImpl,
        onAttempt: (attempt) => {
          const url = String(input);
          requestAttempts.push({
            ...attempt,
            operation: url.includes("geosearch")
              ? "geosearch"
              : url.includes("rental_detailsbyid")
                ? "rental-details"
                : "rental-search",
          });
        },
      });
    const streetEasyResult = await extractStreetEasyViaRealtyApi({
      rawUrl: initialListing.url,
      identity,
      ...(env !== undefined ? { env } : {}),
      fetchImpl: boundedRealtyFetch,
    });

    if (streetEasyResult) {
      return {
        ...streetEasyResult,
        extraction: {
          ...streetEasyResult.extraction,
          provider: "realtyapi",
          requestAttempts,
        },
      };
    }
  }

  const sourcePage = await fetchSourcePage(initialListing.url, fetchImpl);
  if (!sourcePage.ok) {
    return {
      listing: markManualNeeded(initialListing, sourcePage.failureCode, sourcePage.failureMessage),
      extraction: {
        ok: false,
        sourcePageFetched: false,
        providerCalled: false,
        failureCode: sourcePage.failureCode,
        failureMessage: sourcePage.failureMessage,
      },
    };
  }

  const mismatch = detectSourceContentMismatch(initialListing.url, sourcePage.metadata);
  if (mismatch) {
    const mismatchDraft = withDefined<ListingDraft>({ title: sourceUrlTitle(initialListing.url) });
    return {
      listing: markManualNeeded(
        createListingFromUrl(rawUrl, identity, mismatchDraft),
        "source-page-content-mismatch",
        mismatch,
      ),
      extraction: {
        ok: false,
        sourcePageFetched: true,
        providerCalled: false,
        failureCode: "source-page-content-mismatch",
        failureMessage: mismatch,
      },
    };
  }

  const apiKey = env?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const failureCode = "gemini-api-key-missing";
    const failureMessage = "GEMINI_API_KEY is not set.";
    return {
      listing: markExtractionFailed(
        createListingFromUrl(rawUrl, identity, sourcePage.metadata),
        failureCode,
        failureMessage,
      ),
      extraction: {
        ok: false,
        sourcePageFetched: true,
        providerCalled: false,
        failureCode,
        failureMessage,
      },
    };
  }

  const geminiResult = await callGeminiForListingExtraction({
    apiKey,
    url: initialListing.url,
    pageText: sourcePage.text,
    fetchImpl,
  });

  if (!geminiResult.ok) {
    return {
      listing: markExtractionFailed(
        createListingFromUrl(rawUrl, identity, sourcePage.metadata),
        geminiResult.failureCode,
        geminiResult.failureMessage,
      ),
      extraction: {
        ok: false,
        sourcePageFetched: true,
        providerCalled: true,
        provider: "google-direct",
        model: geminiResult.model,
        requestAttempts: geminiResult.requestAttempts,
        failureCode: geminiResult.failureCode,
        failureMessage: geminiResult.failureMessage,
        ...(geminiResult.rawText !== undefined ? { rawText: geminiResult.rawText } : {}),
      },
    };
  }

  return {
    listing: mergeExtraction(
      createListingFromUrl(rawUrl, identity, sourcePage.metadata),
      mergeDrafts(sourcePage.metadata, geminiResult.output),
    ),
    extraction: {
      ok: true,
      sourcePageFetched: true,
      providerCalled: true,
      provider: "google-direct",
      model: geminiResult.model,
      requestAttempts: geminiResult.requestAttempts,
      rawText: geminiResult.rawText,
    },
  };
}

export type { LiveSingleLinkExtractionResult, SingleLinkExtractionEnv } from "./types";
