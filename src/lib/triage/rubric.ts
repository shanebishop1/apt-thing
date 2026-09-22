import type { TriageBucket } from "../listings";
import { SEARCH_CONFIG } from "../search-config";

import type { TriageFactor, TriageSource } from "./types";

export const AI_TRIAGE_SCHEMA_VERSION = "fit-evidence-v1" as const;

export const FIT_EVIDENCE_RUBRIC = {
  hardConstraints: {
    bedroom: {
      minimum: SEARCH_CONFIG.minBedrooms,
      flexHighConfidenceThreshold: SEARCH_CONFIG.flexHighConfidenceThreshold,
      description: `Confirmed matches require a credible real ${SEARCH_CONFIG.minBedrooms}BR layout or high-confidence flex/convertible evidence from text, photos, or floorplan.`,
    },
    bathrooms: { minimum: SEARCH_CONFIG.minBathrooms },
    maxRent: SEARCH_CONFIG.maxRent,
    wholeApartmentNycRental: true,
    moveIn: SEARCH_CONFIG.moveIn,
  },
  preferredManhattanNeighborhoods: SEARCH_CONFIG.preferredNeighborhoods,
  exceptionalFallbackBoroughs: SEARCH_CONFIG.exceptionalFallback.boroughs,
  reviewOnlyChecks: [
    "missing-required-field",
    "low-confidence-flex-layout",
    "ambiguous-whole-apartment",
    "ambiguous-move-in-date",
    "zillow-provider-proof-pending",
    "non-first-class-public-source",
    `${SEARCH_CONFIG.exceptionalFallback.boroughs.map((borough) => borough.toLowerCase().replaceAll(" ", "-")).join("-")}-exceptional-fallback`,
  ],
  rejectionSignals: [
    "over-budget",
    "off-market-or-unavailable",
    "room-share-or-individual-room",
    "short-term-only",
    "confirmed-scam",
    "non-whole-apartment",
  ],
} as const;

export const TRIAGE_FACTORS = [
  "bedrooms",
  "bathrooms",
  "rent",
  "wholeApartment",
  "nycRental",
  "moveIn",
  "availability",
  "sourceIntegrity",
  "location",
] as const satisfies readonly TriageFactor[];

export const TRIAGE_BUCKETS = [
  "confirmed-match",
  "review-needed",
  "rejected",
] as const satisfies readonly TriageBucket[];

export const PUBLIC_MANUAL_SOURCES = new Set<TriageSource>([
  "zillow",
  "nybits",
  "openigloo",
  "public-source",
  "other",
  "craigslist",
  "renthop",
]);
