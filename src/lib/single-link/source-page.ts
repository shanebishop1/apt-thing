import { fetchWithRetry } from "../providers/http";
import { isRecord, withDefined } from "../utils/records";
import { uniqueStrings } from "../utils/text";
import type { SourcePageMetadata, SourcePageResult } from "./types";

export async function fetchSourcePage(
  url: string,
  fetchImpl: typeof fetch,
): Promise<SourcePageResult> {
  try {
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          "User-Agent": "apt-thing/1.0 apartment-search-link-extraction",
          Accept:
            "text/html,application/xhtml+xml,application/json;q=0.8,text/plain;q=0.7,*/*;q=0.1",
        },
      },
      { fetchImpl },
    );

    if (!response.ok) {
      return {
        ok: false,
        failureCode: `source-page-http-${response.status}`,
        failureMessage: `Source page returned HTTP ${response.status}.`,
      };
    }

    const html = await response.text();
    const metadata = extractSourcePageMetadata(html, url);
    const text = stripHtml(html).slice(0, 24000);
    if (!text.trim()) {
      return {
        ok: false,
        failureCode: "source-page-empty",
        failureMessage: "Source page did not contain extractable text.",
      };
    }

    return { ok: true, text, metadata };
  } catch (error) {
    return {
      ok: false,
      failureCode: "source-page-fetch-failed",
      failureMessage: error instanceof Error ? error.message : "Source page fetch failed.",
    };
  }
}

export function extractSourcePageMetadata(html: string, sourceUrl: string): SourcePageMetadata {
  const jsonLd = extractJsonLdObjects(html);
  const text = stripHtml(html);
  const title =
    firstString([
      ...jsonLd.flatMap((item) => [item.name, item.headline]),
      getMetaContent(html, "og:title"),
      getTitleTag(html),
    ]) ?? "Manual review needed";
  const address = firstString([
    ...jsonLd.flatMap((item) => addressFromJsonLd(item.address)),
    matchFirst(
      text,
      /\b\d{1,6}\s+[A-Z][A-Za-z0-9 .'-]+?,\s*(?:Manhattan|New York|NY|Brooklyn|Queens|Bronx|Staten Island)[^0-9\n]{0,8}\s?\d{5}?/,
    ),
  ]);
  const rent = firstNumber([
    ...jsonLd.flatMap((item) => [item.offers?.price, item.price, item.lowPrice]),
    parseMoney(matchFirst(text, /\$\s?\d[\d,]*(?:\.\d{2})?/)),
  ]);
  const bedrooms = firstNumber([
    ...jsonLd.flatMap((item) => [item.numberOfRooms, item.bedrooms]),
    extractRoomCount(text, "bedrooms"),
  ]);
  const bathrooms = firstNumber([
    ...jsonLd.flatMap((item) => [item.bathroomsTotal, item.bathrooms]),
    extractRoomCount(text, "bathrooms"),
  ]);
  const photos = uniqueStrings([
    ...jsonLd.flatMap((item) => imageUrlsFromValue(item.image)),
    getMetaContent(html, "og:image"),
    ...extractImageUrls(html),
  ]).slice(0, 12);
  const description = firstString([
    ...jsonLd.flatMap((item) => [item.description]),
    getMetaContent(html, "description"),
    getMetaContent(html, "og:description"),
  ]);

  const cleanedAddress = cleanExtractedAddress(address, title);

  return withDefined<SourcePageMetadata>({
    title,
    ...(cleanedAddress !== undefined ? { address: cleanedAddress } : {}),
    neighborhood: inferNeighborhood(text),
    borough: inferBorough(text),
    ...(rent !== undefined ? { rent } : {}),
    ...(bedrooms !== undefined ? { bedrooms } : {}),
    ...(bathrooms !== undefined ? { bathrooms } : {}),
    ...(description !== undefined ? { description } : {}),
    photos,
    evidence: [
      {
        claim: "Source metadata extracted from listing page",
        quote: [title, cleanedAddress, rent ? `$${rent}` : undefined].filter(Boolean).join(" | "),
        sourceUrl,
      },
    ],
  });
}

export function detectSourceContentMismatch(
  sourceUrl: string,
  metadata: SourcePageMetadata,
): string | undefined {
  const expectedTitle = sourceUrlTitle(sourceUrl);
  const actualTitle = metadata.title;

  if (!expectedTitle || !actualTitle || titleSimilarity(expectedTitle, actualTitle) >= 0.35) {
    return undefined;
  }

  return `Fetched source page title "${actualTitle}" does not match submitted URL slug "${expectedTitle}".`;
}

export function sourceUrlTitle(sourceUrl: string): string | undefined {
  try {
    const pathname = new URL(sourceUrl).pathname.replace(/\/$/, "");
    const slug = pathname.split("/").filter(Boolean).at(-1);
    if (!slug || /^[a-z0-9]{5,}$/i.test(slug)) return undefined;

    return slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return undefined;
  }
}

export function cleanExtractedAddress(
  address: string | undefined,
  title: string,
): string | undefined {
  if (!address) return undefined;
  const normalizedTitle = title.trim();
  const deduplicated = stripDuplicatedTitlePrefix(
    address
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    normalizedTitle,
  );
  const cleaned =
    normalizedTitle && !startsWithTitle(deduplicated, normalizedTitle)
      ? deduplicated
          .replace(new RegExp(escapeRegExp(normalizedTitle), "gi"), " ")
          .replace(/\s+/g, " ")
          .trim()
      : deduplicated;

  const canonicalAddresses = [
    ...cleaned.matchAll(/\d{1,6}\s+[A-Za-z .'-]+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}/g),
  ].map((match) => match[0]);
  const canonicalAddress = canonicalAddresses.at(-1);
  if (canonicalAddress) return canonicalAddress.replace(/,\s*NY\s*NY/, ", NY");

  return cleaned || undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonLdObjects(html: string): Array<Record<string, any>> {
  const matches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  return [...matches].flatMap((match) => {
    try {
      const parsed = JSON.parse(match[1]?.trim() ?? "null") as unknown;
      if (Array.isArray(parsed)) return parsed.filter(isRecord);
      if (isRecord(parsed) && Array.isArray(parsed["@graph"]))
        return parsed["@graph"].filter(isRecord);
      return isRecord(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

function getMetaContent(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
  );
  return decodeHtml(match?.[1]);
}

function getTitleTag(html: string): string | undefined {
  return decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " "));
}

function extractImageUrls(html: string): string[] {
  return [
    ...html.matchAll(
      /https?:\\?\/\\?\/[^"'\s>]+?(?:\.(?:jpg|jpeg|png|webp)|\/[^"'\s>]*apartments?-[^"'\s>]*)(?:\?[^"'\s>]*)?/gi,
    ),
  ]
    .map((match) => normalizeImageUrl(match[0]))
    .filter(isLikelyListingPhoto);
}

function imageUrlsFromValue(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(imageUrlsFromValue);
  if (isRecord(value)) return imageUrlsFromValue(value.url ?? value.contentUrl);
  return [];
}

function addressFromJsonLd(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!isRecord(value)) return [];
  return [
    [value.streetAddress, value.addressLocality, value.addressRegion, value.postalCode]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .join(", "),
  ];
}

function startsWithTitle(address: string, title: string): boolean {
  return address.toLowerCase().startsWith(title.toLowerCase());
}

function stripDuplicatedTitlePrefix(address: string, title: string): string {
  if (!title) return address;
  const escaped = escapeRegExp(title);
  return address.replace(new RegExp(`^${escaped}\\s*[-|:,]?\\s*(?=${escaped})`, "i"), "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SPELLED_BEDROOMS = /(\d+(?:\.\d+)?)\s*(?:beds?|bedrooms?)\b/gi;
const SPELLED_BATHROOMS = /(\d+(?:\.\d+)?)\s*(?:baths?|bathrooms?)\b/gi;
const ABBREVIATED_UNIT_MIX =
  /(\d+(?:\.\d+)?)\s*(?:br|bd)\b[\s,/|-]{0,3}(\d+(?:\.\d+)?)\s*(?:ba|baths?|bathrooms?)\b/gi;

function extractRoomCount(text: string, room: "bedrooms" | "bathrooms"): number | undefined {
  const spelled = room === "bedrooms" ? SPELLED_BEDROOMS : SPELLED_BATHROOMS;
  return (
    singleDistinctMatch(text, spelled, 1) ??
    singleDistinctMatch(text, ABBREVIATED_UNIT_MIX, room === "bedrooms" ? 1 : 2)
  );
}

function singleDistinctMatch(text: string, pattern: RegExp, group: number): number | undefined {
  const values = new Set<number>();
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[group]);
    if (Number.isFinite(value) && value > 0) values.add(value);
  }

  return values.size === 1 ? [...values][0] : undefined;
}

function decodeHtml(value?: string): string | undefined {
  return value
    ?.replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizeImageUrl(value: string): string {
  return value.replaceAll("\\/", "/").replaceAll("\\u002F", "/");
}

export function isLikelyListingPhoto(value: string): boolean {
  const lower = value.toLowerCase();
  if (
    lower.includes("icon-") ||
    lower.includes("/icon") ||
    lower.includes("profilepictures") ||
    lower.includes("avatar") ||
    lower.includes("star") ||
    lower.includes("logo")
  ) {
    return false;
  }

  return (
    lower.includes("photos.zillowstatic.com") ||
    lower.includes("/fp/") ||
    lower.includes("apartment") ||
    lower.includes("building") ||
    lower.includes("hero") ||
    lower.includes("gallery") ||
    /\.(?:avif|jpe?g|png|webp)(?:[?#]|$)/.test(lower)
  );
}

function inferNeighborhood(text: string): string | undefined {
  return firstString(
    ["Financial District", "Chelsea", "Upper West Side", "East Village"].filter((name) =>
      text.includes(name),
    ),
  );
}

export function inferBorough(text: string): string | undefined {
  return firstString(
    ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"].filter((name) =>
      text.includes(name),
    ),
  );
}

function firstString(values: unknown[]): string | undefined {
  return values
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()))
    ?.trim();
}

function firstNumber(values: unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
}

function matchFirst(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[0];
}

function parseMoney(value?: string): number | undefined {
  return value ? Number(value.replace(/[^\d.]/g, "")) || undefined : undefined;
}

function titleSimilarity(expected: string, actual: string): number {
  const expectedTokens = tokenSet(expected);
  const actualTokens = tokenSet(actual);
  const overlap = [...expectedTokens].filter((token) => actualTokens.has(token)).length;

  return overlap / Math.max(expectedTokens.size, 1);
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && token !== "apartments"),
  );
}
