import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  E2E_BASE_URL,
  approveListing,
  createListing,
  listingDetail,
  listingNotice,
  openListing,
  pretendOffline,
  readListing,
  signIn,
  uniqueSourceUrl,
  waitForListingResponse,
  type E2eListing,
} from "./support/app";

// Two reviewers share one listing across the whole file, so the steps run in order.
test.describe.configure({ mode: "serial" });

const contestedTitle = "E2E Contested Listing";
const removedTitle = "E2E Removed Listing";

let aliceContext: BrowserContext;
let bobContext: BrowserContext;
let alice: Page;
let bob: Page;
let contested: E2eListing;

test.beforeAll(async ({ browser, playwright }) => {
  const api = await playwright.request.newContext({ baseURL: E2E_BASE_URL });
  try {
    const created = await createListing(api, {
      url: uniqueSourceUrl("conflict"),
      title: contestedTitle,
      displayName: "E2E Seeder",
    });
    // A review-needed listing locks its status select; approving it unlocks the dropdown.
    contested = await approveListing(api, created, "E2E Seeder");
  } finally {
    await api.dispose();
  }

  aliceContext = await browser.newContext();
  bobContext = await browser.newContext();
  alice = await aliceContext.newPage();
  bob = await bobContext.newPage();
  await signIn(alice, "Alice");
  await signIn(bob, "Bob");
});

test.afterAll(async () => {
  await aliceContext.close();
  await bobContext.close();
});

test("the second writer is told someone else changed the listing first", async ({ request }) => {
  await openListing(alice, contestedTitle);
  await openListing(bob, contestedTitle);

  // Bob stops polling, so his copy keeps the revision both reviewers started from.
  await pretendOffline(bob);

  const aliceSaved = waitForListingResponse(alice, "PATCH", 200);
  await alice
    .getByRole("combobox", { name: `Change review status for ${contestedTitle}` })
    .selectOption("interested");
  await aliceSaved;

  const bobRejected = waitForListingResponse(bob, "PATCH", 409);
  await bob
    .getByRole("combobox", { name: `Change review status for ${contestedTitle}` })
    .selectOption("touring");
  await bobRejected;

  await expect(listingNotice(bob)).toContainText("Someone else changed that listing first");

  const stored = await readListing(request, contested.id);
  expect(stored?.reviewStatus).toBe("interested");
});

test("a stale edit to a removed listing reports the removal", async ({ request, playwright }) => {
  const api = await playwright.request.newContext({ baseURL: E2E_BASE_URL });
  let removed: E2eListing;
  try {
    // Left in the review-needed holding state so the UI offers "Reject and remove".
    removed = await createListing(api, {
      url: uniqueSourceUrl("removal"),
      title: removedTitle,
      displayName: "E2E Seeder",
    });
  } finally {
    await api.dispose();
  }

  // Alice loads the listing while it still exists, then stops seeing further updates.
  await alice.reload();
  await openListing(alice, removedTitle);
  await pretendOffline(alice);

  await bob.reload();
  await openListing(bob, removedTitle);
  const bobRemoved = waitForListingResponse(bob, "PATCH", 200);
  await listingDetail(bob).getByRole("button", { name: "Reject and remove" }).click();
  await bobRemoved;

  const aliceRejected = waitForListingResponse(alice, "PATCH", 404);
  await listingDetail(alice).getByRole("button", { name: "Approve", exact: true }).click();
  await aliceRejected;

  await expect(listingNotice(alice)).toContainText("removed by someone else");
  expect(await readListing(request, removed.id)).toBeUndefined();
});
