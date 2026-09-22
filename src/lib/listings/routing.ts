import type {
  IntakeKind,
  ProviderRoute,
  ProviderRoutingMetadata,
  SourceTarget,
  SourceType,
  UrlValidationResult,
} from "./domain";
import { PREFERRED_NEIGHBORHOODS, PROHIBITED_SOURCE_AUTOMATION } from "./config";

export function validateApartmentUrl(rawUrl: string): UrlValidationResult {
  const trimmedUrl = rawUrl.trim();

  if (!trimmedUrl) {
    return {
      ok: false,
      errorCode: "empty-url",
      feedback: "Paste a valid apartment listing URL before saving.",
    };
  }

  let url: URL;

  try {
    url = new URL(trimmedUrl);
  } catch {
    return {
      ok: false,
      errorCode: "invalid-url",
      feedback: "Enter a valid apartment listing URL, including http:// or https://.",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      errorCode: "unsupported-protocol",
      feedback: "Only http:// and https:// apartment listing URLs can be saved.",
    };
  }

  url.hash = "";
  url.searchParams.sort();

  return { ok: true, normalizedUrl: url.toString() };
}

export function normalizeUrl(rawUrl: string): string {
  const validation = validateApartmentUrl(rawUrl);

  if (!validation.ok) {
    throw new TypeError(validation.feedback);
  }

  return validation.normalizedUrl;
}

export function classifySource(rawUrl: string): SourceType {
  const hostname = new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();

  if (hostname.endsWith("streeteasy.com")) {
    return "streeteasy";
  }

  if (hostname.endsWith("zillow.com")) {
    return "zillow";
  }

  if (hostname.endsWith("renthop.com")) {
    return "renthop";
  }

  if (hostname.endsWith("craigslist.org")) {
    return "craigslist";
  }

  return "other";
}

export function getSourceTarget(source: SourceType): SourceTarget {
  return source === "streeteasy" || source === "zillow" ? "first-class" : "fallback";
}

export function getProviderRoute(source: SourceType, intakeKind: IntakeKind): ProviderRoute {
  if (source === "streeteasy" && intakeKind === "batch-search") {
    return "streeteasy-realtyapi-batch-search";
  }

  if (source === "streeteasy") {
    return "streeteasy-realtyapi-url-resolution";
  }

  if (source === "zillow") {
    return "zillow-provider-or-manual-fallback";
  }

  return "generic-source-or-manual-fallback";
}

export function createProviderRoutingMetadata(
  source: SourceType,
  intakeKind: IntakeKind,
): ProviderRoutingMetadata {
  const sourceTarget = getSourceTarget(source);
  const providerRoute = getProviderRoute(source, intakeKind);
  const base = {
    source,
    sourceTarget,
    providerRoute,
    intakeKind,
    fallback: "editable-manual-needed-stub" as const,
    prohibitedAutomation: [...PROHIBITED_SOURCE_AUTOMATION],
  };

  if (source === "streeteasy") {
    return {
      ...base,
      primaryProvider: "realtyapi",
      manualFallbackRequired: false,
      resolutionSteps:
        intakeKind === "batch-search"
          ? [
              "call-realtyapi-search-rent",
              "skip-group-seen-or-triaged-candidates",
              "fetch-realtyapi-rental_detailsbyid",
            ]
          : [
              "parse-streeteasy-url-path",
              "infer-location-candidates-with-nyc-geosearch",
              "scan-realtyapi-search-rent-for-exact-urlpath",
              "fetch-realtyapi-rental_detailsbyid",
            ],
      notes:
        "StreetEasy pasted URLs route first through NYC GeoSearch-assisted RealtyAPI URL resolution; no source-page automation is attempted here.",
    };
  }

  if (source === "zillow") {
    return {
      ...base,
      primaryProvider: "provider-proof-pending",
      manualFallbackRequired: true,
      resolutionSteps: ["record-zillow-url", "queue-provider-proof-or-manual-entry"],
      notes:
        "Zillow is a first-class source target, but the app records provider/manual fallback metadata until a bounded provider integration is implemented.",
    };
  }

  return {
    ...base,
    primaryProvider: "none",
    manualFallbackRequired: true,
    resolutionSteps: ["classify-source", "create-editable-manual-needed-stub"],
    notes:
      "Unsupported or blocked sources are saved as editable manual-needed stubs without credentials, CAPTCHA bypass, login automation, or abusive traffic.",
  };
}

export function createDuplicateKey(rawUrl: string): string {
  const url = new URL(normalizeUrl(rawUrl));
  const path = url.pathname.replace(/\/$/, "").toLowerCase();

  return `${url.hostname.replace(/^www\./, "").toLowerCase()}${path}`;
}

export function createGroupScopedDuplicateKey(groupId: string, rawUrl: string): string {
  return `${groupId}:${createDuplicateKey(rawUrl)}`;
}

export function inferStreetEasyLocationCandidates(parsedUrlPath: string): string[] {
  const normalizedPath = parsedUrlPath.toLowerCase();
  const candidates = new Set<string>();

  for (const neighborhood of PREFERRED_NEIGHBORHOODS) {
    if (normalizedPath.includes(neighborhood.replace(/\s+/g, "-"))) {
      candidates.add(neighborhood);
    }
  }

  if (normalizedPath.includes("new_york") || normalizedPath.includes("manhattan")) {
    candidates.add("manhattan");
  }

  return [...candidates];
}
