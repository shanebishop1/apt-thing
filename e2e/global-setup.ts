import { request } from "@playwright/test";
import { E2E_BASE_URL, inviteHeaders } from "./support/app";

/**
 * Confirms the suite is about to run against a migrated, empty database.
 *
 * The destructive part of the reset lives in `e2e/reset-database.mjs`, which the Playwright
 * `webServer` command runs before `next dev` boots — the dev bridge holds the local D1 file
 * handles for the life of the server, so the state directory cannot be replaced once it is up.
 * This check is what catches the remaining failure modes: an unmigrated database, or a server
 * left over from an earlier run and reused (`reuseExistingServer`) with its rows still in place.
 */
export default async function globalSetup(): Promise<void> {
  const api = await request.newContext({ baseURL: E2E_BASE_URL });

  try {
    const response = await api.get("/api/group/listings", {
      headers: inviteHeaders("E2E Global Setup"),
    });

    if (!response.ok()) {
      throw new Error(
        `The e2e server answered GET /api/group/listings with ${response.status()}. ` +
          "Reset the database with `node e2e/reset-database.mjs` and start the suite again.",
      );
    }

    const payload = (await response.json()) as { snapshot: { listings: unknown[] } };

    if (payload.snapshot.listings.length > 0) {
      throw new Error(
        "The e2e database already holds listings, so the suite would not start from a clean " +
          "state. Stop the dev server on port 3111 and re-run `pnpm test:e2e`.",
      );
    }
  } finally {
    await api.dispose();
  }
}
