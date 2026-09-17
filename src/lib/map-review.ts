import type { ListingCandidate, TriageBucket } from "./listings";
import { withDefined } from "./utils/records";

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
  createContext("325 East 14 Street", 40.7317, -73.9841, "East Village", "preferred-manhattan", [
    ["1 Av", ["L"], 220],
    ["3 Av", ["L"], 520],
  ]),
  createContext("205 Avenue A", 40.7301, -73.9834, "East Village", "preferred-manhattan", [
    ["1 Av", ["L"], 320],
    ["3 Av", ["L"], 640],
  ]),
  createContext("58 2nd Avenue", 40.7254, -73.9901, "East Village", "preferred-manhattan", [
    ["2 Av", ["F"], 360],
    ["Bleecker St", ["6"], 610],
  ]),
  createContext("54 2nd Avenue", 40.7252, -73.9902, "East Village", "preferred-manhattan", [
    ["2 Av", ["F"], 340],
    ["Bleecker St", ["6"], 630],
  ]),
  createContext("176 Stanton Street", 40.7209, -73.9845, "Lower East Side", "preferred-manhattan", [
    ["Delancey St-Essex St", ["F", "M", "J", "Z"], 410],
    ["2 Av", ["F"], 730],
  ]),
  createContext(
    "171 Attorney Street",
    40.7193,
    -73.9843,
    "Lower East Side",
    "preferred-manhattan",
    [["Delancey St-Essex St", ["F", "M", "J", "Z"], 450]],
  ),
  createContext("247 Mulberry Street", 40.7234, -73.9954, "Nolita", "preferred-manhattan", [
    ["Bleecker St", ["6"], 340],
    ["Broadway-Lafayette St", ["B", "D", "F", "M"], 410],
  ]),
  createContext("171 6th Avenue", 40.7258, -74.0046, "Hudson Square", "preferred-manhattan", [
    ["Spring St", ["C", "E"], 160],
    ["Houston St", ["1"], 420],
  ]),
  createContext("71 Broadway", 40.7075, -74.0126, "Financial District", "preferred-manhattan", [
    ["Wall St", ["4", "5"], 80],
    ["Rector St", ["R", "W"], 220],
  ]),
];

const contextByTitle = new Map(mapContextFixtures.map((fixture) => [fixture.listingId, fixture]));
const knownAddressListingIds: readonly (readonly [address: string, listingId: string])[] = [
  ["42 West 21st Street", "42 West 21st Street #5"],
  ["100 West 14th Street", "100 West 14th Street"],
  ["152 Manhattan Avenue", "152 Manhattan Avenue #4B"],
  ["303 West 21st Street", "New Chelsea five bed batch candidate"],
  ["185 North 10th Street", "Review-needed Williamsburg batch candidate"],
  ["325 East 14 Street", "325 East 14 Street"],
  ["325 East 14th Street", "325 East 14 Street"],
  ["205 Avenue A", "205 Avenue A"],
  ["58 2nd Avenue", "58 2nd Avenue"],
  ["54 2nd Avenue", "54 2nd Avenue"],
  ["176 Stanton Street", "176 Stanton Street"],
  ["171 Attorney Street", "171 Attorney Street"],
  ["247 Mulberry Street", "247 Mulberry Street"],
  ["171 6th Avenue", "171 6th Avenue"],
  ["71 Broadway", "71 Broadway"],
];

const contextByKnownAddress = new Map(
  knownAddressListingIds
    .map(([address, listingId]) => {
      const normalizedAddress = normalizeAddress(address);
      const fixture = contextByTitle.get(listingId);

      return normalizedAddress && fixture ? [normalizedAddress, fixture] : undefined;
    })
    .filter((entry): entry is [string, MapContextFixture] => Boolean(entry)),
);

export function createMapReviewModel(
  listings: ListingCandidate[],
  selectedId?: string,
): MapReviewModel {
  const candidates = listings.map((listing) => toMapReviewCandidate(listing));
  const selected =
    candidates.find((candidate) => candidate.listing.id === selectedId) ?? candidates[0];
  const locatedCandidates = candidates.filter((candidate) => candidate.coordinates);
  const missingLocationCandidates = candidates.filter((candidate) => !candidate.coordinates);

  return withDefined<MapReviewModel>({
    candidates,
    locatedCandidates,
    missingLocationCandidates,
    selected,
    bounds: createBounds(locatedCandidates),
    attribution:
      "Map data © OpenStreetMap contributors. Subway routes/stations use the public MTA Subway Routes & Stops FeatureServer derived from MTA GTFS feeds.",
    viewport: nycMapViewport,
    mobileModes: ["map", "list", "detail"],
  });
}

function toMapReviewCandidate(listing: ListingCandidate): MapReviewCandidate {
  const fixture = resolveMapContext(listing);
  const coordinates = resolveListingCoordinates(listing) ?? fixture.coordinates;
  const evidence = listing.evidence[0];
  const sourceLinks = Array.from(
    new Set([listing.url, ...listing.evidence.map((item) => item.sourceUrl)].filter(Boolean)),
  );

  return withDefined<MapReviewCandidate>({
    listing,
    coordinates,
    mapPosition: coordinates ? projectToMapPosition(coordinates) : undefined,
    pinState: coordinates ? toPinState(listing.triageBucket) : "missing-location",
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
  });
}

function resolveListingCoordinates(listing: ListingCandidate): MapCoordinates | undefined {
  const latitude = listing.location?.latitude;
  const longitude = listing.location?.longitude;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return undefined;
  }

  return { latitude, longitude };
}

function resolveMapContext(listing: ListingCandidate): MapContextFixture {
  return (
    contextByTitle.get(listing.title) ??
    resolveKnownAddressContext(listing.address) ??
    createFallbackContext(listing)
  );
}

function resolveKnownAddressContext(address?: string): MapContextFixture | undefined {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) return undefined;

  const exactMatch = contextByKnownAddress.get(normalizedAddress);
  if (exactMatch) return exactMatch;

  return [...contextByKnownAddress.entries()].find(([knownAddress]) =>
    normalizedAddress.startsWith(`${knownAddress} `),
  )?.[1];
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

function normalizeAddress(address?: string): string {
  if (!address) return "";

  return address
    .toLowerCase()
    .split(",")[0]!
    .replace(/#.*$/u, "")
    .replace(/\b(?:apartment|apt|unit|suite|ste|floor|fl)\b.*$/u, "")
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/gu, "$1")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\b(w)\b/gu, "west")
    .replace(/\b(e)\b/gu, "east")
    .replace(/\b(n)\b/gu, "north")
    .replace(/\b(s)\b/gu, "south")
    .replace(/\b(st)\b/gu, "street")
    .replace(/\b(ave|av)\b/gu, "avenue")
    .replace(/\b(nyc|ny|new york)\b/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
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
