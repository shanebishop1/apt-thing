import fs from "node:fs";
import path from "node:path";

const DEFAULT_URL = "https://streeteasy.com/building/152-manhattan-avenue-brooklyn/4b";
const OUT_DIR = "tmp/streeteasy-live-proof";
const BOROUGHS = ["brooklyn", "manhattan", "queens", "bronx", "staten-island"];

loadDotenvLocal();

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.includes("--fixture")) {
  writeFixtureProof();
  process.exit(0);
}

const apiKey = process.env.REALTYAPI_KEY;
if (!apiKey) {
  throw new Error("REALTYAPI_KEY is required in the environment or .env.local. Use --fixture for offline proof.");
}

const targetUrl = args[0] ?? DEFAULT_URL;
const locationOverride = args[1];
const targetPath = new URL(targetUrl).pathname.toLowerCase();
const parsedStreetEasyPath = parseStreetEasyPath(targetPath);
const locationCandidates = locationOverride
  ? [locationOverride]
  : await inferLocationCandidates(parsedStreetEasyPath);

fs.mkdirSync(OUT_DIR, { recursive: true });

const match = await findListingByUrlPath({ locationCandidates, targetPath, maxPages: 5 });
if (!match) {
  throw new Error(`No RealtyAPI search result matched ${targetPath} in ${locationCandidates.join(", ")}`);
}

const details = await getRentalDetailsById({
  buildingid: match.id,
});

const output = {
  input: {
    url: targetUrl,
    locationCandidates,
    parsedStreetEasyPath,
    matchedPath: targetPath,
  },
  searchMatch: match,
  detailsSummary: summarizeDetails(details),
  details,
};

const outputPath = path.join(OUT_DIR, "realtyapi_resolved_target_details.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

console.log(JSON.stringify(output.detailsSummary, null, 2));
console.log(`wrote ${outputPath}`);

async function findListingByUrlPath({ locationCandidates, targetPath, maxPages }) {
  for (const location of locationCandidates) {
    for (let page = 1; page <= maxPages; page += 1) {
      const data = await realtyApi("/search/rent", {
        location,
        sort_by: "Newest",
        page: String(page),
      });

      const listings = data.search_results?.listings ?? [];
      const edge = listings.find((candidate) => candidate.node?.urlPath?.toLowerCase() === targetPath);
      if (edge?.node) {
        return {
          ...edge.node,
          foundInLocation: location,
          foundOnPage: page,
        };
      }
    }
  }

  return null;
}

async function inferLocationCandidates(parsedPath) {
  const candidates = [];

  if (parsedPath?.addressQuery) {
    const geosearchUrl = new URL("https://geosearch.planninglabs.nyc/v2/search");
    geosearchUrl.searchParams.set("text", parsedPath.addressQuery);
    geosearchUrl.searchParams.set("size", "5");

    const response = await fetch(geosearchUrl);
    if (response.ok) {
      const data = await response.json();
      for (const feature of data.features ?? []) {
        const props = feature.properties ?? {};
        pushUnique(candidates, props.neighbourhood);
        pushUnique(candidates, props.borough);
      }
    }
  }

  pushUnique(candidates, parsedPath?.borough);
  pushUnique(candidates, "NYC and NJ");

  return candidates;
}

function parseStreetEasyPath(targetPath) {
  const parts = targetPath.split("/").filter(Boolean);
  if (parts[0] !== "building" || parts.length < 3) {
    return null;
  }

  const slugParts = parts[1].split("-");
  const boroughIndex = slugParts.findIndex((_, index) => {
    const remaining = slugParts.slice(index).join("-");
    return BOROUGHS.includes(remaining);
  });

  if (boroughIndex === -1) {
    return null;
  }

  const address = titleCase(slugParts.slice(0, boroughIndex).join(" "));
  const borough = titleCase(slugParts.slice(boroughIndex).join(" "));

  return {
    address,
    borough,
    unit: parts[2].toUpperCase(),
    addressQuery: `${address} ${borough} NY`,
  };
}

function pushUnique(values, value) {
  if (!value || values.includes(value)) {
    return;
  }

  values.push(value);
}

function titleCase(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function realtyApi(endpoint, params) {
  const url = new URL(`https://streeteasy.realtyapi.io${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      "x-realtyapi-key": apiKey,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${endpoint} failed with ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

async function getRentalDetailsById(params) {
  let lastDetails = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const details = await realtyApi("/rental_detailsbyid", params);
    lastDetails = details;

    if (details.listing_id) {
      return details;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }

  throw new Error(
    `rental_detailsbyid returned no listing_id for ${params.buildingid}: ${JSON.stringify(lastDetails)}`,
  );
}

function summarizeDetails(details) {
  const address = details.propertyDetails?.address ?? {};

  return {
    listingId: details.listing_id,
    status: details.propertyStatus,
    price: details.pricing?.price,
    noFee: details.pricing?.noFee,
    availableAt: details.availableAt,
    createdAt: details.createdAt,
    address: [address.houseNumber, address.streetName, address.unit].filter(Boolean).join(" "),
    city: address.city,
    state: address.state,
    zipCode: address.zipCode,
    beds: details.propertyDetails?.bedroomCount,
    fullBaths: details.propertyDetails?.fullBathroomCount,
    halfBaths: details.propertyDetails?.halfBathroomCount,
    amenities: details.propertyDetails?.amenities?.list ?? [],
    features: details.propertyDetails?.features?.list ?? [],
    petsAllowed: details.propertyDetails?.policies?.petsAllowed,
    photoCount: details.media?.photos?.length ?? 0,
    descriptionPreview: details.description?.slice(0, 240),
  };
}

function loadDotenvLocal() {
  const envPath = ".env.local";
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trimStart().startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function writeFixtureProof() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const output = {
    mode: "fixture",
    input: {
      url: DEFAULT_URL,
      locationCandidates: ["Williamsburg", "Brooklyn", "NYC and NJ"],
      parsedStreetEasyPath: {
        address: "152 Manhattan Avenue",
        borough: "Brooklyn",
        unit: "4B",
        addressQuery: "152 Manhattan Avenue Brooklyn NY",
      },
      matchedPath: "/building/152-manhattan-avenue-brooklyn/4b",
    },
    searchMatch: {
      id: "5062766",
      urlPath: "/building/152-manhattan-avenue-brooklyn/4b",
      foundInLocation: "Williamsburg",
      foundOnPage: 2,
    },
    detailsSummary: {
      listingId: "5062766",
      status: "active",
      price: 10150,
      noFee: true,
      availableAt: "2026-08-01",
      address: "152 Manhattan Avenue #4B",
      city: "Brooklyn",
      state: "NY",
      beds: 6,
      fullBaths: 2,
      halfBaths: 0,
      amenities: ["Laundry in building", "Dishwasher", "Roof deck"],
      photoCount: 7,
      descriptionPreview:
        "Six-bedroom whole-apartment rental with two baths and August 1 availability from RealtyAPI fixture evidence.",
    },
  };
  const outputPath = path.join(OUT_DIR, "realtyapi_resolved_target_details.fixture.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}
`);
  console.log(JSON.stringify(output.detailsSummary, null, 2));
  console.log(`wrote ${outputPath}`);
}
