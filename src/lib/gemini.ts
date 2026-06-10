import {
  GEMINI_BRIEFING_SCHEMA_VERSION,
  validateGeminiBriefingDraftContract,
  type BriefingRunHistoryContract,
  type GeminiBriefingDraftContract,
} from "./agent-contracts";
import type { AiProviderAttemptMetadata } from "./listings";

export const GEMINI_DIRECT_PROVIDER = "google-direct" as const;
export const GEMINI_DIRECT_MODEL = "gemini-3.5-flash" as const;
export const GEMINI_API_KEY_ENV = "GEMINI_API_KEY" as const;
export const GEMINI_SMOKE_PROMPT_VERSION = "g2b-gemini-smoke-v1" as const;

export type GeminiSchemaValidationResult = {
  result: "passed" | "failed";
  errors: string[];
};

export type GeminiProviderMetadata = {
  contract: "gemini-provider-metadata-v1";
  provider: typeof GEMINI_DIRECT_PROVIDER;
  model: typeof GEMINI_DIRECT_MODEL;
  apiKeyEnv: typeof GEMINI_API_KEY_ENV;
  promptVersion: string;
  status: "success" | "failed";
  liveMode: "live" | "fixture-fallback";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  retryCount: number;
  failureCode?: string;
  failureMessage?: string;
  schemaValidation: GeminiSchemaValidationResult;
  inputTokenCount?: number;
  outputTokenCount?: number;
  totalTokenCount?: number;
  costUsd?: number;
  costMetadataAvailable: boolean;
};

export type GeminiApartmentSmokeOutput = {
  listingTitle: string;
  bucket: "confirmed-match" | "review-needed" | "rejected";
  confidence: number;
  evidenceQuotes: string[];
  concerns: string[];
  summary: string;
};

export type GeminiStructuredOutputProofResult = {
  ok: boolean;
  output?: GeminiApartmentSmokeOutput;
  providerMetadata: GeminiProviderMetadata;
  rawText?: string;
};

export const GEMINI_BRIEFING_PROMPT_VERSION = "g3c-gemini-briefing-draft-v1" as const;

export type GeminiBriefingDraftInput = {
  model: typeof GEMINI_DIRECT_MODEL;
  promptVersion: typeof GEMINI_BRIEFING_PROMPT_VERSION;
  schemaVersion: typeof GEMINI_BRIEFING_SCHEMA_VERSION;
  groupId: string;
  generatedAt: string;
  run: {
    runId: string;
    cadence: BriefingRunHistoryContract["latestRun"]["cadence"];
    status: BriefingRunHistoryContract["latestRun"]["status"];
    counts: BriefingRunHistoryContract["latestRun"]["counts"];
  };
  candidates: Array<{
    listingId: string;
    sourceUrl: string;
    source: string;
    title: string;
    bucket: string;
    triageStatus: string;
    reviewStatus: string;
    providerRoute: string;
    confidenceOverall: number;
    evidenceClaims: string[];
    concerns: string[];
    suggestedAction: string;
  }>;
  sourceCoverage: Array<{
    source: string;
    status: string;
    checkedCount: number;
    candidateCount: number;
    failureCode?: string;
    failureMessage?: string;
  }>;
  memory: Array<{
    sourceUrl: string;
    memoryState: string;
    reason: string;
    lastSeenAt: string;
  }>;
  feedback: Array<{
    listingId: string;
    sourceUrl: string;
    commentCount: number;
    reactionCount: number;
    statusChangeCount: number;
    disagreementCount: number;
    summaries: string[];
  }>;
};

export type GeminiBriefingDraftRequest = {
  model: typeof GEMINI_DIRECT_MODEL;
  contents: Array<{ parts: Array<{ text: string }> }>;
  generationConfig: {
    responseMimeType: "application/json";
    responseSchema: Record<string, unknown>;
  };
};

export type GeminiBriefingDraftValidationLogEntry = {
  event: "gemini-briefing-draft-accepted" | "gemini-briefing-draft-rejected";
  runId: string;
  attemptId: string;
  provider: typeof GEMINI_DIRECT_PROVIDER;
  model: typeof GEMINI_DIRECT_MODEL;
  status: AiProviderAttemptMetadata["status"];
  schemaValidation: NonNullable<AiProviderAttemptMetadata["schemaValidation"]>;
  failureCode?: string;
  errors: string[];
  generatedAt: string;
};

export type GeminiBriefingDraftValidationResult = {
  status: "accepted" | "rejected";
  briefingText?: string;
  draft?: GeminiBriefingDraftContract;
  providerMetadata: AiProviderAttemptMetadata;
  errors: string[];
  promptInput: GeminiBriefingDraftInput;
  log: GeminiBriefingDraftValidationLogEntry[];
};

export function prepareGeminiBriefingDraftInput(
  history: BriefingRunHistoryContract,
): GeminiBriefingDraftInput {
  return {
    model: GEMINI_DIRECT_MODEL,
    promptVersion: GEMINI_BRIEFING_PROMPT_VERSION,
    schemaVersion: GEMINI_BRIEFING_SCHEMA_VERSION,
    groupId: history.groupId,
    generatedAt: history.generatedAt,
    run: {
      runId: history.latestRun.runId,
      cadence: history.latestRun.cadence,
      status: history.latestRun.status,
      counts: history.latestRun.counts,
    },
    candidates: history.latestRun.candidateSummaries.map((candidate) => ({
      listingId: candidate.listingId,
      sourceUrl: candidate.sourceUrl,
      source: candidate.source,
      title: candidate.title,
      bucket: candidate.bucket,
      triageStatus: candidate.triageStatus,
      reviewStatus: candidate.reviewStatus,
      providerRoute: candidate.providerRoute,
      confidenceOverall: candidate.evidenceSummary.confidence.overall,
      evidenceClaims: uniqueStrings([
        ...candidate.evidenceSummary.evidenceQuotes,
        ...candidate.evidenceSummary.reasons,
        ...candidate.evidenceSummary.concerns,
      ]),
      concerns: candidate.evidenceSummary.concerns,
      suggestedAction: candidate.suggestedAction,
    })),
    sourceCoverage: history.latestRun.sourceCoverage.map((coverage) => ({
      source: coverage.source,
      status: coverage.status,
      checkedCount: coverage.checkedCount,
      candidateCount: coverage.candidateCount,
      failureCode: coverage.failureCode,
      failureMessage: coverage.failureMessage,
    })),
    memory: history.seenRejectedMemory.map((record) => ({
      sourceUrl: record.sourceUrl,
      memoryState: record.memoryState,
      reason: record.reason,
      lastSeenAt: record.lastSeenAt,
    })),
    feedback: history.feedbackSummaries.map((summary) => ({
      listingId: summary.listingId,
      sourceUrl: summary.sourceUrl,
      commentCount: summary.commentCount,
      reactionCount: summary.reactionCount,
      statusChangeCount: summary.statusChangeCount,
      disagreementCount: summary.disagreementCount,
      summaries: summary.summaries,
    })),
  };
}

export function buildGeminiBriefingDraftRequest(
  input: GeminiBriefingDraftInput,
): GeminiBriefingDraftRequest {
  return {
    model: GEMINI_DIRECT_MODEL,
    contents: [
      {
        parts: [
          {
            text: [
              "Draft a concise in-app apartment-search briefing as JSON only.",
              "Use only listing IDs, source URLs, evidence claims, source coverage, memory, and feedback facts present in the structured input.",
              "Do not invent listing IDs, source claims, source failures, or evidence quotes.",
              "Return a gemini-briefing-draft-v1 object with providerMetadata for google-direct gemini-3.5-flash.",
              JSON.stringify(input),
            ].join("\n"),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: geminiBriefingDraftResponseSchema(),
    },
  };
}

export function validateLocalGeminiBriefingDraft({
  history,
  draft,
}: {
  history: BriefingRunHistoryContract;
  draft: GeminiBriefingDraftContract;
}): GeminiBriefingDraftValidationResult {
  const promptInput = prepareGeminiBriefingDraftInput(history);
  const errors = validateGeminiBriefingDraftContract(draft, history);
  const accepted = errors.length === 0;
  const providerMetadata = normalizeBriefingProviderMetadata(draft.providerMetadata, accepted);
  const failureCode = accepted ? undefined : "gemini-briefing-schema-validation-failed";

  if (failureCode) {
    providerMetadata.failureCode = failureCode;
  }

  const logEntry: GeminiBriefingDraftValidationLogEntry = {
    event: accepted ? "gemini-briefing-draft-accepted" : "gemini-briefing-draft-rejected",
    runId: history.latestRun.runId,
    attemptId: providerMetadata.attemptId,
    provider: GEMINI_DIRECT_PROVIDER,
    model: GEMINI_DIRECT_MODEL,
    status: providerMetadata.status,
    schemaValidation: providerMetadata.schemaValidation ?? (accepted ? "passed" : "failed"),
    failureCode,
    errors,
    generatedAt: history.generatedAt,
  };

  return {
    status: accepted ? "accepted" : "rejected",
    briefingText: accepted ? draft.summary : undefined,
    draft: accepted ? draft : undefined,
    providerMetadata,
    errors,
    promptInput,
    log: [logEntry],
  };
}

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

export async function runGeminiStructuredOutputProof({
  apiKey,
  fetchImpl = fetch,
  fixtureFallback = true,
  maxRetries = 0,
  promptVersion = GEMINI_SMOKE_PROMPT_VERSION,
}: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  fixtureFallback?: boolean;
  maxRetries?: number;
  promptVersion?: string;
}): Promise<GeminiStructuredOutputProofResult> {
  if (!apiKey) {
    if (!fixtureFallback) {
      const now = new Date().toISOString();
      return {
        ok: false,
        providerMetadata: buildGeminiProviderMetadata({
          promptVersion,
          startedAt: now,
          completedAt: now,
          liveMode: "fixture-fallback",
          status: "failed",
          retryCount: 0,
          failureCode: "gemini-api-key-missing",
          failureMessage: "GEMINI_API_KEY is not set.",
          schemaValidation: { result: "failed", errors: ["GEMINI_API_KEY is not set."] },
        }),
      };
    }

    return buildFixtureFallbackProof(promptVersion);
  }

  return runLiveGeminiProof({ apiKey, fetchImpl, maxRetries, promptVersion });
}

export function validateGeminiApartmentSmokeOutput(value: unknown): GeminiSchemaValidationResult {
  const errors: string[] = [];
  const candidate = isRecord(value) ? value : undefined;

  if (!candidate) {
    return { result: "failed", errors: ["output must be an object"] };
  }

  requireString(errors, candidate.listingTitle, "listingTitle");
  if (
    candidate.bucket !== "confirmed-match" &&
    candidate.bucket !== "review-needed" &&
    candidate.bucket !== "rejected"
  ) {
    errors.push("bucket must be confirmed-match, review-needed, or rejected");
  }
  if (
    typeof candidate.confidence !== "number" ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    errors.push("confidence must be a number between 0 and 1");
  }
  requireStringArray(errors, candidate.evidenceQuotes, "evidenceQuotes");
  requireStringArray(errors, candidate.concerns, "concerns");
  requireString(errors, candidate.summary, "summary");

  return { result: errors.length === 0 ? "passed" : "failed", errors };
}

export function parseGeminiApartmentSmokeOutput(rawText: string): {
  output?: GeminiApartmentSmokeOutput;
  schemaValidation: GeminiSchemaValidationResult;
} {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    const schemaValidation = validateGeminiApartmentSmokeOutput(parsed);

    return {
      output:
        schemaValidation.result === "passed" ? (parsed as GeminiApartmentSmokeOutput) : undefined,
      schemaValidation,
    };
  } catch (error) {
    return {
      schemaValidation: {
        result: "failed",
        errors: [error instanceof Error ? error.message : "Gemini response was not JSON"],
      },
    };
  }
}

export function buildGeminiRequestBody(prompt: string) {
  return {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          listingTitle: { type: "STRING" },
          bucket: { type: "STRING", enum: ["confirmed-match", "review-needed", "rejected"] },
          confidence: { type: "NUMBER" },
          evidenceQuotes: { type: "ARRAY", items: { type: "STRING" } },
          concerns: { type: "ARRAY", items: { type: "STRING" } },
          summary: { type: "STRING" },
        },
        required: ["listingTitle", "bucket", "confidence", "evidenceQuotes", "concerns", "summary"],
      },
    },
  };
}

function normalizeBriefingProviderMetadata(
  metadata: AiProviderAttemptMetadata,
  accepted: boolean,
): AiProviderAttemptMetadata {
  return {
    ...metadata,
    provider: GEMINI_DIRECT_PROVIDER,
    model: GEMINI_DIRECT_MODEL,
    apiKeyEnv: GEMINI_API_KEY_ENV,
    purpose: "briefing",
    status: accepted ? "success" : "failed",
    schemaValidation: accepted ? "passed" : "failed",
  };
}

function geminiBriefingDraftResponseSchema(): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      contract: { type: "STRING" },
      schemaVersion: { type: "STRING" },
      groupId: { type: "STRING" },
      runId: { type: "STRING" },
      generatedAt: { type: "STRING" },
      summary: { type: "STRING" },
      listingReferences: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            listingId: { type: "STRING" },
            sourceUrl: { type: "STRING" },
            rationale: { type: "STRING" },
            evidenceClaims: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["listingId", "sourceUrl", "rationale", "evidenceClaims"],
        },
      },
      sourceCoverageClaims: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            source: { type: "STRING" },
            status: { type: "STRING", enum: ["success", "partial", "failed"] },
            checkedCount: { type: "NUMBER" },
            failureCode: { type: "STRING" },
          },
          required: ["source", "status", "checkedCount"],
        },
      },
      suggestedActions: { type: "ARRAY", items: { type: "STRING" } },
      providerMetadata: { type: "OBJECT" },
      rawArtifactPointers: { type: "ARRAY", items: { type: "OBJECT" } },
    },
    required: [
      "contract",
      "schemaVersion",
      "groupId",
      "runId",
      "generatedAt",
      "summary",
      "listingReferences",
      "sourceCoverageClaims",
      "suggestedActions",
      "providerMetadata",
      "rawArtifactPointers",
    ],
  };
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function buildFixtureFallbackProof(promptVersion: string): GeminiStructuredOutputProofResult {
  const startedAt = new Date().toISOString();
  const output: GeminiApartmentSmokeOutput = {
    listingTitle: "Fixture Gemini 3.5 Flash proof listing",
    bucket: "review-needed",
    confidence: 0.72,
    evidenceQuotes: ["Fixture fallback validates structured output without a live provider call."],
    concerns: ["Live Gemini call skipped because GEMINI_API_KEY is not available."],
    summary:
      "Fixture fallback proves schema validation and provider metadata shape for live-safe smoke.",
  };
  const schemaValidation = validateGeminiApartmentSmokeOutput(output);
  const completedAt = new Date().toISOString();

  return {
    ok: schemaValidation.result === "passed",
    output,
    rawText: JSON.stringify(output),
    providerMetadata: buildGeminiProviderMetadata({
      promptVersion,
      startedAt,
      completedAt,
      liveMode: "fixture-fallback",
      status: schemaValidation.result === "passed" ? "success" : "failed",
      retryCount: 0,
      schemaValidation,
      inputTokenCount: 0,
      outputTokenCount: 0,
      totalTokenCount: 0,
      failureCode: "gemini-live-call-skipped-no-api-key",
      failureMessage:
        "Fixture fallback was used because GEMINI_API_KEY is not available; no alternate provider was called.",
    }),
  };
}

async function runLiveGeminiProof({
  apiKey,
  fetchImpl,
  maxRetries,
  promptVersion,
}: {
  apiKey: string;
  fetchImpl: typeof fetch;
  maxRetries: number;
  promptVersion: string;
}): Promise<GeminiStructuredOutputProofResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const prompt =
    "Return structured JSON only for this apartment candidate: title '42 West 21st Street #5', rent 14500, beds 5, baths 2.5, Flatiron Manhattan. The bucket field MUST exactly equal one of confirmed-match, review-needed, or rejected for an NYC 5BR group with max rent 15000.";
  let lastFailure: { code: string; message: string } | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DIRECT_MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(buildGeminiRequestBody(prompt)),
        },
      );

      if (!response.ok) {
        const failureBody = await response.text();
        lastFailure = {
          code: `gemini-http-${response.status}`,
          message: failureBody.slice(0, 400),
        };
        continue;
      }

      const body = (await response.json()) as GeminiGenerateContentResponse;
      const rawText = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const { output, schemaValidation } = parseGeminiApartmentSmokeOutput(rawText);
      const completedAt = new Date().toISOString();
      const providerMetadata = buildGeminiProviderMetadata({
        promptVersion,
        startedAt,
        completedAt,
        liveMode: "live",
        status: schemaValidation.result === "passed" ? "success" : "failed",
        retryCount: attempt,
        schemaValidation,
        failureCode:
          schemaValidation.result === "failed" ? "gemini-schema-validation-failed" : undefined,
        failureMessage: schemaValidation.errors.join("; ") || undefined,
        inputTokenCount: body.usageMetadata?.promptTokenCount,
        outputTokenCount: body.usageMetadata?.candidatesTokenCount,
        totalTokenCount: body.usageMetadata?.totalTokenCount,
        latencyMs: Date.now() - started,
      });

      return {
        ok: Boolean(output),
        output,
        rawText,
        providerMetadata,
      };
    } catch (error) {
      lastFailure = {
        code: "gemini-fetch-failed",
        message: error instanceof Error ? error.message : "Unknown Gemini fetch failure",
      };
    }
  }

  const completedAt = new Date().toISOString();

  return {
    ok: false,
    providerMetadata: buildGeminiProviderMetadata({
      promptVersion,
      startedAt,
      completedAt,
      liveMode: "live",
      status: "failed",
      retryCount: maxRetries,
      failureCode: lastFailure?.code ?? "gemini-live-call-failed",
      failureMessage: lastFailure?.message,
      schemaValidation: {
        result: "failed",
        errors: [lastFailure?.message ?? "Gemini call failed"],
      },
      latencyMs: Date.now() - started,
    }),
  };
}

function buildGeminiProviderMetadata({
  promptVersion,
  startedAt,
  completedAt,
  liveMode,
  status,
  retryCount,
  schemaValidation,
  failureCode,
  failureMessage,
  inputTokenCount,
  outputTokenCount,
  totalTokenCount,
  latencyMs,
}: {
  promptVersion: string;
  startedAt: string;
  completedAt: string;
  liveMode: GeminiProviderMetadata["liveMode"];
  status: GeminiProviderMetadata["status"];
  retryCount: number;
  schemaValidation: GeminiSchemaValidationResult;
  failureCode?: string;
  failureMessage?: string;
  inputTokenCount?: number;
  outputTokenCount?: number;
  totalTokenCount?: number;
  latencyMs?: number;
}): GeminiProviderMetadata {
  return {
    contract: "gemini-provider-metadata-v1",
    provider: GEMINI_DIRECT_PROVIDER,
    model: GEMINI_DIRECT_MODEL,
    apiKeyEnv: GEMINI_API_KEY_ENV,
    promptVersion,
    status,
    liveMode,
    startedAt,
    completedAt,
    latencyMs: latencyMs ?? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    retryCount,
    failureCode,
    failureMessage,
    schemaValidation,
    inputTokenCount,
    outputTokenCount,
    totalTokenCount,
    costMetadataAvailable: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(errors: string[], value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requireStringArray(errors: string[], value: unknown, path: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`${path} must be an array of strings`);
  }
}
