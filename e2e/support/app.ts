import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/** The dummy invite code the e2e server is configured with; see `e2e/.dev.vars`. */
export const E2E_INVITE_CODE = "e2e-invite-code-0123456789abcdef";

/** Long enough to pass the client-side length check, but not a configured code. */
export const WRONG_INVITE_CODE = "wrong-invite-code-0123456789abcd";

export const E2E_BASE_URL = "http://127.0.0.1:3111";

export type E2eListing = {
  id: string;
  title: string;
  revision: number;
  reviewStatus: string;
};

type SnapshotPayload = {
  ok: boolean;
  snapshot: { listings: E2eListing[] };
  result?: { listing: E2eListing };
};

/** Operator headers: the API accepts `X-Invite-Code` in place of the browser session cookie. */
export function inviteHeaders(displayName: string): Record<string, string> {
  return {
    "X-Invite-Code": E2E_INVITE_CODE,
    "X-Display-Name": displayName,
    "Content-Type": "application/json",
  };
}

export async function signIn(page: Page, displayName: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Invite code").fill(E2E_INVITE_CODE);
  await page.getByLabel("Display name").fill(displayName);
  await page.getByRole("button", { name: "Enter shared list" }).click();
  await expect(page.getByRole("heading", { name: "Listings" })).toBeVisible();
}

/**
 * The workspace-level conflict banner. Scoped by its Dismiss button because Next.js renders its
 * own always-present route announcer with `role="alert"`.
 */
export function listingNotice(page: Page): Locator {
  return page
    .getByRole("alert")
    .filter({ has: page.getByRole("button", { name: "Dismiss", exact: true }) });
}

export function listingDetail(page: Page): Locator {
  return page.getByLabel("Listing detail panel");
}

/** The saved-list row for a listing, whose accessible name changes once it is selected. */
export function listingCard(page: Page, title: string): Locator {
  return page
    .getByRole("button", { name: `Select ${title}`, exact: true })
    .or(page.getByRole("button", { name: `Selected ${title}`, exact: true }));
}

export async function openListing(page: Page, title: string): Promise<void> {
  await listingCard(page, title).first().click();
  await expect(listingDetail(page).getByRole("heading", { name: title })).toBeVisible();
}

/** Resolves when the browser gets a response for a mutation on a single listing. */
export function waitForListingResponse(
  page: Page,
  method: "PATCH" | "POST",
  status: number,
): Promise<unknown> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      /^\/api\/group\/listings\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.status() === status,
  );
}

export async function readSnapshot(api: APIRequestContext): Promise<E2eListing[]> {
  const response = await api.get("/api/group/listings", { headers: inviteHeaders("E2E Reader") });
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as SnapshotPayload;
  return payload.snapshot.listings;
}

export async function readListing(
  api: APIRequestContext,
  listingId: string,
): Promise<E2eListing | undefined> {
  const listings = await readSnapshot(api);
  return listings.find((listing) => listing.id === listingId);
}

async function patchListing(
  api: APIRequestContext,
  listingId: string,
  displayName: string,
  data: Record<string, unknown>,
): Promise<E2eListing> {
  const response = await api.patch(`/api/group/listings/${listingId}`, {
    headers: inviteHeaders(displayName),
    data,
  });
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as SnapshotPayload;
  const listing = payload.snapshot.listings.find((candidate) => candidate.id === listingId);
  expect(listing).toBeDefined();
  return listing!;
}

/**
 * Saves a pasted link through the API and renames it. Every link extracted without provider
 * keys lands as "Manual review needed", so specs give their fixtures a unique title to keep
 * accessible-name locators unambiguous.
 */
export async function createListing(
  api: APIRequestContext,
  {
    url,
    title,
    displayName,
  }: {
    url: string;
    title: string;
    displayName: string;
  },
): Promise<E2eListing> {
  const response = await api.post("/api/group/listings", {
    headers: inviteHeaders(displayName),
    data: { url },
  });
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as SnapshotPayload;
  const created = payload.result?.listing;
  expect(created).toBeDefined();

  return patchListing(api, created!.id, displayName, {
    mutation: "field",
    field: "title",
    value: title,
    revision: created!.revision,
  });
}

/** Moves a review-needed listing out of the holding state so its status select is enabled. */
export async function approveListing(
  api: APIRequestContext,
  listing: E2eListing,
  displayName: string,
): Promise<E2eListing> {
  return patchListing(api, listing.id, displayName, {
    mutation: "review-decision",
    decision: "approve",
    revision: listing.revision,
  });
}

/**
 * Spoofs `navigator.onLine` on the page's current document. Snapshot polling and the focus
 * refresh both bail out when the browser reports itself offline, which is how a spec keeps one
 * participant's view deliberately stale. Requests the page makes itself still go through, and a
 * reload clears the override.
 */
export async function pretendOffline(target: Page): Promise<void> {
  await target.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  });
}

export function uniqueSourceUrl(slug: string): string {
  return `https://example.invalid/listing/${slug}-${Date.now().toString(36)}`;
}
