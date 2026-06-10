import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_IMAGES_PER_LISTING } from "./listings";
import {
  ACQUISITION_ARTIFACT_CONTRACT,
  ACQUISITION_CLASSIFICATIONS,
  buildAcquisitionProof,
  classifyGuardrailViolation,
  enforceDeterministicHardConstraints,
  writeAcquisitionProofArtifacts,
} from "./acquisition";

describe("G2A acquisition proof harness", () => {
  it("defines artifact, manifest, fixture, retention, and future D1/R2 contracts", () => {
    expect(ACQUISITION_ARTIFACT_CONTRACT.schemaVersion).toBe(
      "g2a-acquisition-artifact-contract-v1",
    );
    expect(ACQUISITION_ARTIFACT_CONTRACT.roots.raw.rootKind).toBe("raw-local");
    expect(ACQUISITION_ARTIFACT_CONTRACT.roots.sanitized.rootKind).toBe("sanitized-committed");
    expect(ACQUISITION_ARTIFACT_CONTRACT.futureStorageBoundaries).toMatchObject({
      d1: expect.objectContaining({
        owns: expect.arrayContaining(["run manifests", "candidate metadata"]),
      }),
      r2: expect.objectContaining({
        owns: expect.arrayContaining(["raw Firecrawl payloads", "screenshots"]),
      }),
    });
    expect(ACQUISITION_ARTIFACT_CONTRACT.redaction).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appliesTo: "api keys and auth headers",
          action: "never persist",
        }),
        expect.objectContaining({
          appliesTo: "email samples",
          action: "sanitize sender/recipient",
        }),
      ]),
    );
  });

  it("runs fixture mode without API keys and emits source classifications exactly from the accepted gate set", () => {
    const proof = buildAcquisitionProof({ mode: "fixture", now: "2026-06-07T00:00:00.000Z" });
    const allowed = new Set(ACQUISITION_CLASSIFICATIONS);

    expect(proof.manifest.mode).toBe("fixture");
    expect(proof.manifest.apiKeyAvailability).toMatchObject({
      firecrawl: false,
      gemini: false,
      realtyapi: false,
    });
    expect(proof.sourceClassifications.every((item) => allowed.has(item.classification))).toBe(
      true,
    );
    expect(proof.sourceClassifications.map((item) => item.sourceKey)).toEqual(
      expect.arrayContaining([
        "nybits-firecrawl-public-detail",
        "openigloo-firecrawl-public-detail",
        "streeteasy-realtyapi-pasted-url",
        "streeteasy-realtyapi-daily-search",
        "zillow-user-mediated-fallback",
        "osm-overpass-amenities",
        "maplibre-openfreemap-render",
        "zillow-hidden-api-guardrail",
      ]),
    );
    expect(
      proof.sourceClassifications.find((item) => item.sourceKey === "zillow-hidden-api-guardrail")
        ?.classification,
    ).toBe("policy_disallowed");
  });

  it("normalizes Firecrawl, StreetEasy, Zillow manual, Gemini, open-context, and map proof outputs", () => {
    const proof = buildAcquisitionProof({ mode: "fixture", now: "2026-06-07T00:00:00.000Z" });

    expect(proof.candidates.some((candidate) => candidate.source === "nybits")).toBe(true);
    expect(proof.candidates.some((candidate) => candidate.source === "openigloo")).toBe(true);
    expect(
      proof.candidates.filter((candidate) => candidate.source === "streeteasy").length,
    ).toBeGreaterThanOrEqual(3);
    expect(proof.candidates.some((candidate) => candidate.source === "zillow")).toBe(true);
    expect(proof.openContext.amenities.at(0)).toMatchObject({
      provider: "osm-overpass",
      attribution: expect.any(String),
    });
    expect(proof.mapProof).toMatchObject({
      provider: "maplibre-openfreemap",
      renderMode: "fixture-static-spec",
    });

    for (const candidate of proof.candidates) {
      expect(candidate.sourceUrl).toMatch(/^https:\/\//);
      expect(candidate.visibleFacts.length).toBeGreaterThan(0);
      expect(candidate.quotedEvidence.length).toBeGreaterThan(0);
      expect(candidate.extractionMetadata).toMatchObject({
        mode: "fixture",
        capturedAt: "2026-06-07T00:00:00.000Z",
      });
      expect(candidate.aiAnalysis.providerMetadata).toMatchObject({
        provider: "google-direct",
        model: "gemini-3.5-flash",
      });
      expect(candidate.aiAnalysis.imageCount).toBeLessThanOrEqual(MAX_IMAGES_PER_LISTING);
    }
  });

  it("enforces hard constraints after AI output and records provider metadata", () => {
    const proof = buildAcquisitionProof({ mode: "fixture", now: "2026-06-07T00:00:00.000Z" });
    const overBudget = proof.candidates.find(
      (candidate) => candidate.sourceListingId === "se-daily-over-budget",
    )!;

    expect(overBudget.aiAnalysis.rawAiBucket).toBe("confirmed-match");
    expect(overBudget.aiAnalysis.finalBucket).toBe("rejected");
    expect(overBudget.aiAnalysis.hardConstraintFailures).toEqual(
      expect.arrayContaining(["rent-over-budget"]),
    );
    expect(
      enforceDeterministicHardConstraints({
        rent: 15100,
        bedrooms: 5,
        bathrooms: 2,
        occupancyType: "whole-apartment",
        isNycRental: true,
        rawAiBucket: "confirmed-match",
      }),
    ).toMatchObject({ finalBucket: "rejected", hardConstraintFailures: ["rent-over-budget"] });
  });

  it("keeps uncertain proof candidates in review-needed instead of confirmed", () => {
    const proof = buildAcquisitionProof({ mode: "fixture", now: "2026-06-07T00:00:00.000Z" });
    const byListingId = new Map(
      proof.candidates.map((candidate) => [candidate.sourceListingId, candidate]),
    );

    expect(byListingId.get("se-pasted-flatiron-5")?.aiAnalysis.finalBucket).toBe("confirmed-match");
    expect(byListingId.get("5062766")?.aiAnalysis.finalBucket).toBe("review-needed");
    expect(byListingId.get("se-daily-east-village")?.aiAnalysis.finalBucket).toBe("review-needed");
    expect(byListingId.get("zillow-fixture-zpid")?.aiAnalysis.finalBucket).toBe("review-needed");
  });

  it("captures raw and sanitized artifacts with parseable summaries", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "g2a-proof-"));

    try {
      const proof = buildAcquisitionProof({ mode: "fixture", now: "2026-06-07T00:00:00.000Z" });
      const written = writeAcquisitionProofArtifacts(proof, { outputRoot });
      const summary = JSON.parse(readFileSync(written.summaryPath, "utf8"));
      const candidates = JSON.parse(readFileSync(written.normalizedCandidatesPath, "utf8"));

      expect(summary.classifications).toMatchObject({ success: expect.any(Number) });
      expect(summary.gemini.provider).toBe("google-direct");
      expect(candidates.length).toBe(proof.candidates.length);
      expect(written.artifactPaths.some((artifactPath) => artifactPath.includes("raw"))).toBe(true);
      expect(written.artifactPaths.some((artifactPath) => artifactPath.includes("sanitized"))).toBe(
        true,
      );
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("classifies disallowed broad crawling, hidden APIs, login scraping, and anti-bot bypass", () => {
    for (const attemptedAction of [
      "broad-crawl-zillow-search-results",
      "hidden-api-graphql-query",
      "login-scrape-saved-homes",
      "captcha-or-anti-bot-bypass",
    ] as const) {
      expect(classifyGuardrailViolation(attemptedAction)).toMatchObject({
        classification: "policy_disallowed",
        failureCode: expect.stringMatching(/policy-disallowed/),
      });
    }
  });
});
