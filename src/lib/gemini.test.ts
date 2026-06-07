import { describe, expect, it } from "vitest";
import {
  createGeminiBriefingDraftFixture,
  createHallucinatedGeminiBriefingDraftFixture,
  g3cBriefingRunHistoryFixture,
} from "./agent-contract-fixtures";
import {
  GEMINI_DIRECT_MODEL,
  GEMINI_DIRECT_PROVIDER,
  buildGeminiBriefingDraftRequest,
  buildGeminiRequestBody,
  prepareGeminiBriefingDraftInput,
  parseGeminiApartmentSmokeOutput,
  runGeminiStructuredOutputProof,
  validateGeminiApartmentSmokeOutput,
  validateLocalGeminiBriefingDraft,
} from "./gemini";

describe("direct Gemini structured-output proof", () => {
  it("uses fixture fallback when GEMINI_API_KEY is missing without calling alternate providers", async () => {
    const result = await runGeminiStructuredOutputProof({
      apiKey: undefined,
      fixtureFallback: true,
    });

    expect(result.ok).toBe(true);
    expect(result.output?.bucket).toBe("review-needed");
    expect(result.providerMetadata).toMatchObject({
      provider: GEMINI_DIRECT_PROVIDER,
      model: GEMINI_DIRECT_MODEL,
      apiKeyEnv: "GEMINI_API_KEY",
      liveMode: "fixture-fallback",
      schemaValidation: { result: "passed" },
      costMetadataAvailable: false,
    });
    expect(result.providerMetadata.failureCode).toBe("gemini-live-call-skipped-no-api-key");
  });

  it("calls the direct Gemini REST endpoint and records token/latency/schema metadata", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      listingTitle: "42 West 21st Street #5",
                      bucket: "confirmed-match",
                      confidence: 0.88,
                      evidenceQuotes: ["5 beds, 2.5 baths, $14,500"],
                      concerns: [],
                      summary: "Strong fit for the group.",
                    }),
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 25,
            candidatesTokenCount: 35,
            totalTokenCount: 60,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await runGeminiStructuredOutputProof({
      apiKey: "test-key",
      fetchImpl,
      maxRetries: 0,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/v1beta/models/gemini-3.5-flash:generateContent");
    expect(calls[0]!.init?.headers).toMatchObject({ "x-goog-api-key": "test-key" });
    expect(result.providerMetadata).toMatchObject({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      liveMode: "live",
      status: "success",
      retryCount: 0,
      inputTokenCount: 25,
      outputTokenCount: 35,
      totalTokenCount: 60,
      schemaValidation: { result: "passed" },
    });
  });

  it("fails schema validation before persistence when Gemini output is malformed", () => {
    const parsed = parseGeminiApartmentSmokeOutput(
      JSON.stringify({ listingTitle: "Bad fixture", bucket: "confirmed-match" }),
    );

    expect(parsed.output).toBeUndefined();
    expect(parsed.schemaValidation.result).toBe("failed");
    expect(parsed.schemaValidation.errors).toEqual(
      expect.arrayContaining(["confidence must be a number between 0 and 1"]),
    );
  });

  it("builds a direct Gemini structured-output request body with responseFormat schema", () => {
    const request = buildGeminiRequestBody("Test prompt");

    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(request.generationConfig.responseSchema.required).toContain("listingTitle");
    expect(validateGeminiApartmentSmokeOutput({})).toMatchObject({ result: "failed" });
  });
});

describe("local Gemini briefing draft integration", () => {
  it("prepares structured direct Gemini input from run, candidate, source, evidence, memory, and feedback facts", () => {
    const input = prepareGeminiBriefingDraftInput(g3cBriefingRunHistoryFixture);
    const request = buildGeminiBriefingDraftRequest(input);

    expect(input.model).toBe("gemini-3.5-flash");
    expect(input.run.runId).toBe(g3cBriefingRunHistoryFixture.latestRun.runId);
    expect(input.candidates.map((candidate) => candidate.listingId)).toEqual(
      g3cBriefingRunHistoryFixture.latestRun.candidateSummaries.map(
        (candidate) => candidate.listingId,
      ),
    );
    expect(input.candidates[0]?.evidenceClaims).toContain(
      g3cBriefingRunHistoryFixture.latestRun.candidateSummaries[0]?.evidenceSummary
        .evidenceQuotes[0],
    );
    expect(input.sourceCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "streeteasy", status: "success", checkedCount: 4 }),
        expect.objectContaining({
          source: "fixture-secondary-source",
          status: "failed",
          failureCode: "fixture-source-unavailable",
        }),
      ]),
    );
    expect(input.memory.length).toBeGreaterThan(0);
    expect(input.feedback.length).toBeGreaterThan(0);
    expect(request.model).toBe("gemini-3.5-flash");
    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(request.generationConfig.responseSchema.required).toContain("listingReferences");
    expect(JSON.stringify(request.contents)).toContain(
      g3cBriefingRunHistoryFixture.latestRun.runId,
    );
  });

  it("accepts a schema-valid Gemini briefing draft and logs successful provider metadata", () => {
    const draft = createGeminiBriefingDraftFixture(g3cBriefingRunHistoryFixture);
    const result = validateLocalGeminiBriefingDraft({
      history: g3cBriefingRunHistoryFixture,
      draft,
    });

    expect(result.status).toBe("accepted");
    expect(result.briefingText).toBe(draft.summary);
    expect(result.errors).toEqual([]);
    expect(result.providerMetadata).toMatchObject({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      purpose: "briefing",
      status: "success",
      schemaValidation: "passed",
    });
    expect(result.log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "gemini-briefing-draft-accepted",
          attemptId: draft.providerMetadata.attemptId,
        }),
      ]),
    );
  });

  it("rejects hallucinated listing IDs and source claims while logging provider failure metadata", () => {
    const draft = createHallucinatedGeminiBriefingDraftFixture(g3cBriefingRunHistoryFixture);
    const result = validateLocalGeminiBriefingDraft({
      history: g3cBriefingRunHistoryFixture,
      draft,
    });

    expect(result.status).toBe("rejected");
    expect(result.briefingText).toBeUndefined();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "geminiDraft.listingReferences.0.listingId must reference a candidate in briefing history",
        "geminiDraft.sourceCoverageClaims.0.source must match checked source coverage",
        "geminiDraft.sourceCoverageClaims.0.failureCode must match the recorded source failure",
      ]),
    );
    expect(result.providerMetadata).toMatchObject({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      purpose: "briefing",
      status: "failed",
      schemaValidation: "failed",
      failureCode: "gemini-briefing-schema-validation-failed",
    });
    expect(result.log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "gemini-briefing-draft-rejected",
          attemptId: draft.providerMetadata.attemptId,
          failureCode: "gemini-briefing-schema-validation-failed",
        }),
      ]),
    );
  });

  it("rejects unsupported Gemini source coverage counts", () => {
    const draft = createGeminiBriefingDraftFixture(g3cBriefingRunHistoryFixture);
    draft.sourceCoverageClaims[0]!.checkedCount += 1;

    const result = validateLocalGeminiBriefingDraft({
      history: g3cBriefingRunHistoryFixture,
      draft,
    });

    expect(result.status).toBe("rejected");
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "geminiDraft.sourceCoverageClaims.0.checkedCount must match recorded source coverage count",
      ]),
    );
    expect(result.providerMetadata).toMatchObject({
      status: "failed",
      schemaValidation: "failed",
      failureCode: "gemini-briefing-schema-validation-failed",
    });
  });
});
