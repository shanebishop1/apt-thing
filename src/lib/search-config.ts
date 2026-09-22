/** Edit this file, then rebuild/redeploy. Shared by discovery, extraction and triage. */
export const SEARCH_CONFIG = {
  minBedrooms: 5,
  minBathrooms: 2,
  maxRent: 15000,
  flexHighConfidenceThreshold: 0.9,
  moveIn: {
    target: "2026-08-01",
    acceptableMonths: ["2026-07", "2026-08", "2026-09"],
  },
  preferredNeighborhoods: [
    "Chelsea",
    "Flatiron",
    "NoMad",
    "East Village",
    "Lower East Side",
    "Greenwich Village",
    "Nolita",
    "SoHo",
  ],
  exceptionalFallback: {
    boroughs: ["Brooklyn", "Queens"],
    maxRent: 12000,
  },
} as const;
