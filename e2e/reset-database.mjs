// Resets the local D1 state the end-to-end suite runs against, then replays every migration.
//
// This runs as the first half of the Playwright `webServer` command rather than from
// `globalSetup`: Playwright starts the web server before global setup, and the Cloudflare dev
// bridge opens the local D1 state while `next dev` boots and holds those file handles for the
// life of the process. Deleting the directory afterwards would leave the server talking to an
// unlinked copy of the database, so the reset has to happen before the server starts.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = ".wrangler/e2e-state";
const configPath = "e2e/wrangler.e2e.jsonc";

rmSync(resolve(repositoryRoot, statePath), { recursive: true, force: true });

const migration = spawnSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    statePath,
  ],
  {
    cwd: repositoryRoot,
    stdio: "inherit",
    // `CI` makes wrangler skip the interactive confirmation prompt.
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
  },
);

if (migration.error) {
  throw migration.error;
}

if (migration.status !== 0) {
  throw new Error(`wrangler d1 migrations apply exited with code ${migration.status}`);
}
