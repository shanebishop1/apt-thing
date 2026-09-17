import { expect, test, type Page } from "@playwright/test";
import {
  listingCard,
  listingDetail,
  signIn,
  uniqueSourceUrl,
  waitForListingResponse,
} from "./support/app";

// Every step builds on the record the first test saves, so the file shares one page.
test.describe.configure({ mode: "serial" });

const listingTitle = "Manual review needed";
const sourceUrl = uniqueSourceUrl("e2e-check");

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signIn(page, "Flow Tester");
});

test.afterAll(async () => {
  await page.close();
});

test("saves a pasted link as a manual-review record", async () => {
  await page.getByLabel("Add listing").click();
  await page.getByLabel("Source URL").fill(sourceUrl);

  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/group/listings" &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await created;

  await expect(listingCard(page, listingTitle).first()).toBeVisible();
  await expect(listingDetail(page).getByRole("heading", { name: listingTitle })).toBeVisible();
  await expect(listingDetail(page).getByText("Needs review")).toBeVisible();
});

test("edits the rent through the field dialog", async () => {
  await page.getByRole("button", { name: `Edit fields for ${listingTitle}` }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const saved = waitForListingResponse(page, "PATCH", 200);
  await dialog.getByLabel("rent", { exact: true }).fill("4200");
  await saved;

  await dialog.getByRole("button", { name: `Close field editor for ${listingTitle}` }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(listingDetail(page).getByRole("heading", { name: listingTitle })).toBeVisible();
  await expect(page.getByRole("region", { name: "Listing facts" })).toContainText("$4,200");
});

test("records a review decision and a later status change", async () => {
  const approved = waitForListingResponse(page, "PATCH", 200);
  await listingDetail(page).getByRole("button", { name: "Approve", exact: true }).click();
  await approved;

  const statusSelect = page.getByRole("combobox", {
    name: `Change review status for ${listingTitle}`,
  });
  await expect(statusSelect).toBeEnabled();

  const statusSaved = waitForListingResponse(page, "PATCH", 200);
  await statusSelect.selectOption("interested");
  await statusSaved;

  await page.reload();
  await expect(
    page.getByRole("combobox", { name: `Change review status for ${listingTitle}` }),
  ).toHaveValue("interested");
});

test("saves a group comment on the open listing", async () => {
  await listingDetail(page).getByText("Add comment").click();

  const commented = waitForListingResponse(page, "POST", 200);
  await listingDetail(page)
    .getByRole("textbox", { name: `Comment on ${listingTitle}` })
    .fill("Checked the block on foot, feels fine.");
  await listingDetail(page).getByRole("button", { name: "Save", exact: true }).click();
  await commented;

  await expect(page.getByLabel("Saved group action summary")).toContainText(
    "Flow Tester · Checked the block on foot, feels fine.",
  );
});
