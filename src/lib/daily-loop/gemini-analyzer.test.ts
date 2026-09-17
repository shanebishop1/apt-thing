import { describe, expect, it, vi } from "vitest";
import { extractSingleLinkFixture } from "../extraction";
import { streetEasyBatchFixture, streetEasyPastedFixture } from "../fixtures";
import { createGroupIdentity, defaultSearchGroup } from "../listings";
import { AI_TRIAGE_SCHEMA_VERSION, TRIAGE_FACTORS } from "../triage";
import { createGeminiAnalyzerFromEnv } from "./gemini-analyzer";

const identity = createGroupIdentity(defaultSearchGroup.id, "Verifier")!;

function createAnalyzerInput() {
  const extracted = extractSingleLinkFixture({
    rawUrl: streetEasyPastedFixture.sourceUrl,
    identity,
    fixture: streetEasyPastedFixture,
  });

  return {
    ...extracted,
    sourceResult: streetEasyBatchFixture.results[0]!,
    concurrencyLimit: 2,
    concurrencySlot: 1,
    runId: "run-gemini-analyzer-test",
  };
}

function createVerdict(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: AI_TRIAGE_SCHEMA_VERSION,
    bucket: "confirmed-match",
    confidence: {
      overall: 0.88,
      factors: Object.fromEntries(TRIAGE_FACTORS.map((factor) => [factor, 0.9])),
    },
    evidence: [
      {
        factor: "bedrooms",
        claim: "Six bedrooms are listed.",
        quote: "RealtyAPI fixture for a user-qualified pasted StreetEasy listing.",
        sourceUrl: streetEasyPastedFixture.sourceUrl,
      },
    ],
    reasons: ["Six bedrooms clear the five-bedroom minimum."],
    concerns: [],
    suggestedAction: "Share as a confirmed match candidate with preserved evidence.",
    ...overrides,
  };
}

function geminiResponse(parts: Array<Record<string, unknown>>) {
  return Response.json({ candidates: [{ content: { parts } }] });
}

async function analyze(fetchImpl: typeof fetch) {
  const analyzer = createGeminiAnalyzerFromEnv({ GEMINI_API_KEY: "test-key" }, fetchImpl)!;
  return analyzer(createAnalyzerInput());
}

describe("direct Gemini fit-triage analyzer", () => {
  it("sends the triage response schema and low thinking, and keeps the parsed bucket", async () => {
    let requestBody = "";
    const fetchImpl = (async (_url: string, init?: { body?: unknown }) => {
      requestBody = String(init?.body);
      return geminiResponse([{ text: JSON.stringify(createVerdict()) }]);
    }) as unknown as typeof fetch;

    const result = await analyze(fetchImpl);

    const body = JSON.parse(requestBody) as {
      generationConfig: { responseSchema: { required: string[] }; thinkingConfig: unknown };
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    expect(body.generationConfig.responseSchema.required).toContain("bucket");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(body.contents[0]?.parts[0]?.text).toContain(AI_TRIAGE_SCHEMA_VERSION);
    expect(body.contents[0]?.parts[0]?.text).toContain('"confirmed-match"');

    expect(result.triage.bucket).toBe("confirmed-match");
    expect(result.triage.confidence.overall).toBe(0.88);
    expect(result.triage.reasons).toContain("Six bedrooms clear the five-bedroom minimum.");
    expect(result.providerMetadata).toMatchObject({
      status: "success",
      schemaValidation: "passed",
    });
    expect(result.providerMetadata.failureCode).toBeUndefined();
  });

  it("fails validation when the model echoes the request shape back", async () => {
    const echoed = {
      schemaVersion: AI_TRIAGE_SCHEMA_VERSION,
      candidate: { title: "152 Manhattan" },
    };
    const fetchImpl = vi.fn(async () => geminiResponse([{ text: JSON.stringify(echoed) }]));

    const result = await analyze(fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe("failed");
    expect(result.providerMetadata.schemaValidation).toBe("failed");
    expect(result.providerMetadata.failureCode).toContain("gemini-triage-schema-invalid");
    expect(result.providerMetadata.failureCode).toContain("bucket must be");
  });

  it("parses a verdict that is followed by trailing prose", async () => {
    const text = `${JSON.stringify(createVerdict({ bucket: "review-needed" }))}\n\nI hope this helps!`;
    const fetchImpl = vi.fn(async () => geminiResponse([{ text }]));

    const result = await analyze(fetchImpl as unknown as typeof fetch);

    expect(result.triage.bucket).toBe("review-needed");
    expect(result.providerMetadata.schemaValidation).toBe("passed");
  });

  it("skips thought parts that precede the answer", async () => {
    const fetchImpl = vi.fn(async () =>
      geminiResponse([
        { text: "Let me weigh the bedroom evidence first.", thought: true },
        { text: JSON.stringify(createVerdict({ bucket: "rejected" })) },
      ]),
    );

    const result = await analyze(fetchImpl as unknown as typeof fetch);

    expect(result.triage.bucket).toBe("rejected");
    expect(result.providerMetadata.schemaValidation).toBe("passed");
  });

  it("does not let the model lift a deterministic rejection to a confirmed match", async () => {
    const input = createAnalyzerInput();
    const rejectedInput = {
      ...input,
      output: { ...input.output, triage: { ...input.output.triage, bucket: "rejected" as const } },
    };
    const fetchImpl = vi.fn(async () =>
      geminiResponse([{ text: JSON.stringify(createVerdict()) }]),
    );

    const analyzer = createGeminiAnalyzerFromEnv(
      { GEMINI_API_KEY: "test-key" },
      fetchImpl as unknown as typeof fetch,
    )!;
    const result = await analyzer(rejectedInput);

    expect(result.triage.bucket).toBe("review-needed");
    expect(result.triage.downgradeReasons).toContain(
      "Gemini proposed confirmed-match against a deterministic rejection.",
    );
  });

  it("reports the HTTP status as the failure code and keeps the deterministic verdict", async () => {
    const input = createAnalyzerInput();
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));

    const analyzer = createGeminiAnalyzerFromEnv(
      { GEMINI_API_KEY: "test-key" },
      fetchImpl as unknown as typeof fetch,
    )!;
    const result = await analyzer(input);

    expect(result.status).toBe("failed");
    expect(result.providerMetadata.failureCode).toBe("gemini-http-429");
    expect(result.providerMetadata.schemaValidation).toBe("failed");
    expect(result.triage).toEqual(input.output.triage);
  });
});
