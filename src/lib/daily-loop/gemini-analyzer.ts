import type { GeminiTriageAnalysisResult, GeminiTriageAnalyzer } from "../extraction";
import {
  GEMINI_LOW_THINKING,
  extractGeminiText,
  parseGeminiJson,
  requestGeminiGenerateContent,
} from "../gemini-client";
import {
  MAX_IMAGES_PER_LISTING,
  createAiProviderAttemptMetadata,
  type AgentTriage,
  type AiProviderAttemptMetadata,
  type ListingCandidate,
} from "../listings";
import {
  AI_TRIAGE_SCHEMA_VERSION,
  FIT_EVIDENCE_RUBRIC,
  GEMINI_TRIAGE_RESPONSE_SCHEMA,
  TRIAGE_FACTORS,
  validateGeminiTriageOutput,
  type GeminiTriageOutput,
} from "../triage";
import { safeJson } from "../utils/json";
import { uniqueStrings } from "../utils/text";
import type { DailyLoopEnv } from "./types";

/** Gemini fit-triage analyzers: the direct provider call and the failure-injection stand-in. */

const TRIAGE_MODEL = "gemini-3.5-flash";

export function createDailyLoopProviderFailureAnalyzer(
  failureCode = "gemini-fixture-failure",
): GeminiTriageAnalyzer {
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
): GeminiTriageAnalyzer | undefined {
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

/**
 * The rubric the deterministic pass already applied, restated for the model. Without it the model
 * has no definition of the three buckets and simply reflects the request back.
 */
function buildTriageInstructions(sourceUrl: string): string {
  const { hardConstraints, preferredManhattanNeighborhoods, exceptionalFallbackBoroughs } =
    FIT_EVIDENCE_RUBRIC;

  return [
    "You are triaging one New York City apartment rental listing for a five-bedroom apartment search.",
    `Return only JSON matching the supplied response schema. "schemaVersion" must be exactly "${AI_TRIAGE_SCHEMA_VERSION}".`,
    "Bucket definitions:",
    `- "confirmed-match": every hard constraint is met and quoted — at least ${hardConstraints.bedroom.minimum} bedrooms (a credible real layout, or flex/convertible evidence at confidence ${hardConstraints.bedroom.flexHighConfidenceThreshold} or higher), at least ${hardConstraints.bathrooms.minimum} bathrooms, rent at or under $${hardConstraints.maxRent}, a whole NYC apartment rental, and a move-in inside ${hardConstraints.moveIn.acceptableMonths.join(", ")} (target ${hardConstraints.moveIn.target}).`,
    `- "review-needed": a required fact is missing or ambiguous. Review-only checks: ${FIT_EVIDENCE_RUBRIC.reviewOnlyChecks.join(", ")}.`,
    `- "rejected": a rejection signal is present: ${FIT_EVIDENCE_RUBRIC.rejectionSignals.join(", ")}.`,
    `Preferred Manhattan neighborhoods: ${preferredManhattanNeighborhoods.join(", ")}. ${exceptionalFallbackBoroughs.join(" and ")} qualify only as exceptional fallbacks and stay "review-needed".`,
    'The "deterministicTriage" block is authoritative for the constraints it already checked. Never upgrade a listing to "confirmed-match" when deterministicTriage reports a hard-constraint failure or a rejected bucket; report "rejected" or "review-needed" instead and explain why in "concerns".',
    `Every evidence item must quote the supplied candidate evidence or description verbatim and set "sourceUrl" to ${sourceUrl}.`,
    `Score every confidence factor from 0 to 1 using exactly these keys: ${TRIAGE_FACTORS.join(", ")}.`,
  ].join("\n");
}

function buildTriageRequestBody(input: Parameters<GeminiTriageAnalyzer>[0]) {
  return {
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_TRIAGE_RESPONSE_SCHEMA,
      thinkingConfig: GEMINI_LOW_THINKING,
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: buildTriageInstructions(input.listing.url) },
          {
            text: JSON.stringify({
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
  };
}

async function analyzeWithDirectGemini(
  input: Parameters<GeminiTriageAnalyzer>[0],
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<GeminiTriageAnalysisResult> {
  const started = Date.now();
  const imageCount = Math.min(input.listing.imageEvidence.length, MAX_IMAGES_PER_LISTING);
  const baseMetadata = createAiProviderAttemptMetadata("fit-triage", imageCount);
  const finalize = (
    status: "success" | "failed",
    failureCode?: string,
  ): AiProviderAttemptMetadata => ({
    ...baseMetadata,
    status,
    completedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    imageCount,
    concurrencyLimit: input.concurrencyLimit,
    concurrencySlot: input.concurrencySlot,
    promptVersion: AI_TRIAGE_SCHEMA_VERSION,
    schemaValidation: status === "success" ? "passed" : "failed",
    ...(failureCode === undefined ? {} : { failureCode }),
  });
  /** The deterministic verdict stays the fallback whenever Gemini cannot be trusted. */
  const failed = (failureCode: string): GeminiTriageAnalysisResult => ({
    status: "failed",
    triage: input.output.triage,
    providerMetadata: finalize("failed", failureCode),
  });

  try {
    const response = await requestGeminiGenerateContent({
      apiKey,
      model: TRIAGE_MODEL,
      body: buildTriageRequestBody(input),
      fetchImpl,
    });
    if (!response.ok) return failed(`gemini-http-${response.status}`);

    const text = extractGeminiText(await safeJson(response));
    const parsed = text === undefined ? undefined : parseGeminiJson(text);
    if (parsed === undefined) return failed("gemini-triage-response-unparseable");

    const validation = validateGeminiTriageOutput(parsed);
    if (!validation.ok) {
      return failed(`gemini-triage-schema-invalid: ${validation.errors[0]}`);
    }

    return {
      status: input.output.status,
      triage: mergeGeminiTriage(input.output.triage, validation.output),
      providerMetadata: finalize("success"),
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : "gemini-direct-call-failed");
  }
}

/** Layers the validated verdict onto the deterministic triage without letting it lift a rejection. */
function mergeGeminiTriage(deterministic: AgentTriage, output: GeminiTriageOutput): AgentTriage {
  const blockedUpgrade = deterministic.bucket === "rejected" && output.bucket === "confirmed-match";

  return {
    ...deterministic,
    bucket: blockedUpgrade ? "review-needed" : output.bucket,
    status: "success",
    confidence: { ...deterministic.confidence, overall: output.confidence.overall },
    reasons: uniqueStrings([...deterministic.reasons, ...output.reasons]),
    concerns: uniqueStrings([...deterministic.concerns, ...output.concerns]),
    downgradeReasons: blockedUpgrade
      ? uniqueStrings([
          ...deterministic.downgradeReasons,
          "Gemini proposed confirmed-match against a deterministic rejection.",
        ])
      : deterministic.downgradeReasons,
    suggestedAction: output.suggestedAction,
  };
}
