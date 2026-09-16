import type {
  StreetEasyBatchFixture,
  StreetEasyDetailsFixture,
  StreetEasySearchResultFixture,
} from "../extraction";
import {
  firstRecord,
  isRecord,
  numberField,
  stringArrayField,
  stringField,
} from "../utils/records";
import { uniqueStrings } from "../utils/text";

/**
 * Normalization for RealtyAPI's StreetEasy payloads, whose shape varies by endpoint: search
 * results, detail records, and the nested containers each provider revision has used.
 */

export function buildRealtyApiUrl(
  baseUrl: string,
  endpoint: "/search/rent" | "/rental_detailsbyid",
  params: StreetEasyBatchFixture["query"] | { buildingid: string },
) {
  const url = new URL(`${baseUrl}${endpoint}`);
  if ("buildingid" in params) {
    url.searchParams.set("buildingid", params.buildingid);
    return url.toString();
  }

  url.searchParams.set("location", params.areas[0] ?? "NYC and NJ");
  url.searchParams.set("sort_by", params.sort === "newest" ? "Newest" : (params.sort ?? "Newest"));
  url.searchParams.set("page", String(params.page ?? 1));
  return url.toString();
}

export function uniqueStreetEasyResults(results: StreetEasySearchResultFixture[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.listingId)) return false;
    seen.add(result.listingId);
    return true;
  });
}

export function isPlausibleStreetEasySearchResult(
  result: StreetEasySearchResultFixture,
  fallback: StreetEasyBatchFixture,
) {
  const details = result.details;
  const address = details.address?.trim();
  return (
    Boolean(address && address !== "Unknown address") &&
    (details.bedrooms === undefined || details.bedrooms >= (fallback.query.minBeds ?? 0)) &&
    (details.rent === undefined ||
      details.rent <= (fallback.query.maxRent ?? Number.POSITIVE_INFINITY))
  );
}

export function normalizeStreetEasySearchPayload(
  payload: unknown,
  fallback: StreetEasyBatchFixture,
): StreetEasySearchResultFixture[] {
  const records = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.results)
      ? payload.results
      : isRecord(payload) && Array.isArray(payload.listings)
        ? payload.listings
        : isRecord(payload) && isRecord(payload.search_results)
          ? realtyApiListingNodes(payload.search_results)
          : isRecord(payload) && Array.isArray(payload.data)
            ? payload.data
            : [];
  return records.flatMap((record, index) => {
    if (!isRecord(record)) return [];
    const listingId = stringField(record, ["listingId", "listing_id", "id", "buildingid"]);
    const url = stringField(record, ["sourceUrl", "url", "permalink", "listing_url", "urlPath"]);
    if (!listingId || !url) return [];
    const normalizedUrl = normalizeStreetEasyUrl(url);
    const details = normalizeStreetEasyDetails(record, listingId, normalizedUrl);
    return [
      {
        listingId,
        sourceUrl: normalizedUrl,
        urlPath: new URL(normalizedUrl).pathname,
        page: numberField(record, ["page"]) ?? fallback.results[index]?.page ?? 1,
        location:
          stringField(record, ["location", "neighborhood", "area"]) ??
          fallback.results[index]?.location ??
          "NYC",
        details,
      },
    ];
  });
}

function realtyApiListingNodes(searchResults: Record<string, unknown>) {
  const listings = Array.isArray(searchResults.listings) ? searchResults.listings : [];
  return listings.flatMap((item) => (isRecord(item) && isRecord(item.node) ? [item.node] : []));
}

export function mergeStreetEasyDetails(
  searchResults: StreetEasySearchResultFixture[],
  detailPayloads: Record<string, unknown>,
  fallback: StreetEasyBatchFixture,
): StreetEasyBatchFixture | undefined {
  if (searchResults.length === 0) return undefined;
  const results = searchResults.map((result, index) => {
    const detailRecord = firstRecord(detailPayloads[result.listingId]);
    const mergedDetails = detailRecord
      ? {
          ...result.details,
          ...normalizeStreetEasyDetails(detailRecord, result.listingId, result.sourceUrl),
        }
      : result.details;
    if (!mergedDetails.photos?.length) {
      mergedDetails.photos = result.details.photos;
    }
    if (!mergedDetails.amenities?.length) {
      mergedDetails.amenities = result.details.amenities;
    }
    if (!mergedDetails.location) {
      mergedDetails.location = result.details.location;
    }
    return {
      ...result,
      page: result.page || fallback.results[index]?.page || 1,
      details: mergedDetails,
    };
  });
  return { ...fallback, results };
}

function normalizeStreetEasyDetails(
  record: Record<string, unknown>,
  listingId: string,
  sourceUrl: string,
): StreetEasyDetailsFixture {
  const address =
    stringField(record, ["address", "display_address", "streetAddress"]) ??
    streetEasySearchAddress(record) ??
    realtyApiAddress(record) ??
    "Unknown address";
  return {
    listingId,
    sourceListingId: listingId,
    sourceUrl,
    urlPath: new URL(sourceUrl).pathname,
    title: normalizeStreetEasyTitle(stringField(record, ["title", "name"]), address),
    address,
    neighborhood: stringField(record, ["neighborhood", "area", "areaName"]),
    borough: stringField(record, ["borough", "city"]) ?? realtyApiCity(record) ?? "Manhattan",
    location: realtyApiCoordinates(record),
    rent: numberField(record, ["rent", "price", "monthlyRent"]) ?? realtyApiPrice(record),
    bedrooms:
      numberField(record, ["bedrooms", "beds", "bedroomCount"]) ??
      realtyApiNestedNumber(record, "bedroomCount"),
    bathrooms: numberField(record, ["bathrooms", "baths"]) ?? realtyApiBathroomCount(record),
    availableAt: stringField(record, ["availableAt", "available_at", "availableDate"]),
    description: stringField(record, ["description", "details"]),
    amenities:
      stringArrayField(record, ["amenities"]) ??
      (isRecord(record.propertyDetails)
        ? uniqueStrings([
            ...(realtyApiStringList(record.propertyDetails, "amenities") ?? []),
            ...(realtyApiStringList(record.propertyDetails, "features") ?? []),
          ])
        : undefined),
    photos:
      stringArrayField(record, ["photos", "images", "photoUrls", "imageUrls"]) ??
      realtyApiPhotos(record),
    status: stringField(record, ["status", "propertyStatus"]),
  };
}

function normalizeStreetEasyTitle(title: string | undefined, address: string) {
  const normalizedTitle = title?.trim();
  if (normalizedTitle && normalizedTitle.toLowerCase() !== "streeteasy listing") {
    return normalizedTitle;
  }

  return address && address !== "Unknown address" ? address : "StreetEasy listing";
}

function realtyApiCoordinates(record: Record<string, unknown>) {
  const geoPoint = isRecord(record.geoPoint)
    ? record.geoPoint
    : isRecord(record.propertyDetails) && isRecord(record.propertyDetails.geoPoint)
      ? record.propertyDetails.geoPoint
      : undefined;
  if (!geoPoint) return undefined;

  const latitude = numberField(geoPoint, ["latitude", "lat"]);
  const longitude = numberField(geoPoint, ["longitude", "lng", "lon"]);
  if (latitude === undefined || longitude === undefined) return undefined;

  return { latitude, longitude };
}

function realtyApiAddress(record: Record<string, unknown>) {
  const address = isRecord(record.propertyDetails) ? record.propertyDetails.address : undefined;
  if (!isRecord(address)) return undefined;
  return [
    address.street ?? [address.houseNumber, address.streetName].filter(Boolean).join(" "),
    address.unit,
  ]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ");
}

function streetEasySearchAddress(record: Record<string, unknown>) {
  const street = stringField(record, ["street"]);
  const unit = stringField(record, ["unit"]);
  return street ? [street, unit].filter(Boolean).join(" ") : undefined;
}

function realtyApiCity(record: Record<string, unknown>) {
  const address = isRecord(record.propertyDetails) ? record.propertyDetails.address : undefined;
  return isRecord(address) && typeof address.city === "string" ? address.city : undefined;
}

function realtyApiPrice(record: Record<string, unknown>) {
  return isRecord(record.pricing) ? numberField(record.pricing, ["price"]) : undefined;
}

function realtyApiNestedNumber(record: Record<string, unknown>, field: string) {
  return isRecord(record.propertyDetails)
    ? numberField(record.propertyDetails, [field])
    : undefined;
}

function realtyApiBathroomCount(record: Record<string, unknown>) {
  const topLevelFull = numberField(record, ["fullBathroomCount"]);
  const topLevelHalf = numberField(record, ["halfBathroomCount"]);
  if (topLevelFull !== undefined || topLevelHalf !== undefined) {
    return (topLevelFull ?? 0) + (topLevelHalf ?? 0) * 0.5;
  }
  if (!isRecord(record.propertyDetails)) return undefined;
  const full = numberField(record.propertyDetails, ["fullBathroomCount"]);
  const half = numberField(record.propertyDetails, ["halfBathroomCount"]);
  return full === undefined && half === undefined ? undefined : (full ?? 0) + (half ?? 0) * 0.5;
}

function realtyApiPhotos(record: Record<string, unknown>) {
  const containers = [record.media, record.propertyDetails, record.listingDetails, record].filter(
    isRecord,
  );
  const photoArrays = containers.flatMap((container) =>
    ["photos", "images", "imageUrls", "photoUrls", "gallery"].flatMap((field) => {
      const value = container[field];
      return Array.isArray(value) ? [value] : [];
    }),
  );
  const urls = photoArrays.flatMap((photos) =>
    photos.flatMap((photo) => {
      if (typeof photo === "string") return [photo];
      if (!isRecord(photo)) return [];
      return stringField(photo, ["url", "href", "src", "source", "large", "medium", "small"]) ?? [];
    }),
  );

  return urls.length > 0 ? uniqueStrings(urls) : undefined;
}

function realtyApiStringList(record: Record<string, unknown>, container: string) {
  const value = record[container];
  if (!isRecord(value) || !Array.isArray(value.list)) return undefined;
  return value.list.filter((item): item is string => typeof item === "string" && Boolean(item));
}

function normalizeStreetEasyUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://streeteasy.com");
    return parsed.toString();
  } catch {
    return "https://streeteasy.com/";
  }
}
