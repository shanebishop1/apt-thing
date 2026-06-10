#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const mode = args.includes("--live-safe") || args.includes("--live") ? "live-safe" : "fixture";
const explicitOutputRoot = readFlag("--out");
const outputRoot = explicitOutputRoot ?? "tmp/proof-output/acquisition";

if (mode === "live-safe") {
  const missing = [
    ["FIRECRAWL_API_KEY", process.env.FIRECRAWL_API_KEY],
    ["GEMINI_API_KEY", process.env.GEMINI_API_KEY],
    ["REALTYAPI_KEY", process.env.REALTYAPI_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.warn(
      `live-safe mode requested; missing ${missing.join(", ")}. The harness will write fixture-safe artifacts and mark key availability in the manifest.`,
    );
  }
}

const moduleUrl = prepareTypeScriptModuleForNode(outputRoot);
const { buildAcquisitionProof, writeAcquisitionProofArtifacts } = await import(moduleUrl);
const proof = buildAcquisitionProof({ mode });
const written = writeAcquisitionProofArtifacts(
  proof,
  explicitOutputRoot ? { outputRoot: explicitOutputRoot } : {},
);

console.log(
  JSON.stringify(
    {
      status: "success",
      mode: proof.manifest.mode,
      runId: proof.manifest.runId,
      candidateCount: proof.summary.candidateCount,
      classifications: proof.summary.classifications,
      gemini: proof.summary.gemini,
      outputRoot: written.outputRoot,
      summaryPath: written.summaryPath,
      normalizedCandidatesPath: written.normalizedCandidatesPath,
      sourceClassificationsPath: written.sourceClassificationsPath,
    },
    null,
    2,
  ),
);

function prepareTypeScriptModuleForNode(root) {
  const moduleDir = `${root}/.node-strip-types`;
  mkdirSync(moduleDir, { recursive: true });
  const listingsSource = readFileSync("src/lib/listings.ts", "utf8");
  const acquisitionSource = readFileSync("src/lib/acquisition.ts", "utf8").replace(
    'from "./listings"',
    'from "./listings.ts"',
  );
  writeFileSync(`${moduleDir}/listings.ts`, listingsSource);
  writeFileSync(`${moduleDir}/acquisition.ts`, acquisitionSource);

  return pathToFileURL(resolve(moduleDir, "acquisition.ts")).href;
}

function readFlag(flag) {
  const index = args.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}
