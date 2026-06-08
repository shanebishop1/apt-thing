import { describe, expect, it } from "vitest";
import { createInviteIdentity, defaultSearchGroup } from "./listings";
import { isAllowedInviteCode, parseApiIdentity } from "./shared-listing-api";
import { extractListingFromUrlLive } from "./single-link-extraction";

const identity = createInviteIdentity(defaultSearchGroup.inviteCode, "Verifier")!;

describe("single-link live extraction", () => {
  it("requires the single allowed invite code before API identity creation", () => {
    expect(isAllowedInviteCode(defaultSearchGroup.inviteCode)).toBe(true);
    expect(isAllowedInviteCode("wrong-code")).toBe(false);
    expect(parseApiIdentity({ inviteCode: "wrong-code", displayName: "Nope" })).toBeUndefined();
    expect(
      parseApiIdentity({ inviteCode: defaultSearchGroup.inviteCode, displayName: "Ok" }),
    ).toMatchObject({
      groupId: defaultSearchGroup.id,
      displayName: "Ok",
    });
  });

  it("uses page metadata for title, facts, photos, and evidence before Gemini output", async () => {
    const html = `
      <html>
        <head>
          <title>Test Tower Apartments</title>
          <meta property="og:image" content="https://cdn.example.com/test-tower.jpg" />
          <script type="application/ld+json">
            {
              "@type": "ApartmentComplex",
              "name": "Test Tower Apartments",
              "description": "Five bedroom homes in Chelsea.",
              "address": {"streetAddress":"123 W 20th St","addressLocality":"Manhattan","addressRegion":"NY","postalCode":"10011"},
              "image": ["https://cdn.example.com/one.jpg", "https://cdn.example.com/two.webp"],
              "offers": {"price": 14995}
            }
          </script>
        </head>
        <body>Test Tower Apartments 123 W 20th St, Manhattan NY 10011 5 beds 2.5 baths Chelsea</body>
      </html>`;
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).includes("generativelanguage.googleapis.com")) {
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: "Test Tower Apartments",
                      address: "123 W 20th St, Manhattan, NY 10011",
                      evidence: [],
                      concerns: [],
                      confidence: 0.9,
                    }),
                  },
                ],
              },
            },
          ],
        });
      }

      return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    };

    const result = await extractListingFromUrlLive({
      rawUrl: "https://example.com/test-tower",
      identity,
      env: { GEMINI_API_KEY: "test-key" },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.extraction.ok).toBe(true);
    expect(result.listing).toMatchObject({
      title: "Test Tower Apartments",
      address: "123 W 20th St, Manhattan, NY 10011",
      rent: 14995,
      bedrooms: 5,
      bathrooms: 2.5,
      neighborhood: "Chelsea",
      borough: "Manhattan",
    });
    expect(result.listing.photos).toEqual(
      expect.arrayContaining([
        "https://cdn.example.com/test-tower.jpg",
        "https://cdn.example.com/one.jpg",
      ]),
    );
    expect(result.listing.evidence.map((evidence) => evidence.claim)).toContain(
      "Source metadata extracted from listing page",
    );
  });

  it("keeps useful metadata as partial when Gemini is unavailable", async () => {
    const html = `
      <html>
        <head><title>71 Broadway Apartments</title></head>
        <body>71 Broadway Apartments 71 Broadway Manhattan NY 10006 71 Broadway, Manhattan, NY 10006 $4,163 1 beds 1 baths Financial District <img src="https://media.example.com/71-broadway-apartments-living-room.jpg" /></body>
      </html>`;
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).includes("generativelanguage.googleapis.com")) {
        return new Response("unavailable", { status: 503 });
      }

      return new Response(html, { status: 200 });
    };

    const result = await extractListingFromUrlLive({
      rawUrl: "https://example.com/71-broadway-apartments",
      identity,
      env: { GEMINI_API_KEY: "test-key" },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.extraction.ok).toBe(false);
    expect(result.listing).toMatchObject({
      title: "71 Broadway Apartments",
      extractionStatus: "partial",
      address: "71 Broadway, Manhattan, NY 10006",
      rent: 4163,
      bedrooms: 1,
      bathrooms: 1,
    });
    expect(result.listing.photos).toEqual([
      "https://media.example.com/71-broadway-apartments-living-room.jpg",
    ]);
  });

  it("keeps failed extraction titles generic instead of URL slugs", async () => {
    const result = await extractListingFromUrlLive({
      rawUrl: "https://www.apartments.com/the-eugene-new-york-ny/rx7cnye/",
      identity,
      env: { GEMINI_API_KEY: "test-key" },
      fetchImpl: (async () => new Response("blocked", { status: 403 })) as typeof fetch,
    });

    expect(result.extraction.ok).toBe(false);
    expect(result.listing.title).toBe("Manual review needed");
    expect(result.listing.title).not.toBe("Rx7cnye");
  });

  it("does not save wrong-building metadata when fetched content conflicts with the submitted URL", async () => {
    const html = `
      <html>
        <head><title>The Edge Apartments - Bethesda, MD</title></head>
        <body>The Edge Apartments Bethesda MD <img src="https://cdn.example.com/edge.jpg" /></body>
      </html>`;

    const result = await extractListingFromUrlLive({
      rawUrl:
        "https://www.equityapartments.com/new-york-city/midtown-west/longacre-house-apartments",
      identity,
      env: { GEMINI_API_KEY: "test-key" },
      fetchImpl: (async () => new Response(html, { status: 200 })) as typeof fetch,
    });

    expect(result.extraction).toMatchObject({
      ok: false,
      providerCalled: false,
      failureCode: "source-page-content-mismatch",
    });
    expect(result.listing.title).toBe("Longacre House Apartments");
    expect(result.listing.photos).toEqual([]);
    expect(result.listing.concerns.join(" ")).toContain("does not match submitted URL slug");
  });

  it("uses RealtyAPI for StreetEasy exact URL details instead of scraping blocked HTML", async () => {
    const targetUrl = "https://streeteasy.com/building/325-east-14-street-new_york/phd";
    const fetchImpl = async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes("/search/rent")) {
        return Response.json({
          search_results: {
            listings: [
              {
                node: {
                  id: "se-325-phd",
                  urlPath: "/building/325-east-14-street-new_york/phd",
                  display_address: "325 East 14th Street #PHD",
                  neighborhood: "East Village",
                  price: 12500,
                  beds: 5,
                  baths: 2,
                },
              },
            ],
          },
        });
      }
      if (value.includes("/rental_detailsbyid")) {
        return Response.json({
          listing_id: "se-325-phd",
          title: "325 East 14th Street #PHD",
          pricing: { price: 12500 },
          propertyDetails: {
            bedroomCount: 5,
            fullBathroomCount: 2,
            address: {
              houseNumber: "325",
              streetName: "East 14th Street",
              unit: "#PHD",
              city: "Manhattan",
              state: "NY",
              zipCode: "10003",
            },
            amenities: { list: ["Private outdoor space", "Laundry"] },
          },
          description: "Penthouse duplex with private outdoor space.",
          media: {
            photos: ["https://photos.example.com/325-east-14-street-apartment-living-room.jpg"],
          },
        });
      }
      return new Response("blocked", { status: 403 });
    };

    const result = await extractListingFromUrlLive({
      rawUrl: targetUrl,
      identity,
      env: { REALTYAPI_KEY: "realty-test", REALTYAPI_BASE_URL: "https://realty.test" },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.extraction).toMatchObject({
      ok: true,
      sourcePageFetched: false,
      providerCalled: true,
    });
    expect(result.listing).toMatchObject({
      title: "325 East 14th Street #PHD",
      address: "325 East 14th Street #PHD, Manhattan, NY 10003",
      neighborhood: "East Village",
      borough: "Manhattan",
      rent: 12500,
      bedrooms: 5,
      bathrooms: 2,
      extractionStatus: "success",
    });
    expect(result.listing.photos).toEqual([
      "https://photos.example.com/325-east-14-street-apartment-living-room.jpg",
    ]);
  });

  it("keeps the StreetEasy URL building number when RealtyAPI detail address omits it", async () => {
    const targetUrl = "https://streeteasy.com/building/325-east-14-street-new_york/phd";
    const fetchImpl = async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes("/search/rent")) {
        return Response.json({
          search_results: {
            listings: [
              {
                node: {
                  id: "se-325-phd",
                  urlPath: "/building/325-east-14-street-new_york/phd",
                },
              },
            ],
          },
        });
      }
      if (value.includes("/rental_detailsbyid")) {
        return Response.json({
          listing_id: "se-325-phd",
          title: "325 EAST 14 STREET PH-D, NEW YORK, NY 10003",
          address: "14 STREET PH-D, NEW YORK, NY 10003",
          pricing: { price: 12995 },
          propertyDetails: {
            bedroomCount: 5,
            fullBathroomCount: 2,
          },
        });
      }
      return new Response("blocked", { status: 403 });
    };

    const result = await extractListingFromUrlLive({
      rawUrl: targetUrl,
      identity,
      env: { REALTYAPI_KEY: "realty-test", REALTYAPI_BASE_URL: "https://realty.test" },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.listing.address).toBe("325 East 14 Street PHD");
    expect(result.listing.rent).toBe(12995);
  });

  it("resolves StreetEasy building URLs through neighborhood-scoped unit matches", async () => {
    const targetUrl = "https://streeteasy.com/building/205-avenue-a-new_york";
    const requestedLocations: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      const value = String(url);
      const requestedUrl = new URL(value);
      if (value.includes("geosearch.planninglabs.nyc")) {
        expect(requestedUrl.searchParams.get("text")).toBe("205 Avenue A Manhattan NY");
        return Response.json({
          features: [
            {
              properties: {
                neighbourhood: "East Village",
                borough: "Manhattan",
              },
            },
          ],
        });
      }
      if (value.includes("/search/rent")) {
        requestedLocations.push(requestedUrl.searchParams.get("location") ?? "");
        return Response.json({
          search_results: {
            listings: [
              {
                node: {
                  id: "se-205-3",
                  urlPath: "/building/205-avenue-a-new_york/3",
                  display_address: "205 Avenue A #3",
                  neighborhood: "East Village",
                  price: 12500,
                  beds: 5,
                  baths: 2,
                },
              },
            ],
          },
        });
      }
      if (value.includes("/rental_detailsbyid")) {
        return Response.json({
          listing_id: "se-205-3",
          title: "205 Avenue A #3",
          pricing: { price: 12500 },
          propertyDetails: {
            bedroomCount: 5,
            fullBathroomCount: 2,
            address: {
              houseNumber: "205",
              streetName: "Avenue A",
              unit: "#3",
              city: "Manhattan",
              state: "NY",
              zipCode: "10009",
            },
          },
        });
      }
      return new Response("blocked", { status: 403 });
    };

    const result = await extractListingFromUrlLive({
      rawUrl: targetUrl,
      identity,
      env: { REALTYAPI_KEY: "realty-test", REALTYAPI_BASE_URL: "https://realty.test" },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(requestedLocations).toContain("East Village");
    expect(result.extraction).toMatchObject({
      ok: true,
      sourcePageFetched: false,
      providerCalled: true,
    });
    expect(result.listing).toMatchObject({
      title: "205 Avenue A #3",
      address: "205 Avenue A #3, Manhattan, NY 10009",
      rent: 12500,
      bedrooms: 5,
      bathrooms: 2,
      extractionStatus: "success",
    });
  });
});
