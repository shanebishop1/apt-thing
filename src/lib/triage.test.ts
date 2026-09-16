import { describe, expect, it } from "vitest";
import { createAiProviderAttemptMetadata } from "./listings";
import {
  AI_TRIAGE_SCHEMA_VERSION,
  FIT_EVIDENCE_RUBRIC,
  assignFitEvidenceTriage,
  assertTriageInvariants,
  createSourceEvidenceDisplayContract,
  handleGeminiTriageOutput,
  type TriageCandidateInput,
  type TriageResult,
} from "./triage";

const baseSourceUrl = "https://streeteasy.com/building/confirmed-five-bed/1";

function evidence(sourceUrl = baseSourceUrl, quote = "5 beds, 2 baths, entire apartment") {
  return [
    {
      factor: "bedrooms" as const,
      claim: "Listing describes a real five-bedroom layout.",
      quote,
      sourceUrl,
      artifactPointer: {
        kind: "api-payload" as const,
        pointerId: "r2://fixture/confirmed-five-bed.json",
        storageOwner: "r2" as const,
      },
    },
  ];
}

function candidate(overrides: Partial<TriageCandidateInput> = {}): TriageCandidateInput {
  const sourceUrl = overrides.sourceUrl ?? baseSourceUrl;

  return {
    ownership: {
      groupId: "nyc-5br-2026",
      runId: "run-fit-evidence-fixture",
      listingId: "listing-fit-evidence-fixture",
    },
    source: "streeteasy",
    sourceName: "StreetEasy",
    sourceUrl,
    intakeKind: "batch-search",
    userQualified: false,
    title: "Confirmed Flatiron five bed",
    address: "30 West 21st Street",
    neighborhood: "Flatiron",
    borough: "Manhattan",
    rent: 14950,
    bedrooms: 5,
    bathrooms: 2,
    availableAt: "2026-08-01",
    listingStatus: "active",
    description: "Full-floor whole apartment with 5 bedrooms and 2 baths.",
    evidence: evidence(sourceUrl),
    ...overrides,
  };
}

describe("fit/evidence triage core", () => {
  it("defines the accepted hard-constraint rubric and review-only checks", () => {
    expect(AI_TRIAGE_SCHEMA_VERSION).toBe("fit-evidence-v1");
    expect(FIT_EVIDENCE_RUBRIC.hardConstraints).toMatchObject({
      bedroom: { minimum: 5, flexHighConfidenceThreshold: 0.9 },
      bathrooms: { minimum: 2 },
      maxRent: 15000,
      wholeApartmentNycRental: true,
      moveIn: { target: "2026-08-01", acceptableMonths: ["2026-07", "2026-08", "2026-09"] },
    });
    expect(FIT_EVIDENCE_RUBRIC.reviewOnlyChecks).toEqual(
      expect.arrayContaining([
        "missing-required-field",
        "low-confidence-flex-layout",
        "ambiguous-whole-apartment",
        "zillow-provider-proof-pending",
        "non-first-class-public-source",
        "brooklyn-queens-exceptional-fallback",
      ]),
    );
    expect(FIT_EVIDENCE_RUBRIC.preferredManhattanNeighborhoods).toEqual(
      expect.arrayContaining(["Chelsea", "Flatiron", "NoMad", "East Village"]),
    );
  });

  it("confirms StreetEasy and high-confidence flex matches with confidence, evidence, and ownership", () => {
    const confirmed = assignFitEvidenceTriage(candidate());
    const flex = assignFitEvidenceTriage(
      candidate({
        title: "High-confidence convertible five bed",
        bedrooms: 4,
        layoutType: "flex",
        realFiveBedroomConfidence: 0.91,
        evidence: evidence(
          baseSourceUrl,
          "Floorplan and photos support a convertible 5 bedroom layout.",
        ),
      }),
    );

    for (const result of [confirmed, flex]) {
      expect(result.bucket).toBe("confirmed-match");
      expect(result.deterministicHardConstraints.every((check) => check.status === "pass")).toBe(
        true,
      );
      expect(result.confidence.overall).toBeGreaterThanOrEqual(0.8);
      expect(result.confidence.factors.bedrooms).toBeGreaterThanOrEqual(0.85);
      expect(result.evidence[0]).toMatchObject({
        quote: expect.any(String),
        sourceUrl: expect.stringContaining("https://"),
        artifactPointer: expect.objectContaining({ pointerId: expect.any(String) }),
      });
      expect(result.ownership).toEqual(
        expect.objectContaining({ groupId: "nyc-5br-2026", runId: "run-fit-evidence-fixture" }),
      );
      assertTriageInvariants(result);
    }
  });

  it("routes low-confidence flex and missing meaningful fields to review-needed", () => {
    expect(
      assignFitEvidenceTriage(
        candidate({ bedrooms: 4, layoutType: "flex", realFiveBedroomConfidence: 0.7 }),
      ).bucket,
    ).toBe("review-needed");

    expect(
      assignFitEvidenceTriage(
        candidate({
          bedrooms: 4,
          layoutType: "convertible",
          realFiveBedroomConfidence: 0.89,
          evidence: evidence(
            baseSourceUrl,
            "Convertible floorplan may work as five rooms, but proof is not conclusive.",
          ),
        }),
      ).bucket,
    ).toBe("review-needed");

    for (const partial of [
      candidate({ bedrooms: undefined }),
      candidate({ bathrooms: undefined }),
      candidate({ rent: undefined }),
    ]) {
      const result = assignFitEvidenceTriage(partial);
      expect(result.bucket).toBe("review-needed");
      expect(result.concerns.join(" ")).toMatch(/Missing|unknown/i);
      assertTriageInvariants(result);
    }
  });

  it("routes proof-like uncertainty to review-needed while keeping clear proof matches confirmed", () => {
    const flatironProof = assignFitEvidenceTriage(candidate());
    const missingMoveInProof = assignFitEvidenceTriage(
      candidate({
        sourceUrl: "https://streeteasy.com/building/daily-east-village-five-bed/2",
        title: "Daily East Village five bed",
        neighborhood: "East Village",
        borough: "Manhattan",
        rent: 13800,
        bedrooms: 5,
        bathrooms: 2,
        availableAt: undefined,
        evidence: evidence(
          "https://streeteasy.com/building/daily-east-village-five-bed/2",
          "search/rent East Village sort=newest returned active 5BR with 2 baths.",
        ),
      }),
    );
    const brooklynFallbackProof = assignFitEvidenceTriage(
      candidate({
        sourceUrl: "https://streeteasy.com/building/152-manhattan-avenue-brooklyn/4b",
        title: "152 Manhattan Avenue #4B",
        neighborhood: "Williamsburg",
        borough: "Brooklyn",
        rent: 10150,
        bedrooms: 6,
        bathrooms: 2,
        availableAt: "2026-08-01",
        exceptionalFallbackEvidence: true,
        evidence: evidence(
          "https://streeteasy.com/building/152-manhattan-avenue-brooklyn/4b",
          "RealtyAPI fixture matched 6 beds, 2 baths, $10,150 in Williamsburg.",
        ),
      }),
    );

    expect(flatironProof.bucket).toBe("confirmed-match");
    expect(missingMoveInProof.bucket).toBe("review-needed");
    expect(missingMoveInProof.downgradeReasons.join(" ")).toMatch(/Move-in date is missing/i);
    expect(brooklynFallbackProof.bucket).toBe("review-needed");
    expect(brooklynFallbackProof.downgradeReasons.join(" ")).toMatch(/fallback/i);
  });

  it("rejects deterministic non-matches and preserves user-qualified pasted records for history", () => {
    const cases: Array<[Partial<TriageCandidateInput>, RegExp]> = [
      [{ rent: 15001 }, /above/i],
      [{ listingStatus: "off-market" }, /off-market|unavailable/i],
      [
        { occupancyType: "room-share", userQualified: true, intakeKind: "pasted-url" },
        /room share/i,
      ],
      [{ stayType: "short-term" }, /short-term/i],
      [{ scamSignal: "confirmed" }, /scam/i],
      [{ wholeApartment: false }, /not a whole-apartment/i],
    ];

    for (const [overrides, reasonPattern] of cases) {
      const result = assignFitEvidenceTriage(candidate(overrides));
      expect(result.bucket).toBe("rejected");
      expect([...result.rejectionReasons, ...result.concerns].join(" ")).toMatch(reasonPattern);
      expect(result.shouldPersist).toBe(true);
      assertTriageInvariants(result);
    }
  });

  it("rejects room-share and short-term non-matches inferred from listing text", () => {
    const roomShare = assignFitEvidenceTriage(
      candidate({
        description: "Room share available in a 5 bedroom apartment near Union Square.",
      }),
    );
    const shortTerm = assignFitEvidenceTriage(
      candidate({
        description: "Short-term weekly stay for a full-floor 5 bedroom apartment.",
      }),
    );

    expect(roomShare.bucket).toBe("rejected");
    expect(roomShare.rejectionReasons.join(" ")).toMatch(/room share/i);
    expect(shortTerm.bucket).toBe("rejected");
    expect(shortTerm.rejectionReasons.join(" ")).toMatch(/short-term/i);
  });

  it("keeps preferred Manhattan confirmed and Brooklyn/Queens/public-source fallbacks review-needed", () => {
    expect(assignFitEvidenceTriage(candidate({ neighborhood: "Chelsea" })).bucket).toBe(
      "confirmed-match",
    );

    const brooklyn = assignFitEvidenceTriage(
      candidate({
        sourceUrl: "https://streeteasy.com/building/exceptional-williamsburg/1",
        neighborhood: "Williamsburg",
        borough: "Brooklyn",
        exceptionalFallbackEvidence: true,
        rent: 10150,
        bedrooms: 6,
        evidence: evidence(
          "https://streeteasy.com/building/exceptional-williamsburg/1",
          "Exceptional 6BR Williamsburg fit under budget with transit context.",
        ),
      }),
    );
    expect(brooklyn.bucket).toBe("review-needed");
    expect(brooklyn.downgradeReasons.join(" ")).toMatch(/Brooklyn|fallback/i);

    for (const source of ["zillow", "nybits", "openigloo", "public-source"] as const) {
      const result = assignFitEvidenceTriage(
        candidate({
          source,
          sourceName: source,
          sourceUrl: `https://${source}.example/listing/1`,
          manualReviewRequired: true,
          evidence: evidence(
            `https://${source}.example/listing/1`,
            `${source} public/manual fixture`,
          ),
        }),
      );
      expect(result.bucket).toBe("review-needed");
      expect(result.evidence[0]?.sourceUrl).toContain(source);
      assertTriageInvariants(result);
    }
  });

  it("validates Gemini output, repairs once, and prevents LLM override of hard constraints", () => {
    let repairs = 0;
    const overBudget = candidate({ rent: 16000 });
    const raw = {
      schemaVersion: AI_TRIAGE_SCHEMA_VERSION,
      bucket: "confirmed-match",
      confidence: { overall: 0.99, factors: { bedrooms: 0.99, rent: 0.99 } },
      reasons: ["LLM says it fits"],
      concerns: [],
      evidence: evidence(overBudget.sourceUrl),
      suggestedAction: "Save as confirmed",
    };

    const result = handleGeminiTriageOutput({
      candidate: overBudget,
      rawOutput: { bucket: "bad-bucket" },
      providerMetadata: createAiProviderAttemptMetadata("fit-triage"),
      repair: () => {
        repairs += 1;
        return raw;
      },
    });

    expect(repairs).toBe(1);
    expect(result.triage.bucket).toBe("rejected");
    expect(result.triage.rejectionReasons.join(" ")).toMatch(/above/i);
    expect(result.providerMetadata).toMatchObject({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      schemaValidation: "passed",
      status: "success",
    });
    assertTriageInvariants(result.triage);
  });

  it("routes unrepaired malformed Gemini output to manual review with provider failure metadata", () => {
    const result = handleGeminiTriageOutput({
      candidate: candidate(),
      rawOutput: { schemaVersion: "wrong", bucket: "confirmed-match", evidence: [] },
      providerMetadata: createAiProviderAttemptMetadata("fit-triage"),
      repair: () => ({ schemaVersion: "still-wrong" }),
    });

    expect(result.triage.bucket).toBe("review-needed");
    expect(result.triage.providerFailure).toMatchObject({
      provider: "google-direct",
      model: "gemini-3.5-flash",
      failureCode: "gemini-output-schema-invalid",
      repairAttempted: true,
    });
    expect(result.providerMetadata).toMatchObject({
      status: "failed",
      schemaValidation: "failed",
      failureCode: "gemini-output-schema-invalid",
    });
    assertTriageInvariants(result.triage);
  });

  it("exports a parser-independent evidence display contract for downstream surfaces", () => {
    const triage = assignFitEvidenceTriage(candidate());
    const contract = createSourceEvidenceDisplayContract(triage);

    expect(contract.consumers).toEqual(["saved-list", "map-detail", "group-review", "briefing"]);
    expect(contract.fields).toMatchObject({
      whyItFits: expect.any(Array),
      concerns: expect.any(Array),
      confidence: expect.objectContaining({ overall: triage.confidence.overall }),
      sourceLinks: expect.arrayContaining([baseSourceUrl]),
      evidenceQuotes: expect.arrayContaining([expect.stringContaining("5 beds")]),
      artifactPointers: expect.arrayContaining([
        expect.objectContaining({ pointerId: expect.any(String) }),
      ]),
      downgradeHistory: expect.any(Array),
      rejectionHistory: expect.any(Array),
    });
    expect(JSON.stringify(contract)).not.toMatch(/urlPath|RealtyAPI|parser/i);
  });

  it("fails drift guardrails for invalid confirmed, missing evidence, and absent ownership", () => {
    const confirmed = assignFitEvidenceTriage(candidate());
    const violating: TriageResult = {
      ...confirmed,
      deterministicHardConstraints: confirmed.deterministicHardConstraints.map((check) =>
        check.factor === "rent" ? { ...check, status: "fail", reason: "Over budget" } : check,
      ),
    };
    const noEvidence: TriageResult = { ...confirmed, evidence: [] };
    const noOwnership: TriageResult = {
      ...confirmed,
      ownership: { ...confirmed.ownership, groupId: "" },
    };

    expect(() => assertTriageInvariants(violating)).toThrow(/confirmed.*hard constraint/i);
    expect(() => assertTriageInvariants(noEvidence)).toThrow(/evidence/i);
    expect(() => assertTriageInvariants(noOwnership)).toThrow(/ownership/i);
  });
});
