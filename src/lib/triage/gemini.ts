import { GEMINI_PROVIDER_METADATA, type AiProviderAttemptMetadata } from "../listings";
import { withDefined } from "../utils/records";

import { mergeEvidence, uniqueStrings } from "./evidence";
import { assignFitEvidenceTriage } from "./orchestration";
import { validateGeminiTriageOutput } from "./schema";
import type {
  GeminiTriageHandlingResult,
  ProviderFailureMetadata,
  TriageCandidateInput,
  TriageResult,
} from "./types";

export function handleGeminiTriageOutput({
  candidate,
  rawOutput,
  providerMetadata,
  repair,
}: {
  candidate: TriageCandidateInput;
  rawOutput: unknown;
  providerMetadata: AiProviderAttemptMetadata;
  repair?: (rawOutput: unknown, errors: string[]) => unknown;
}): GeminiTriageHandlingResult {
  if (providerMetadata.status === "failed") {
    const deterministic = assignFitEvidenceTriage({ ...candidate, manualReviewRequired: true });
    const failureCode = providerMetadata.failureCode ?? "gemini-provider-failed";
    const providerFailure: ProviderFailureMetadata = {
      provider: GEMINI_PROVIDER_METADATA.provider,
      model: GEMINI_PROVIDER_METADATA.model,
      failureCode,
      repairAttempted: false,
      validationErrors: [],
    };
    const triage: TriageResult = {
      ...deterministic,
      bucket: deterministic.bucket === "rejected" ? "rejected" : "review-needed",
      status: deterministic.bucket === "rejected" ? "success" : "failed",
      providerFailure,
      concerns: uniqueStrings([
        ...deterministic.concerns,
        "Gemini provider failed; manual review is required before confirmation.",
      ]),
      downgradeReasons: uniqueStrings([
        ...deterministic.downgradeReasons,
        "Gemini provider failed before trusted schema validation.",
      ]),
      suggestedAction: "Manual review required because Gemini provider output was unavailable.",
    };

    return {
      triage,
      providerMetadata: finalizeProviderMetadata(providerMetadata, "failed", "failed", failureCode),
      validationErrors: [],
    };
  }

  const firstValidation = validateGeminiTriageOutput(rawOutput);
  let repairedValidation = firstValidation;
  let repairedOutput = rawOutput;
  let repairAttempted = false;

  if (!firstValidation.ok && repair) {
    repairAttempted = true;
    repairedOutput = repair(rawOutput, firstValidation.errors);
    repairedValidation = validateGeminiTriageOutput(repairedOutput);
  }

  if (!repairedValidation.ok) {
    const deterministic = assignFitEvidenceTriage({ ...candidate, manualReviewRequired: true });
    const providerFailure: ProviderFailureMetadata = {
      provider: GEMINI_PROVIDER_METADATA.provider,
      model: GEMINI_PROVIDER_METADATA.model,
      failureCode: "gemini-output-schema-invalid",
      repairAttempted,
      validationErrors: repairedValidation.errors,
    };
    const triage: TriageResult = {
      ...deterministic,
      bucket: deterministic.bucket === "rejected" ? "rejected" : "review-needed",
      status: deterministic.bucket === "rejected" ? "success" : "failed",
      providerFailure,
      concerns: uniqueStrings([
        ...deterministic.concerns,
        "Gemini triage output failed schema validation and needs manual review.",
      ]),
      downgradeReasons: uniqueStrings([
        ...deterministic.downgradeReasons,
        "Gemini triage output failed schema validation.",
      ]),
      suggestedAction: "Manual review required because Gemini output could not be validated.",
    };

    return {
      triage,
      providerMetadata: finalizeProviderMetadata(
        providerMetadata,
        "failed",
        "failed",
        providerFailure.failureCode,
      ),
      validationErrors: repairedValidation.errors,
    };
  }

  const aiOutput = repairedValidation.output;
  const deterministic = assignFitEvidenceTriage(candidate);
  const triage: TriageResult = {
    ...deterministic,
    evidence: mergeEvidence(deterministic.evidence, aiOutput.evidence),
    reasons: uniqueStrings([...deterministic.reasons, ...aiOutput.reasons]),
    concerns: uniqueStrings([...deterministic.concerns, ...aiOutput.concerns]),
    suggestedAction: deterministic.suggestedAction,
  };

  return {
    triage,
    providerMetadata: finalizeProviderMetadata(providerMetadata, "success", "passed"),
    validationErrors: firstValidation.ok ? [] : firstValidation.errors,
  };
}

function finalizeProviderMetadata(
  metadata: AiProviderAttemptMetadata,
  status: "success" | "failed",
  schemaValidation: "passed" | "failed",
  failureCode?: string,
): AiProviderAttemptMetadata {
  return withDefined<AiProviderAttemptMetadata>({
    ...metadata,
    status,
    completedAt: metadata.completedAt ?? new Date().toISOString(),
    schemaValidation,
    failureCode,
  });
}
