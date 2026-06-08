import type { ListingCandidate, TriageBucket } from "./listings";

export type MapCoordinates = {
  latitude: number;
  longitude: number;
};

export type MapContextFixture = {
  listingId: string;
  coordinates?: MapCoordinates;
  zone: {
    label: string;
    kind: "preferred-manhattan" | "exceptional-fallback" | "outer-borough" | "unknown";
    boroughFallback: string;
  };
  subway: {
    station: string;
    routes: string[];
    distanceMeters: number;
    source: string;
  }[];
  amenities: {
    name: string;
    kind: "grocery" | "park" | "pharmacy" | "laundry" | "other";
    distanceMeters: number;
    source: string;
    coordinates?: MapCoordinates;
  }[];
};

export type MapReviewCandidate = {
  listing: ListingCandidate;
  coordinates?: MapCoordinates;
  mapPosition?: MapPosition;
  pinState: "confirmed" | "review" | "rejected" | "untriaged" | "missing-location";
  zoneLabel: string;
  zoneKind: MapContextFixture["zone"]["kind"];
  boroughFallback: string;
  subway: MapContextFixture["subway"];
  contextAmenities: MapContextFixture["amenities"];
  evidenceSummary: string;
  concernSummary: string;
  confidenceLabel: string;
  sourceLinks: string[];
};

export type MapReviewModel = {
  candidates: MapReviewCandidate[];
  locatedCandidates: MapReviewCandidate[];
  missingLocationCandidates: MapReviewCandidate[];
  selected?: MapReviewCandidate;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  attribution: string;
  viewport: MapViewport;
  mobileModes: readonly ["map", "list", "detail"];
};

export type MapPosition = {
  left: number;
  top: number;
};

export type MapViewport = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export const nycMapViewport: MapViewport = {
  north: 40.775,
  south: 40.69,
  east: -73.91,
  west: -74.03,
};

const mapContextFixtures: MapContextFixture[] = [
  createContext(
    "42 West 21st Street #5",
    40.7412,
    -73.9927,
    "Flatiron / Chelsea",
    "preferred-manhattan",
    [
      ["23 St", ["F", "M"], 230],
      ["14 St", ["1", "2", "3"], 520],
    ],
  ),
  createContext("100 West 14th Street", 40.7374, -73.9967, "Chelsea", "preferred-manhattan", [
    ["14 St", ["1", "2", "3"], 180],
    ["6 Av", ["F", "M", "L"], 320],
  ]),
  createContext(
    "152 Manhattan Avenue #4B",
    40.7116,
    -73.9455,
    "Williamsburg",
    "exceptional-fallback",
    [
      ["Graham Av", ["L"], 410],
      ["Lorimer St", ["L"], 690],
    ],
  ),
  createContext(
    "Zillow manual fixture — 100 West 14th Street",
    40.7374,
    -73.9967,
    "Chelsea",
    "preferred-manhattan",
    [["14 St", ["1", "2", "3"], 180]],
  ),
  createContext(
    "NYBits-style fallback fixture",
    40.7487,
    -74.0021,
    "Hudson Yards / Chelsea",
    "preferred-manhattan",
    [["34 St-Hudson Yards", ["7"], 360]],
  ),
  createContext(
    "New Chelsea five bed batch candidate",
    40.7463,
    -74.001,
    "Chelsea",
    "preferred-manhattan",
    [["23 St", ["C", "E"], 450]],
  ),
  createContext(
    "Review-needed Williamsburg batch candidate",
    40.7142,
    -73.955,
    "Williamsburg",
    "exceptional-fallback",
    [["Bedford Av", ["L"], 610]],
  ),
];

const contextByTitle = new Map(mapContextFixtures.map((fixture) => [fixture.listingId, fixture]));

export function createMapReviewModel(
  listings: ListingCandidate[],
  selectedId?: string,
): MapReviewModel {
  const candidates = listings.map((listing) => toMapReviewCandidate(listing));
  const selected =
    candidates.find((candidate) => candidate.listing.id === selectedId) ?? candidates[0];
  const locatedCandidates = candidates.filter((candidate) => candidate.coordinates);
  const missingLocationCandidates = candidates.filter((candidate) => !candidate.coordinates);

  return {
    candidates,
    locatedCandidates,
    missingLocationCandidates,
    selected,
    bounds: createBounds(locatedCandidates),
    attribution:
      "Map data © OpenStreetMap contributors. Subway routes/stations use the public MTA Subway Routes & Stops FeatureServer derived from MTA GTFS feeds.",
    viewport: nycMapViewport,
    mobileModes: ["map", "list", "detail"],
  };
}

function toMapReviewCandidate(listing: ListingCandidate): MapReviewCandidate {
  const fixture = contextByTitle.get(listing.title) ?? createFallbackContext(listing);
  const evidence = listing.evidence[0];
  const sourceLinks = Array.from(
    new Set([listing.url, ...listing.evidence.map((item) => item.sourceUrl)].filter(Boolean)),
  );

  return {
    listing,
    coordinates: fixture.coordinates,
    mapPosition: fixture.coordinates ? projectToMapPosition(fixture.coordinates) : undefined,
    pinState: fixture.coordinates ? toPinState(listing.triageBucket) : "missing-location",
    zoneLabel: fixture.zone.label,
    zoneKind: fixture.zone.kind,
    boroughFallback: fixture.zone.boroughFallback,
    subway: fixture.subway,
    contextAmenities: fixture.amenities,
    evidenceSummary: evidence
      ? `${evidence.claim}: ${evidence.quote}`
      : "No evidence captured yet.",
    concernSummary:
      listing.concerns.length > 0
        ? listing.concerns.slice(0, 2).join(" · ")
        : "No concerns recorded.",
    confidenceLabel: toConfidenceLabel(listing.triageBucket),
    sourceLinks,
  };
}

export function projectToMapPosition(
  coordinates: MapCoordinates,
  viewport: MapViewport = nycMapViewport,
): MapPosition {
  const left = ((coordinates.longitude - viewport.west) / (viewport.east - viewport.west)) * 100;
  const top = ((viewport.north - coordinates.latitude) / (viewport.north - viewport.south)) * 100;

  return {
    left: clamp(left, 0, 100),
    top: clamp(top, 0, 100),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toPinState(bucket: TriageBucket): MapReviewCandidate["pinState"] {
  if (bucket === "confirmed-match") return "confirmed";
  if (bucket === "review-needed") return "review";
  if (bucket === "rejected") return "rejected";
  return "untriaged";
}

function toConfidenceLabel(bucket: TriageBucket): string {
  if (bucket === "confirmed-match") return "High confidence";
  if (bucket === "review-needed") return "Needs roommate review";
  if (bucket === "rejected") return "Low fit confidence";
  return "Untriaged confidence";
}

function createFallbackContext(listing: ListingCandidate): MapContextFixture {
  return {
    listingId: listing.title,
    zone: {
      label: listing.neighborhood ?? "Location pending",
      kind: listing.borough === "Manhattan" ? "preferred-manhattan" : "unknown",
      boroughFallback: listing.borough ?? "Borough pending",
    },
    subway: [],
    amenities: [],
  };
}

function createContext(
  listingId: string,
  latitude: number,
  longitude: number,
  label: string,
  kind: MapContextFixture["zone"]["kind"],
  subway: [string, string[], number][],
): MapContextFixture {
  return {
    listingId,
    coordinates: { latitude, longitude },
    zone: {
      label,
      kind,
      boroughFallback:
        kind === "exceptional-fallback" ? "Brooklyn fallback" : "Manhattan preferred zone",
    },
    subway: subway.map(([station, routes, distanceMeters]) => ({
      station,
      routes,
      distanceMeters,
      source: "fixture:mta-open-data-style",
    })),
    amenities: [],
  };
}

function createBounds(candidates: MapReviewCandidate[]): MapReviewModel["bounds"] {
  if (candidates.length === 0) return undefined;

  const latitudes = candidates.map((candidate) => candidate.coordinates!.latitude);
  const longitudes = candidates.map((candidate) => candidate.coordinates!.longitude);

  return {
    north: Math.max(...latitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    west: Math.min(...longitudes),
  };
}
