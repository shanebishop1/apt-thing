import type { GeminiFixtureAnalysisResult, GeminiFixtureAnalyzer } from "../extraction";
import {
  MAX_IMAGES_PER_LISTING,
  createAiProviderAttemptMetadata,
  type ListingCandidate,
} from "../listings";
import { AI_TRIAGE_SCHEMA_VERSION, type TriageEvidence, type TriageResult } from "../triage";
import { safeJson } from "../utils/json";
import { isRecord } from "../utils/records";
import type { DailyLoopEnv } from "./types";

/** Gemini fit-triage analyzers: the direct provider call and the failure-injection stand-in. */

export function createDailyLoopProviderFailureAnalyzer(
  failureCode = "gemini-fixture-failure",
): GeminiFixtureAnalyzer {
  return (input) => {
    const metadata = {
      ...createAiProviderAttemptMetadata("fit-triage", input.listing.imageEvidence.length),
      status: "failed" as const,
      completedAt: new Date().toISOString(),
      latencyMs: 0,
      imageCount: Math.min(input.listing.imageEvidence.length, MAX_IMAGES_PER_LISTING),
      concurrencyLimit: input.concurrencyLimit,
      concurrencySlot: input.concurrencySlot,
      promptVersion: AI_TRIAGE_SCHEMA_VERSION,
      schemaValidation: "failed" as const,
      failureCode,
    };
    const deterministicTriage = input.output.triage as TriageResult | TriageEvidence | unknown;
    void deterministicTriage;
    return {
      status: "failed" as const,
      triage: {
        ...input.output.triage,
        bucket: input.output.triage.bucket === "rejected" ? "rejected" : "review-needed",
        status: "failed" as const,
        concerns: [
          ...input.output.triage.concerns,
          "Gemini provider failed; manual fallback required.",
        ],
      },
      providerMetadata: metadata,
    };
  };
}

export function createGeminiAnalyzerFromEnv(
  env?: DailyLoopEnv,
  fetchImpl: typeof fetch = fetch,
): GeminiFixtureAnalyzer | undefined {
  const apiKey = env?.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  return async (input) => analyzeWithDirectGemini(input, apiKey, fetchImpl);
}

function createGeminiImageEvidenceTextPart(listing: ListingCandidate) {
  return {
    text: JSON.stringify({
      instruction:
        "Capped image evidence for visual inspection. Treat URLs as evidence references if direct image fetching is unavailable.",
      imageCap: MAX_IMAGES_PER_LISTING,
      cappedImageEvidence: listing.imageEvidence.slice(0, MAX_IMAGES_PER_LISTING).map((image) => ({
        url: image.url,
        role: image.role,
      })),
    }),
  };
}

async function analyzeWithDirectGemini(
  input: Parameters<GeminiFixtureAnalyzer>[0],
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<GeminiFixtureAnalysisResult> {
  const started = Date.now();
  const baseMetadata = createAiProviderAttemptMetadata(
    "fit-triage",
    Math.min(input.listing.imageEvidence.length, MAX_IMAGES_PER_LISTING),
  );
  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationConfig: { responseMimeType: "application/json" },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: JSON.stringify({
                    instruction:
                      "Return only JSON matching the existing apartment fit triage schema.",
                    schemaVersion: AI_TRIAGE_SCHEMA_VERSION,
                    candidate: {
                      title: input.listing.title,
                      sourceUrl: input.listing.url,
                      rent: input.listing.rent,
                      bedrooms: input.listing.bedrooms,
                      bathrooms: input.listing.bathrooms,
                      evidence: input.listing.evidence,
                      concerns: input.listing.concerns,
                    },
                    deterministicTriage: input.output.triage,
                  }),
                },
                createGeminiImageEvidenceTextPart(input.listing),
              ],
            },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error(`gemini-http-${response.status}`);
    const payload = await safeJson(response);
    const text = extractGeminiText(payload);
    const parsed = text ? JSON.parse(text) : input.output.triage;
    return {
      status: input.output.status,
      triage: parsed,
      providerMetadata: {
        ...baseMetadata,
        status: "success",
        completedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        imageCount: Math.min(input.listing.imageEvidence.length, MAX_IMAGES_PER_LISTING),
        concurrencyLimit: input.concurrencyLimit,
        concurrencySlot: input.concurrencySlot,
        promptVersion: AI_TRIAGE_SCHEMA_VERSION,
        schemaValidation: "passed",
      },
    };
  } catch (error) {
    return {
      status: "failed",
      triage: input.output.triage,
      providerMetadata: {
        ...baseMetadata,
        status: "failed",
        completedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        imageCount: Math.min(input.listing.imageEvidence.length, MAX_IMAGES_PER_LISTING),
        concurrencyLimit: input.concurrencyLimit,
        concurrencySlot: input.concurrencySlot,
        promptVersion: AI_TRIAGE_SCHEMA_VERSION,
        schemaValidation: "failed",
        failureCode: error instanceof Error ? error.message : "gemini-direct-call-failed",
      },
    };
  }
}

function extractGeminiText(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return undefined;
  const first = payload.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) {
    return undefined;
  }
  const part = first.content.parts.find((item) => isRecord(item) && typeof item.text === "string");
  return isRecord(part) && typeof part.text === "string" ? part.text : undefined;
}
