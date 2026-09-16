#!/usr/bin/env node
// Fails when a server-only credential appears in generated client assets.
// Run after `pnpm build`; pass --open-next after `pnpm cf:build` to scan the Worker assets too.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const assetRoots = [
  ".next/static",
  ...(process.argv.includes("--open-next") ? [".open-next/assets"] : []),
]
  .map((directory) => join(root, directory))
  .filter((directory) => existsSync(directory));

if (!existsSync(join(root, ".next/static"))) {
  console.error("check-client-secrets: .next/static is missing; run `pnpm build` first.");
  process.exit(2);
}

// GROUP_INVITE_CODES is handled separately below, because its value is a list of
// `label=code` pairs rather than a single secret. These are the plain provider keys.
const providerKeyNames = ["GEMINI_API_KEY", "REALTYAPI_KEY", "STADIA_MAPS_API_KEY"];
const needles = new Map([
  ["apt-g1", "retired committed invite code"],
  ["GROUP_INVITE_CODES", "server-only env variable name"],
]);

const envSources = [process.env, ...[".env.local", ".dev.vars"].map(readEnvFile)];
for (const env of envSources) {
  for (const code of parseInviteCodes(env.GROUP_INVITE_CODES))
    needles.set(code, "configured invite code");
  for (const name of providerKeyNames) {
    const value = env[name]?.trim();
    if (value && value.length >= 8) needles.set(value, `${name} value`);
  }
}

const findings = [];
let scanned = 0;
for (const file of assetRoots.flatMap(listFiles)) {
  if (!/\.(js|mjs|css|html|json|txt|map)$/.test(file)) continue;
  scanned += 1;
  const contents = readFileSync(file, "utf8");
  for (const [needle, label] of needles) {
    if (contents.includes(needle)) findings.push(`${file.slice(root.length + 1)}: ${label}`);
  }
}

if (findings.length > 0) {
  console.error(
    `check-client-secrets: found server-only values in client assets:\n${findings.join("\n")}`,
  );
  process.exit(1);
}

console.log(
  `check-client-secrets: scanned ${scanned} client asset files for ${needles.size} server-only values; none found.`,
);

function parseInviteCodes(value) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.slice(entry.indexOf("=") + 1).trim())
    .filter((code) => code.length >= 8);
}

function readEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

function listFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}
