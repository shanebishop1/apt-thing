import { realtyApiRecordToListingDraft } from "../daily-loop/realtyapi";
import {
  createListingFromUrl,
  createSavedListDisplayFields,
  type InviteIdentity,
  type ListingDraft,
} from "../listings";
import { safeJson } from "../utils/json";
import { firstRecord, isRecord, stringField, withDefined } from "../utils/records";
import { titleCase } from "../utils/text";
import { cleanExtractedAddress, inferBorough, isLikelyListingPhoto } from "./source-page";
import { markManualNeeded, mergeExtraction } from "./normalization";
import type { LiveSingleLinkExtractionResult, SingleLinkExtractionEnv } from "./types";

const streetEasyBoroughSuffixes = ["brooklyn", "manhattan", "queens", "bronx", "staten-island"];

export async function extractStreetEasyViaRealtyApi({
  rawUrl,
  identity,
  env,
  fetchImpl,
}: {
  rawUrl: string;
  identity: InviteIdentity;
  env?: SingleLinkExtractionEnv;
  fetchImpl: typeof fetch;
}): Promise<LiveSingleLinkExtractionResult | undefined> {
  const apiKey = env?.REALTYAPI_KEY ?? process.env.REALTYAPI_KEY;
  if (!apiKey) return undefined;

  const baseUrl = (
    env?.REALTYAPI_BASE_URL ??
    process.env.REALTYAPI_BASE_URL ??
    "https://streeteasy.realtyapi.io"
  ).replace(/\/$/, "");
  const targetUrl = new URL(rawUrl);
  const targetPath = normalizePath(targetUrl.pathname);
  const areas = await inferStreetEasyAreas(targetUrl.pathname, fetchImpl);

  try {
    let matched: Record<string, unknown> | undefined;
    for (const area of areas) {
      for (let page = 1; page <= 5 && !matched; page += 1) {
        const searchUrl = new URL(`${baseUrl}/search/rent`);
        searchUrl.searchParams.set("location", area);
        searchUrl.searchParams.set("sort_by", "Newest");
        searchUrl.searchParams.set("page", String(page));
        const searchResponse = await fetchImpl(searchUrl, {
          headers: { "x-realtyapi-key": apiKey },
        });
        const searchPayload = await safeJson(searchResponse);
        if (!searchResponse.ok) {
          return providerFailure(
            rawUrl,
            identity,
            `realtyapi-search-http-${searchResponse.status}`,
            await safeText(searchResponse),
          );
        }

        matched = arrayRecords(searchPayload).find((record) => {
          const node = isRecord(record.node) ? record.node : record;
          const urlPath = stringField(node, ["urlPath", "url_path"]);
          const url = stringField(node, ["url", "sourceUrl", "permalink", "listing_url"]);
          return urlPath
            ? streetEasyPathMatchesTarget(normalizePath(urlPath), targetPath)
            : url
              ? streetEasyPathMatchesTarget(
                  normalizePath(new URL(url, "https://streeteasy.com").pathname),
                  targetPath,
                )
              : false;
        });
        if (matched && isRecord(matched.node)) matched = matched.node;
      }
    }

    if (!matched) {
      return providerFailure(
        rawUrl,
        identity,
        "realtyapi-no-exact-url-match",
        "RealtyAPI search did not return an exact StreetEasy URL path match.",
      );
    }

    const listingId = stringField(matched, ["listingId", "listing_id", "id"]);
    let detailRecord: Record<string, unknown> | undefined;
    if (listingId) {
      const detailUrl = new URL(`${baseUrl}/rental_detailsbyid`);
      detailUrl.searchParams.set("buildingid", listingId);
      const detailResponse = await fetchImpl(detailUrl, { headers: { "x-realtyapi-key": apiKey } });
      const detailPayload = await safeJson(detailResponse);
      if (detailResponse.ok) detailRecord = firstRecord(detailPayload);
    }

    const canonicalUrl = resolveStreetEasyMatchedUrl(matched, rawUrl);
    const draft = realtyApiRecordToDraft({ ...matched, ...detailRecord }, canonicalUrl);
    const mergedListing = mergeExtraction(createListingFromUrl(canonicalUrl, identity, draft), {
      ...draft,
      evidence: [
        {
          claim: "RealtyAPI exact StreetEasy URL match",
          quote: canonicalUrl,
          sourceUrl: canonicalUrl,
        },
      ],
      concerns: [],
      confidence: 0.9,
    });
    const correctedAddress = selectStreetEasyAddress(
      mergedListing.address,
      streetEasyAddressFromUrl(canonicalUrl),
    );
    const listing = correctedAddress
      ? {
          ...mergedListing,
          address: correctedAddress,
          display: createSavedListDisplayFields({ ...mergedListing, address: correctedAddress }),
        }
      : mergedListing;

    return {
      listing,
      extraction: { ok: true, sourcePageFetched: false, providerCalled: true },
    };
  } catch (error) {
    return providerFailure(
      rawUrl,
      identity,
      "realtyapi-fetch-failed",
      error instanceof Error ? error.message : "RealtyAPI fetch failed.",
    );
  }
}

function resolveStreetEasyMatchedUrl(
  matched: Record<string, unknown>,
  fallbackUrl: string,
): string {
  const urlPath = stringField(matched, ["urlPath", "url_path"]);
  if (urlPath) return new URL(urlPath, "https://streeteasy.com").toString();

  const url = stringField(matched, ["url", "sourceUrl", "permalink", "listing_url"]);
  if (url) return new URL(url, "https://streeteasy.com").toString();

  return fallbackUrl;
}

function providerFailure(
  rawUrl: string,
  identity: InviteIdentity,
  failureCode: string,
  failureMessage: string,
): LiveSingleLinkExtractionResult {
  const listing = markManualNeeded(
    createListingFromUrl(rawUrl, identity, { title: "StreetEasy provider lookup needed" }),
    failureCode,
    failureMessage,
  );
  return {
    listing,
    extraction: {
      ok: false,
      sourcePageFetched: false,
      providerCalled: true,
      failureCode,
      failureMessage,
    },
  };
}

async function inferStreetEasyAreas(path: string, fetchImpl: typeof fetch): Promise<string[]> {
  const parsedPath = parseStreetEasyPath(path);
  const candidates: string[] = [];

  if (parsedPath?.addressQuery) {
    try {
      const geosearchUrl = new URL("https://geosearch.planninglabs.nyc/v2/search");
      geosearchUrl.searchParams.set("text", parsedPath.addressQuery);
      geosearchUrl.searchParams.set("size", "5");
      const response = await fetchImpl(geosearchUrl);
      const payload = await safeJson(response);

      if (response.ok && isRecord(payload) && Array.isArray(payload.features)) {
        for (const feature of payload.features) {
          if (!isRecord(feature) || !isRecord(feature.properties)) continue;
          pushUniqueString(candidates, stringField(feature.properties, ["neighbourhood"]));
          pushUniqueString(candidates, stringField(feature.properties, ["borough"]));
        }
      }
    } catch {
      // Borough and city-wide fallback below keep StreetEasy imports live when GeoSearch is down.
    }
  }

  pushUniqueString(candidates, parsedPath?.borough);
  pushUniqueString(candidates, "NYC and NJ");
  return candidates.length > 0 ? candidates : ["NYC and NJ"];
}

export function parseStreetEasyPath(
  path: string,
): { address: string; borough: string; addressQuery: string } | undefined {
  const parts = path.toLowerCase().split("/").filter(Boolean);
  if (parts[0] !== "building" || !parts[1]) return undefined;

  const slugParts = parts[1].replace(/_/g, "-").split("-").filter(Boolean);
  const newYorkSuffixIndex = slugParts.length >= 2 ? slugParts.length - 2 : -1;
  const boroughIndex =
    newYorkSuffixIndex >= 0 && slugParts.slice(newYorkSuffixIndex).join("-") === "new-york"
      ? newYorkSuffixIndex
      : slugParts.findIndex((_, index) =>
          streetEasyBoroughSuffixes.includes(slugParts.slice(index).join("-")),
        );

  if (boroughIndex <= 0) return undefined;

  const address = titleCase(slugParts.slice(0, boroughIndex).join(" "));
  const boroughSlug = slugParts.slice(boroughIndex).join("-");
  const borough =
    boroughSlug === "new-york" ? "Manhattan" : titleCase(boroughSlug.replace(/-/g, " "));

  return { address, borough, addressQuery: `${address} ${borough} NY` };
}

function realtyApiRecordToDraft(record: Record<string, unknown>, sourceUrl: string): ListingDraft {
  const draft = realtyApiRecordToListingDraft(record);
  const details = isRecord(record.propertyDetails) ? record.propertyDetails : undefined;
  const nestedAddress = details && isRecord(details.address) ? details.address : undefined;
  const urlAddress = streetEasyAddressFromUrl(sourceUrl);
  const providerAddress =
    (nestedAddress ? formatNestedAddress(nestedAddress) : undefined) ?? draft.address ?? urlAddress;
  const address = selectStreetEasyAddress(providerAddress, urlAddress);
  const title = draft.title ?? address;

  return withDefined<ListingDraft>({
    ...draft,
    title,
    address: address ? cleanExtractedAddress(address, title ?? "StreetEasy listing") : undefined,
    borough:
      draft.borough ?? inferBorough(`${providerAddress ?? ""} ${address ?? ""} ${sourceUrl}`),
    photos: draft.photos?.filter(isLikelyListingPhoto),
  });
}

function formatNestedAddress(address: Record<string, unknown>): string | undefined {
  const street = [address.houseNumber, address.streetName, address.unit]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .join(" ");
  const city = typeof address.city === "string" ? address.city : undefined;
  const stateZip = [address.state, address.zipCode]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .join(" ");

  return [street, city, stateZip].filter(Boolean).join(", ") || undefined;
}

function normalizePath(path: string): string {
  return decodeURIComponent(path).replace(/\/$/, "").toLowerCase();
}

function streetEasyPathMatchesTarget(candidatePath: string, targetPath: string): boolean {
  if (candidatePath === targetPath) return true;

  const targetParts = targetPath.split("/").filter(Boolean);
  if (targetParts[0] !== "building" || targetParts.length !== 2) return false;

  return candidatePath.startsWith(`${targetPath}/`);
}

function streetEasyAddressFromUrl(sourceUrl: string): string | undefined {
  try {
    const url = new URL(sourceUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "building" || !parts[1]) return undefined;
    const slugParts = parts[1]
      .replace(/-new_york$/i, "")
      .split("-")
      .filter(Boolean);
    const unit = parts[2]?.toUpperCase();
    const street = slugParts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    return [street, unit].filter(Boolean).join(" ");
  } catch {
    return undefined;
  }
}

function selectStreetEasyAddress(
  providerAddress: string | undefined,
  urlAddress: string | undefined,
): string | undefined {
  if (!providerAddress) return urlAddress;
  if (!urlAddress) return providerAddress;

  const urlNumber = urlAddress.match(/^\d+/)?.[0];
  if (urlNumber && !providerAddress.startsWith(urlNumber)) return urlAddress;

  return providerAddress;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.clone().text()).slice(0, 500);
  } catch {
    return "Provider request failed.";
  }
}

function pushUniqueString(values: string[], value: string | undefined): void {
  if (value && !values.includes(value)) values.push(value);
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  const array = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.results)
      ? value.results
      : isRecord(value) && Array.isArray(value.listings)
        ? value.listings
        : isRecord(value) &&
            isRecord(value.search_results) &&
            Array.isArray(value.search_results.listings)
          ? value.search_results.listings
          : isRecord(value) && Array.isArray(value.data)
            ? value.data
            : [];

  return array.filter((item): item is Record<string, unknown> => isRecord(item));
}
