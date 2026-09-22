import {
  GEMINI_LOW_THINKING,
  extractGeminiText,
  parseGeminiJson,
  requestGeminiGenerateContent,
} from "../gemini-client";
import { safeJson } from "../utils/json";
import { withDefined } from "../utils/records";
import type { ListingEvidence } from "../listings";
import type { GeminiListingExtraction } from "./types";
import type { ProviderAttempt } from "../providers/http";

const extractionPromptVersion = "single-link-url-extraction-v1";
const extractionModels = ["gemini-2.5-flash", "gemini-3.5-flash"] as const;

export async function callGeminiForListingExtraction({
  apiKey,
  url,
  pageText,
  fetchImpl,
}: {
  apiKey: string;
  url: string;
  pageText: string;
  fetchImpl: typeof fetch;
}): Promise<
  | {
      ok: true;
      output: GeminiListingExtraction;
      rawText: string;
      model: string;
      requestAttempts: ProviderAttempt[];
    }
  | {
      ok: false;
      failureCode: string;
      failureMessage: string;
      rawText?: string;
      model: string;
      requestAttempts: ProviderAttempt[];
    }
> {
  const failures: Array<{ failureCode: string; failureMessage: string; rawText?: string }> = [];
  const requestAttempts: ProviderAttempt[] = [];
  let finalModel: string = extractionModels[0];

  for (const model of extractionModels) {
    finalModel = model;
    let response: Response;
    try {
      response = await requestGeminiGenerateContent({
        apiKey,
        model,
        body: buildExtractionRequest(url, pageText),
        fetchImpl,
        onAttempt: (attempt) =>
          requestAttempts.push({ ...attempt, model, operation: "generate-content" }),
      });
    } catch (error) {
      failures.push({
        failureCode: `gemini-${model}-request-failed`,
        failureMessage: error instanceof Error ? error.message : "Gemini request failed.",
      });
      continue;
    }

    if (!response.ok) {
      failures.push({
        failureCode: `gemini-${model}-http-${response.status}`,
        failureMessage: (await response.text()).slice(0, 500),
      });
      continue;
    }

    const rawText = extractGeminiText(await safeJson(response)) ?? "";
    const parsed = parseGeminiJson(rawText) as Partial<GeminiListingExtraction> | undefined;

    if (parsed === undefined) {
      failures.push({
        failureCode: `gemini-${model}-json-parse-failed`,
        failureMessage: "Gemini response was not JSON.",
        rawText,
      });
      continue;
    }

    if (typeof parsed.title !== "string" || typeof parsed.address !== "string") {
      failures.push({
        failureCode: `gemini-${model}-schema-validation-failed`,
        failureMessage: "Gemini response did not include title and address.",
        rawText,
      });
      continue;
    }

    return {
      ok: true,
      model,
      requestAttempts,
      rawText,
      output: withDefined<GeminiListingExtraction>({
        title: parsed.title,
        address: parsed.address,
        neighborhood: normalizeString(parsed.neighborhood),
        borough: normalizeString(parsed.borough),
        rent: normalizeNumber(parsed.rent),
        bedrooms: normalizeNumber(parsed.bedrooms),
        bathrooms: normalizeNumber(parsed.bathrooms),
        availableAt: normalizeString(parsed.availableAt),
        description: normalizeString(parsed.description),
        amenities: normalizeStringArray(parsed.amenities),
        photos: normalizeStringArray(parsed.photos),
        evidence: normalizeEvidence(parsed.evidence, url),
        concerns: normalizeStringArray(parsed.concerns),
        confidence: normalizeNumber(parsed.confidence) ?? 0,
      }),
    };
  }

  const lastFailure = failures.at(-1);
  return {
    ok: false,
    model: finalModel,
    requestAttempts,
    failureCode: lastFailure?.failureCode ?? "gemini-extraction-failed",
    failureMessage:
      failures.map((failure) => `${failure.failureCode}: ${failure.failureMessage}`).join("\n") ||
      "Gemini extraction failed.",
    ...(lastFailure?.rawText !== undefined ? { rawText: lastFailure.rawText } : {}),
  };
}

function buildExtractionRequest(url: string, pageText: string) {
  return {
    contents: [
      {
        parts: [
          {
            text: [
              "Extract a real apartment listing from the provided source page text as JSON only.",
              "Use only facts present in the text. Do not invent rent, bedrooms, address, availability, photos, or amenities.",
              "If this is a building page rather than a unit page, use the building name as title and the building address if present.",
              "If the full street address is not present, set address to the most specific location phrase present on the page, never an empty value.",
              "Extract bedrooms and bathrooms when floorplan/unit mix text includes them, including ranges like studio-3 beds or 1-2 baths.",
              "Extract photo URLs from image-like source text only when the URLs are present in the text.",
              "If a field is missing, omit it or use an empty array. Evidence quotes must be verbatim snippets from the page text.",
              `Prompt version: ${extractionPromptVersion}`,
              `Source URL: ${url}`,
              pageText,
            ].join("\n"),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      thinkingConfig: GEMINI_LOW_THINKING,
      responseSchema: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          address: { type: "STRING" },
          neighborhood: { type: "STRING" },
          borough: { type: "STRING" },
          rent: { type: "NUMBER" },
          bedrooms: { type: "NUMBER" },
          bathrooms: { type: "NUMBER" },
          availableAt: { type: "STRING" },
          description: { type: "STRING" },
          amenities: { type: "ARRAY", items: { type: "STRING" } },
          photos: { type: "ARRAY", items: { type: "STRING" } },
          evidence: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                claim: { type: "STRING" },
                quote: { type: "STRING" },
              },
              required: ["claim", "quote"],
            },
          },
          concerns: { type: "ARRAY", items: { type: "STRING" } },
          confidence: { type: "NUMBER" },
        },
        required: ["title", "address", "evidence", "concerns", "confidence"],
      },
    },
  };
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeEvidence(value: unknown, sourceUrl: string): ListingEvidence[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<ListingEvidence>;
    return typeof record.claim === "string" && typeof record.quote === "string"
      ? [{ claim: record.claim, quote: record.quote, sourceUrl }]
      : [];
  });
}
