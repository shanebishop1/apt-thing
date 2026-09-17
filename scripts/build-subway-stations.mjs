#!/usr/bin/env node
// Regenerates src/lib/nyc-subway-stations.ts from the MTA's public station list.
//
// Source: "MTA Subway Stations" (dataset 39hk-dx4f) on the New York State open data
// portal, https://data.ny.gov/Transportation/MTA-Subway-Stations/39hk-dx4f
// Download: https://data.ny.gov/api/views/39hk-dx4f/rows.csv?accessType=DOWNLOAD
// Attribution: Metropolitan Transportation Authority open data, republished by New
// York State under the data.ny.gov terms of use (https://data.ny.gov/about). The MTA
// asks that derived products credit the MTA as the data source; the generated module
// carries that credit and `createMapReviewModel` surfaces it in the map attribution.
//
// Usage:
//   node scripts/build-subway-stations.mjs            # downloads the current CSV
//   node scripts/build-subway-stations.mjs --csv Stations.csv   # uses a local copy
//
// Each CSV row is one platform set (one division at one station), so rows are grouped
// by Complex ID: routes are unioned, coordinates averaged and rounded to 5 decimals,
// and complexes that carry more than one stop name keep every name, busiest first.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://data.ny.gov/api/views/39hk-dx4f/rows.csv?accessType=DOWNLOAD";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = join(REPO_ROOT, "src", "lib", "nyc-subway-stations.ts");

const csv = await readSourceCsv();
const rows = parseCsv(csv);
const stations = toStations(rows);
writeFileSync(OUTPUT_PATH, renderModule(stations));
execFileSync(join(REPO_ROOT, "node_modules", ".bin", "oxfmt"), ["--write", OUTPUT_PATH], {
  stdio: "inherit",
});
console.log(
  `build-subway-stations: ${rows.length} rows -> ${stations.length} stations, ${OUTPUT_PATH}`,
);

async function readSourceCsv() {
  const csvFlagIndex = process.argv.indexOf("--csv");
  if (csvFlagIndex !== -1) {
    const path = process.argv[csvFlagIndex + 1];
    if (!path) throw new Error("--csv needs a file path");
    return readFileSync(path, "utf8");
  }

  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to download ${SOURCE_URL}: ${response.status}`);
  }

  return response.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') field += character;
      else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += character;
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) throw new Error("Station CSV is empty");

  return rows
    .filter((entry) => entry.length === header.length)
    .map((entry) => Object.fromEntries(header.map((name, index) => [name, entry[index]])));
}

function toStations(rows) {
  const complexes = new Map();
  for (const row of rows) {
    const name = row["Stop Name"]?.trim();
    const latitude = Number(row["GTFS Latitude"]);
    const longitude = Number(row["GTFS Longitude"]);
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const key = row["Complex ID"]?.trim() || `${name}:${latitude}:${longitude}`;
    const complex = complexes.get(key) ?? { names: new Map(), routes: new Set(), points: [] };
    complex.names.set(name, (complex.names.get(name) ?? 0) + 1);
    for (const route of (row["Daytime Routes"] ?? "").split(/\s+/u).filter(Boolean)) {
      complex.routes.add(route.toUpperCase());
    }
    complex.points.push({ latitude, longitude });
    complexes.set(key, complex);
  }

  const stations = [...complexes.values()].map((complex) => ({
    name: [...complex.names.entries()]
      .sort(
        ([leftName, leftCount], [rightName, rightCount]) =>
          rightCount - leftCount || leftName.localeCompare(rightName),
      )
      .map(([name]) => name)
      .join("/"),
    routes: [...complex.routes].sort(compareRoutes),
    latitude: round5(average(complex.points.map((point) => point.latitude))),
    longitude: round5(average(complex.points.map((point) => point.longitude))),
  }));

  const deduplicated = new Map();
  for (const station of stations) {
    deduplicated.set(`${station.name}:${station.latitude}:${station.longitude}`, station);
  }

  return [...deduplicated.values()].sort((left, right) => left.name.localeCompare(right.name));
}

// Numbered routes first in service order, then lettered routes (A, B, C, ..., SIR).
function compareRoutes(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  if (Number.isFinite(leftNumber)) return -1;
  if (Number.isFinite(rightNumber)) return 1;

  return left.localeCompare(right);
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round5(value) {
  return Math.round(value * 1e5) / 1e5;
}

function renderModule(stations) {
  const entries = stations
    .map((station) => {
      const routes = station.routes.map((route) => JSON.stringify(route)).join(", ");
      return `  { name: ${JSON.stringify(station.name)}, routes: [${routes}], latitude: ${station.latitude}, longitude: ${station.longitude} },`;
    })
    .join("\n");

  return `// Generated by scripts/build-subway-stations.mjs. Do not edit by hand.
//
// Source: MTA Subway Stations (dataset 39hk-dx4f) on https://data.ny.gov, Metropolitan
// Transportation Authority open data under the data.ny.gov terms of use. Rows are grouped
// into station complexes: routes unioned, coordinates averaged and rounded to 5 decimals.
export type NycSubwayStation = {
  name: string;
  routes: string[];
  latitude: number;
  longitude: number;
};

export const nycSubwayStations: NycSubwayStation[] = [
${entries}
];

export const nycSubwayStationsAttribution =
  "Subway station names, routes, and coordinates from the MTA Subway Stations dataset on data.ny.gov.";
`;
}
