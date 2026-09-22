import type { GeminiResponseSchema } from "../gemini-client";

import { AI_TRIAGE_SCHEMA_VERSION, TRIAGE_BUCKETS, TRIAGE_FACTORS } from "./rubric";
import type { GeminiTriageOutput, TriageEvidence, TriageResult } from "./types";

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

export function isBucket(value: unknown): value is TriageResult["bucket"] {
  return value === "confirmed-match" || value === "review-needed" || value === "rejected";
}

export function isEvidence(value: unknown): value is TriageEvidence {
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

export function isConfidenceNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
