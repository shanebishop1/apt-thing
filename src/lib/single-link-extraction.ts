import {
  calculateFitFlags,
  classifySource,
  createAiProviderAttemptMetadata,
  createListingFromUrl,
  createSavedListDisplayFields,
  type FieldProvenance,
  type InviteIdentity,
  type ListingCandidate,
  type ListingDraft,
  type ListingEvidence,
} from "./listings";
import { safeJson } from "./utils/json";
import { firstRecord, isRecord, numberField, stringField } from "./utils/records";
import { titleCase, uniqueStrings } from "./utils/text";

export type SingleLinkExtractionEnv = {
  GEMINI_API_KEY?: string;
  REALTYAPI_KEY?: string;
  REALTYAPI_BASE_URL?: string;
};

export type LiveSingleLinkExtractionResult = {
  listing: ListingCandidate;
  extraction: {
    ok: boolean;
    sourcePageFetched: boolean;
    providerCalled: boolean;
    failureCode?: string;
    failureMessage?: string;
    rawText?: string;
  };
};

type GeminiListingExtraction = ListingDraft & {
  evidence: ListingEvidence[];
  concerns: string[];
  confidence: number;
};

type SourcePageMetadata = ListingDraft & {
  title?: string;
  evidence: ListingEvidence[];
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

const extractionPromptVersion = "single-link-url-extraction-v1";
const extractionModels = ["gemini-2.5-flash", "gemini-3.5-flash"] as const;
const streetEasyBoroughSuffixes = ["brooklyn", "manhattan", "queens", "bronx", "staten-island"];

export async function extractListingFromUrlLive({
  rawUrl,
  identity,
  env,
  fetchImpl = fetch,
}: {
  rawUrl: string;
  identity: InviteIdentity;
  env?: SingleLinkExtractionEnv;
  fetchImpl?: typeof fetch;
}): Promise<LiveSingleLinkExtractionResult> {
  const initialListing = createListingFromUrl(rawUrl, identity, { title: "Manual review needed" });
  if (classifySource(initialListing.url) === "streeteasy") {
    const streetEasyResult = await extractStreetEasyViaRealtyApi({
      rawUrl: initialListing.url,
      identity,
      env,
      fetchImpl,
    });

    if (streetEasyResult) {
      return streetEasyResult;
    }
  }

  const sourcePage = await fetchSourcePage(initialListing.url, fetchImpl);

  if (!sourcePage.ok) {
    return {
      listing: markManualNeeded(initialListing, sourcePage.failureCode, sourcePage.failureMessage),
      extraction: {
        ok: false,
        sourcePageFetched: false,
        providerCalled: false,
        failureCode: sourcePage.failureCode,
        failureMessage: sourcePage.failureMessage,
      },
    };
  }

  const mismatch = detectSourceContentMismatch(initialListing.url, sourcePage.metadata);
  if (mismatch) {
    return {
      listing: markManualNeeded(
        createListingFromUrl(rawUrl, identity, { title: sourceUrlTitle(initialListing.url) }),
        "source-page-content-mismatch",
        mismatch,
      ),
      extraction: {
        ok: false,
        sourcePageFetched: true,
        providerCalled: false,
        failureCode: "source-page-content-mismatch",
        failureMessage: mismatch,
      },
    };
  }

  const apiKey = env?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      listing: markExtractionFailed(
        createListingFromUrl(rawUrl, identity, sourcePage.metadata),
        "gemini-api-key-missing",
        "GEMINI_API_KEY is not set.",
      ),
      extraction: {
        ok: false,
        sourcePageFetched: true,
        providerCalled: false,
        failureCode: "gemini-api-key-missing",
        failureMessage: "GEMINI_API_KEY is not set.",
      },
    };
  }

  const geminiResult = await callGeminiForListingExtraction({
    apiKey,
    url: initialListing.url,
    pageText: sourcePage.text,
    fetchImpl,
  });

  if (!geminiResult.ok) {
    return {
      listing: markExtractionFailed(
        createListingFromUrl(rawUrl, identity, sourcePage.metadata),
        geminiResult.failureCode,
        geminiResult.failureMessage,
      ),
      extraction: {
        ok: false,
        sourcePageFetched: true,
        providerCalled: true,
        failureCode: geminiResult.failureCode,
        failureMessage: geminiResult.failureMessage,
        rawText: geminiResult.rawText,
      },
    };
  }

  return {
    listing: mergeExtraction(
      createListingFromUrl(rawUrl, identity, sourcePage.metadata),
      mergeDrafts(sourcePage.metadata, geminiResult.output),
    ),
    extraction: {
      ok: true,
      sourcePageFetched: true,
      providerCalled: true,
      rawText: geminiResult.rawText,
    },
  };
}

async function extractStreetEasyViaRealtyApi({
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
  return {
    listing: markManualNeeded(
      createListingFromUrl(rawUrl, identity, { title: "StreetEasy provider lookup needed" }),
      failureCode,
      failureMessage,
    ),
    extraction: {
      ok: false,
      sourcePageFetched: false,
      providerCalled: true,
      failureCode,
      failureMessage,
    },
  };
}

async function fetchSourcePage(url: string, fetchImpl: typeof fetch) {
  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "apt-thing/1.0 apartment-search-link-extraction",
        Accept: "text/html,application/xhtml+xml,application/json;q=0.8,text/plain;q=0.7,*/*;q=0.1",
      },
    });

    if (!response.ok) {
      return {
        ok: false as const,
        failureCode: `source-page-http-${response.status}`,
        failureMessage: `Source page returned HTTP ${response.status}.`,
      };
    }

    const html = await response.text();
    const metadata = extractSourcePageMetadata(html, url);
    const text = stripHtml(html).slice(0, 24000);
    if (!text.trim()) {
      return {
        ok: false as const,
        failureCode: "source-page-empty",
        failureMessage: "Source page did not contain extractable text.",
      };
    }

    return { ok: true as const, text, metadata };
  } catch (error) {
    return {
      ok: false as const,
      failureCode: "source-page-fetch-failed",
      failureMessage: error instanceof Error ? error.message : "Source page fetch failed.",
    };
  }
}

async function callGeminiForListingExtraction({
  apiKey,
  url,
  pageText,
  fetchImpl,
}: {
  apiKey: string;
  url: string;
  pageText: string;
  fetchImpl: typeof fetch;
}): Promise<
  | { ok: true; output: GeminiListingExtraction; rawText: string }
  | { ok: false; failureCode: string; failureMessage: string; rawText?: string }
> {
  const failures: Array<{ failureCode: string; failureMessage: string; rawText?: string }> = [];

  for (const model of extractionModels) {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(buildExtractionRequest(url, pageText)),
      },
    );

    if (!response.ok) {
      failures.push({
        failureCode: `gemini-${model}-http-${response.status}`,
        failureMessage: (await response.text()).slice(0, 500),
      });
      continue;
    }

    const body = (await response.json()) as GeminiGenerateContentResponse;
    const rawText = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    try {
      const parsed = JSON.parse(rawText) as Partial<GeminiListingExtraction>;
      if (typeof parsed.title !== "string" || typeof parsed.address !== "string") {
        failures.push({
          failureCode: `gemini-${model}-schema-validation-failed`,
          failureMessage: "Gemini response did not include title and address.",
          rawText,
        });
        continue;
      }

      return {
        ok: true,
        rawText,
        output: {
          title: parsed.title,
          address: parsed.address,
          neighborhood: normalizeString(parsed.neighborhood),
          borough: normalizeString(parsed.borough),
          rent: normalizeNumber(parsed.rent),
          bedrooms: normalizeNumber(parsed.bedrooms),
          bathrooms: normalizeNumber(parsed.bathrooms),
          availableAt: normalizeString(parsed.availableAt),
          description: normalizeString(parsed.description),
          amenities: normalizeStringArray(parsed.amenities),
          photos: normalizeStringArray(parsed.photos),
          evidence: normalizeEvidence(parsed.evidence, url),
          concerns: normalizeStringArray(parsed.concerns),
          confidence: normalizeNumber(parsed.confidence) ?? 0,
        },
      };
    } catch (error) {
      failures.push({
        failureCode: `gemini-${model}-json-parse-failed`,
        failureMessage: error instanceof Error ? error.message : "Gemini response was not JSON.",
        rawText,
      });
      continue;
    }
  }

  return {
    ok: false,
    failureCode: failures.at(-1)?.failureCode ?? "gemini-extraction-failed",
    failureMessage:
      failures.map((failure) => `${failure.failureCode}: ${failure.failureMessage}`).join("\n") ||
      "Gemini extraction failed.",
    rawText: failures.at(-1)?.rawText,
  };
}

function buildExtractionRequest(url: string, pageText: string) {
  return {
    contents: [
      {
        parts: [
          {
            text: [
              "Extract a real apartment listing from the provided source page text as JSON only.",
              "Use only facts present in the text. Do not invent rent, bedrooms, address, availability, photos, or amenities.",
              "If this is a building page rather than a unit page, use the building name as title and the building address if present.",
              "If the full street address is not present, set address to the most specific location phrase present on the page, never an empty value.",
              "Extract bedrooms and bathrooms when floorplan/unit mix text includes them, including ranges like studio-3 beds or 1-2 baths.",
              "Extract photo URLs from image-like source text only when the URLs are present in the text.",
              "If a field is missing, omit it or use an empty array. Evidence quotes must be verbatim snippets from the page text.",
              `Prompt version: ${extractionPromptVersion}`,
              `Source URL: ${url}`,
              pageText,
            ].join("\n"),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          address: { type: "STRING" },
          neighborhood: { type: "STRING" },
          borough: { type: "STRING" },
          rent: { type: "NUMBER" },
          bedrooms: { type: "NUMBER" },
          bathrooms: { type: "NUMBER" },
          availableAt: { type: "STRING" },
          description: { type: "STRING" },
          amenities: { type: "ARRAY", items: { type: "STRING" } },
          photos: { type: "ARRAY", items: { type: "STRING" } },
          evidence: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                claim: { type: "STRING" },
                quote: { type: "STRING" },
              },
              required: ["claim", "quote"],
            },
          },
          concerns: { type: "ARRAY", items: { type: "STRING" } },
          confidence: { type: "NUMBER" },
        },
        required: ["title", "address", "evidence", "concerns", "confidence"],
      },
    },
  };
}

function mergeExtraction(
  listing: ListingCandidate,
  output: GeminiListingExtraction,
): ListingCandidate {
  const now = new Date().toISOString();
  const nextListing = {
    ...listing,
    ...output,
    title: output.title ?? listing.title,
    address: output.address ?? listing.address,
    extractionStatus: hasUsefulExtraction(output) ? "success" : "partial",
    triageStatus: "success",
    triageBucket: "review-needed",
    fitFlags: calculateFitFlags(output, listing.url),
    evidence: output.evidence.length > 0 ? output.evidence : listing.evidence,
    concerns: output.concerns,
    fieldProvenance: createAiFieldProvenance(output, now),
    updatedAt: now,
  } satisfies Omit<ListingCandidate, "display">;

  return { ...nextListing, display: createSavedListDisplayFields(nextListing) };
}

function markManualNeeded(
  listing: ListingCandidate,
  failureCode: string,
  failureMessage: string,
): ListingCandidate {
  const now = new Date().toISOString();
  const attempt = createAiProviderAttemptMetadata("text-normalization", 0);
  const nextListing = {
    ...listing,
    extractionStatus: "manual-needed",
    triageStatus: "failed",
    triageBucket: "review-needed",
    concerns: [...listing.concerns, `${failureCode}: ${failureMessage}`],
    evidencePointers: [
      ...listing.evidencePointers,
      {
        id: attempt.attemptId,
        groupId: listing.groupId,
        listingId: listing.id,
        kind: "ai-output" as const,
        sourceUrl: listing.url,
        storage: {
          owner: "d1" as const,
          scope: "authoritative-relational" as const,
          groupScoped: true,
        },
        d1Table: "extraction_jobs" as const,
        quote: failureMessage,
        capturedAt: now,
      },
    ],
    updatedAt: now,
  } satisfies Omit<ListingCandidate, "display">;

  return { ...nextListing, display: createSavedListDisplayFields(nextListing) };
}

function markExtractionFailed(
  listing: ListingCandidate,
  failureCode: string,
  failureMessage: string,
): ListingCandidate {
  return hasUsefulListingMetadata(listing)
    ? markPartialExtraction(listing, failureCode, failureMessage)
    : markManualNeeded(listing, failureCode, failureMessage);
}

function markPartialExtraction(
  listing: ListingCandidate,
  failureCode: string,
  failureMessage: string,
): ListingCandidate {
  const now = new Date().toISOString();
  const nextListing = {
    ...listing,
    extractionStatus: "partial" as const,
    triageStatus: "partial" as const,
    triageBucket: "review-needed" as const,
    concerns: [...listing.concerns, `${failureCode}: ${failureMessage}`],
    fitFlags: calculateFitFlags(listing, listing.url),
    updatedAt: now,
  } satisfies Omit<ListingCandidate, "display">;

  return { ...nextListing, display: createSavedListDisplayFields(nextListing) };
}

function hasUsefulListingMetadata(listing: ListingCandidate): boolean {
  return Boolean(
    listing.title !== "Manual review needed" &&
    listing.address !== "Unknown address" &&
    (listing.rent || listing.bedrooms || listing.bathrooms || listing.photos.length > 0),
  );
}

function hasUsefulExtraction(output: GeminiListingExtraction): boolean {
  return Boolean(
    output.title && output.address && (output.rent || output.bedrooms || output.photos?.length),
  );
}

function createAiFieldProvenance(output: ListingDraft, updatedAt: string): FieldProvenance[] {
  return (
    ["title", "address", "neighborhood", "rent", "bedrooms", "bathrooms", "availableAt"] as const
  )
    .filter((field) => output[field] !== undefined)
    .map((field) => ({
      field,
      source: "ai-extracted",
      editedValue: String(output[field]),
      actor: "gemini-3.5-flash",
      updatedAt,
    }));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSourcePageMetadata(html: string, sourceUrl: string): SourcePageMetadata {
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
    parseNumber(matchFirst(text, /(\d+(?:\.\d+)?)\s*(?:beds?|bedrooms?|br)\b/i)),
  ]);
  const bathrooms = firstNumber([
    ...jsonLd.flatMap((item) => [item.bathroomsTotal, item.bathrooms]),
    parseNumber(matchFirst(text, /(\d+(?:\.\d+)?)\s*(?:baths?|bathrooms?|ba)\b/i)),
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

  return {
    title,
    address: cleanedAddress,
    neighborhood: inferNeighborhood(text),
    borough: inferBorough(text),
    rent,
    bedrooms,
    bathrooms,
    description,
    photos,
    evidence: [
      {
        claim: "Source metadata extracted from listing page",
        quote: [title, cleanedAddress, rent ? `$${rent}` : undefined].filter(Boolean).join(" | "),
        sourceUrl,
      },
    ],
  };
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

function cleanExtractedAddress(address: string | undefined, title: string): string | undefined {
  if (!address) return undefined;
  let cleaned = address
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    title &&
    /#[A-Za-z0-9]+/.test(title) &&
    cleaned.toLowerCase().startsWith(title.toLowerCase()) &&
    cleaned.includes(",")
  ) {
    return cleaned;
  }
  const titlePattern = new RegExp(escapeRegExp(title), "gi");
  cleaned = cleaned.replace(titlePattern, " ").replace(/\s+/g, " ").trim();

  const canonicalAddresses = [
    ...cleaned.matchAll(/\d{1,6}\s+[A-Za-z .'-]+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}/g),
  ].map((match) => match[0]);
  const canonicalAddress = canonicalAddresses.at(-1);
  if (canonicalAddress) return canonicalAddress.replace(/,\s*NY\s*NY/, ", NY");

  return cleaned || undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeDrafts(
  metadata: SourcePageMetadata,
  output: GeminiListingExtraction,
): GeminiListingExtraction {
  const title = output.title ?? metadata.title;
  return {
    title,
    address:
      cleanExtractedAddress(output.address ?? metadata.address, title ?? "") ??
      output.address ??
      metadata.address,
    neighborhood: output.neighborhood ?? metadata.neighborhood,
    borough: output.borough ?? metadata.borough,
    rent: output.rent ?? metadata.rent,
    bedrooms: output.bedrooms ?? metadata.bedrooms,
    bathrooms: output.bathrooms ?? metadata.bathrooms,
    availableAt: output.availableAt ?? metadata.availableAt,
    description: output.description ?? metadata.description,
    amenities: output.amenities?.length ? output.amenities : (metadata.amenities ?? []),
    photos: output.photos?.length ? output.photos : (metadata.photos ?? []),
    evidence: output.evidence.length ? output.evidence : metadata.evidence,
    concerns: output.concerns,
    confidence: output.confidence,
  };
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

function parseNumber(value?: string): number | undefined {
  return value ? Number(value.match(/\d+(?:\.\d+)?/)?.[0]) || undefined : undefined;
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

function isLikelyListingPhoto(value: string): boolean {
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

function inferBorough(text: string): string | undefined {
  return firstString(
    ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"].filter((name) =>
      text.includes(name),
    ),
  );
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.clone().text()).slice(0, 500);
  } catch {
    return "Provider request failed.";
  }
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

function parseStreetEasyPath(path: string):
  | {
      address: string;
      borough: string;
      addressQuery: string;
    }
  | undefined {
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

  return {
    address,
    borough,
    addressQuery: `${address} ${borough} NY`,
  };
}

function pushUniqueString(values: string[], value: string | undefined) {
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

/** Unlike the shared reader, this one also unwraps `{ url | src | href }` image objects. */
function stringArrayField(record: Record<string, unknown>, names: string[]): string[] {
  for (const name of names) {
    const value = record[name];
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        if (typeof item === "string") return [item];
        if (isRecord(item)) return imageUrlsFromValue(item.url ?? item.src ?? item.href);
        return [];
      });
    }
  }
  return [];
}

function realtyApiRecordToDraft(record: Record<string, unknown>, sourceUrl: string): ListingDraft {
  const title = stringField(record, ["title", "name", "display_address"]);
  const details = isRecord(record.propertyDetails) ? record.propertyDetails : undefined;
  const nestedAddress = details && isRecord(details.address) ? details.address : undefined;
  const nestedAddressText = nestedAddress ? formatNestedAddress(nestedAddress) : undefined;
  const address =
    nestedAddressText ??
    stringField(record, ["address", "display_address", "streetAddress", "street_address"]) ??
    streetEasyAddressFromUrl(sourceUrl);
  const urlAddress = streetEasyAddressFromUrl(sourceUrl);
  const normalizedAddress = selectStreetEasyAddress(address, urlAddress);
  const pricing = isRecord(record.pricing) ? record.pricing : undefined;
  const media = isRecord(record.media) ? record.media : undefined;
  const amenities = details && isRecord(details.amenities) ? details.amenities : undefined;
  const features = details && isRecord(details.features) ? details.features : undefined;
  return {
    title: title ?? address,
    address: normalizedAddress
      ? cleanExtractedAddress(normalizedAddress, title ?? "StreetEasy listing")
      : undefined,
    neighborhood: stringField(record, ["neighborhood", "area"]),
    borough:
      stringField(record, ["borough", "city"]) ?? inferBorough(`${address ?? ""} ${sourceUrl}`),
    rent:
      numberField(record, ["rent", "price", "monthlyRent", "monthly_rent"]) ??
      numberField(pricing ?? {}, ["price"]),
    bedrooms:
      numberField(record, ["bedrooms", "beds", "bedroom_count"]) ??
      numberField(details ?? {}, ["bedroomCount"]),
    bathrooms:
      numberField(record, ["bathrooms", "baths", "bathroom_count"]) ??
      numberField(details ?? {}, ["fullBathroomCount"]),
    availableAt: stringField(record, [
      "availableAt",
      "available_at",
      "availableDate",
      "availability",
    ]),
    description: stringField(record, ["description", "details"]),
    amenities: uniqueStrings([
      ...stringArrayField(record, ["amenities"]),
      ...stringArrayField(amenities ?? {}, ["list"]),
      ...stringArrayField(features ?? {}, ["list"]),
    ]),
    photos: uniqueStrings([
      ...stringArrayField(record, ["photos", "images", "image_urls", "photo_urls"]),
      ...stringArrayField(media ?? {}, ["photos"]),
    ]).filter(isLikelyListingPhoto),
    sourceListingId: stringField(record, ["listingId", "listing_id", "id"]),
  };
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

function detectSourceContentMismatch(
  sourceUrl: string,
  metadata: SourcePageMetadata,
): string | undefined {
  const expectedTitle = sourceUrlTitle(sourceUrl);
  const actualTitle = metadata.title;

  if (!expectedTitle || !actualTitle) {
    return undefined;
  }

  if (titleSimilarity(expectedTitle, actualTitle) >= 0.35) {
    return undefined;
  }

  return `Fetched source page title "${actualTitle}" does not match submitted URL slug "${expectedTitle}".`;
}

function sourceUrlTitle(sourceUrl: string): string | undefined {
  try {
    const pathname = new URL(sourceUrl).pathname.replace(/\/$/, "");
    const slug = pathname.split("/").filter(Boolean).at(-1);
    if (!slug || /^[a-z0-9]{5,}$/i.test(slug)) {
      return undefined;
    }

    return slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return undefined;
  }
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

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeEvidence(value: unknown, sourceUrl: string): ListingEvidence[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<ListingEvidence>;
    return typeof record.claim === "string" && typeof record.quote === "string"
      ? [{ claim: record.claim, quote: record.quote, sourceUrl }]
      : [];
  });
}
