/**
 * Shared transport for the two direct Gemini callers (fit triage and single-link extraction):
 * endpoint construction, the request itself, and tolerant reading of `generateContent` responses.
 *
 * Both callers pin `responseMimeType: "application/json"` plus a `responseSchema`, so the model
 * still occasionally emits reasoning parts (`thought: true`) or appends prose after the object.
 * `extractGeminiText` and `parseGeminiJson` absorb both without losing a usable verdict.
 */

import { isRecord } from "./utils/records";

export type GeminiSchemaType = "OBJECT" | "ARRAY" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN";

export type GeminiResponseSchema = {
  type: GeminiSchemaType;
  properties?: Record<string, GeminiResponseSchema>;
  items?: GeminiResponseSchema;
  required?: readonly string[];
  enum?: readonly string[];
  description?: string;
};

/** Low keeps thinking tokens (and the 8-75s latencies they caused) out of triage calls. */
export type GeminiThinkingConfig = { thinkingLevel: "low" | "medium" | "high" };

export const GEMINI_LOW_THINKING: GeminiThinkingConfig = { thinkingLevel: "low" };

export function geminiGenerateContentUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

export function requestGeminiGenerateContent({
  apiKey,
  model,
  body,
  fetchImpl,
}: {
  apiKey: string;
  model: string;
  body: unknown;
  fetchImpl: typeof fetch;
}): Promise<Response> {
  return fetchImpl(geminiGenerateContentUrl(model), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
}

/**
 * Concatenates every answer text part of the first candidate. Reasoning parts arrive in the same
 * array marked `thought: true` and must be skipped, or the JSON body is prefixed with prose.
 */
export function extractGeminiText(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return undefined;
  const candidate = payload.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content)) return undefined;
  const parts = candidate.content.parts;
  if (!Array.isArray(parts)) return undefined;

  const text = parts
    .filter((part) => isRecord(part) && part.thought !== true && typeof part.text === "string")
    .map((part) => (part as { text: string }).text)
    .join("");

  return text.trim() ? text : undefined;
}

/**
 * Parses a model response that should be a single JSON object, falling back to the first balanced
 * `{...}` block when the model appends extra content ("Unexpected non-whitespace character after
 * JSON at position ..."). Returns undefined when nothing parseable is present.
 */
export function parseGeminiJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const balanced = firstBalancedObject(text);
    if (balanced === undefined) return undefined;
    try {
      return JSON.parse(balanced);
    } catch {
      return undefined;
    }
  }
}

function firstBalancedObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return undefined;
}
