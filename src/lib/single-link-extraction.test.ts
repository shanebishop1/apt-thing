import { describe, expect, it } from "vitest";
import { createGroupIdentity, defaultSearchGroup } from "./listings";
import { extractListingFromUrlLive } from "./single-link-extraction";

const identity = createGroupIdentity(defaultSearchGroup.id, "Verifier")!;

describe("single-link live extraction", () => {
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

  it("keeps a building-page address whose head is the title, and invents no bedroom count", async () => {
    // Shape copied from nybits.com/apartments/11_waverly_pl.html: a building page with no unit
    // listings, whose only "1BR" text is the site-wide navigation menu.
    const html = `
      <html>
        <head>
          <title>11 Waverly Place in Central Village, Manhattan</title>
          <meta name="og:title" content="11 Waverly Place in Central Village, Manhattan" />
        </head>
        <body>
          APARTMENTS Search Rentals STU &middot; 1BR &middot; 2BR BUILDINGS Rental Buildings
          11 Waverly Place Address 11 Waverly Place, New York, NY 10003
          Neighborhoods Central Village , Manhattan Rental listings (no current listings)
          Year built 1929 Structure 12 floors 152 units
          Building Description 11 Waverly Place is a pre-war mid-rise doorman elevator building.
        </body>
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
                      title: "11 Waverly Place",
                      address: "11 Waverly Place, New York, NY 10003",
                      borough: "Manhattan",
                      description: "Pre-war mid-rise doorman elevator building.",
                      evidence: [],
                      concerns: [],
                      confidence: 0.6,
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
      rawUrl: "https://www.nybits.com/apartments/11_waverly_pl.html",
      identity,
      env: { GEMINI_API_KEY: "test-key" },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.listing.address).toBe("11 Waverly Place, New York, NY 10003");
    expect(result.listing.bedrooms).toBeUndefined();
    expect(result.listing.bathrooms).toBeUndefined();
    expect(result.listing.fieldProvenance.map((entry) => entry.field)).not.toContain("bedrooms");
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
            photos: [
              "https://photos.example.com/325-east-14-street-apartment-living-room.jpg",
              "https://photos.zillowstatic.com/fp/02b7cbfd26996523d92232fbb9381088-se_large_800_400.webp",
            ],
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
      "https://photos.zillowstatic.com/fp/02b7cbfd26996523d92232fbb9381088-se_large_800_400.webp",
    ]);
  });

  it("gives a pasted StreetEasy link the loop's coordinates and readable title", async () => {
    const targetUrl = "https://streeteasy.com/building/54-2-avenue-new_york/2";
    const searchNode = {
      id: "se-54-2",
      urlPath: "/building/54-2-avenue-new_york/2",
      display_address: "54 2 AVENUE 2, NEW YORK, NY 10003",
      street: "54 2nd Avenue",
      unit: "2",
      areaName: "East Village",
      price: 12995,
      bedroomCount: 5,
      fullBathroomCount: 2,
      halfBathroomCount: 1,
      geoPoint: { latitude: 40.7251, longitude: -73.9912 },
    };
    const fetchImpl = async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes("/search/rent")) {
        return Response.json({ search_results: { listings: [{ node: searchNode }] } });
      }
      if (value.includes("/rental_detailsbyid")) {
        return Response.json({ ...searchNode, listing_id: "se-54-2" });
      }
      return new Response("blocked", { status: 403 });
    };

    const result = await extractListingFromUrlLive({
      rawUrl: targetUrl,
      identity,
      env: { REALTYAPI_KEY: "realty-test", REALTYAPI_BASE_URL: "https://realty.test" },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.listing).toMatchObject({
      title: "54 2nd Avenue 2",
      address: "54 2nd Avenue 2",
      neighborhood: "East Village",
      rent: 12995,
      bedrooms: 5,
      bathrooms: 2.5,
      location: { latitude: 40.7251, longitude: -73.9912 },
    });
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
      url: "https://streeteasy.com/building/205-avenue-a-new_york/3",
      title: "205 Avenue A #3",
      address: "205 Avenue A #3, Manhattan, NY 10009",
      rent: 12500,
      bedrooms: 5,
      bathrooms: 2,
      extractionStatus: "success",
    });
    expect(result.listing.evidence).toContainEqual(
      expect.objectContaining({
        sourceUrl: "https://streeteasy.com/building/205-avenue-a-new_york/3",
      }),
    );
  });
});
