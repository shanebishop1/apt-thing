import { expect, test } from "@playwright/test";
import { inviteHeaders, listingCard, signIn } from "./support/app";

const fixtureListingTitle = "New Chelsea five bed batch candidate";

test("a fixture daily-loop run is recorded and its listings reach the shared list", async ({
  page,
  request,
}) => {
  const loop = await request.post("/api/platform/daily-loop", {
    headers: inviteHeaders("E2E Loop"),
    data: { mode: "fixture", cadence: "manual", trigger: "fixture" },
  });
  expect(loop.status()).toBe(200);
  expect(await loop.json()).toMatchObject({ ok: true });

  await signIn(page, "Runs Tester");
  await page.getByRole("button", { name: "Runs", exact: true }).click();

  const runHistory = page.getByRole("region", { name: "Agent run history" });
  await expect(runHistory.getByRole("heading", { name: "Runs" })).toBeVisible();
  await expect(runHistory.getByText("Fixture mode").first()).toBeVisible();
  await expect(runHistory.getByText("simulated AI attempt(s)").first()).toBeVisible();

  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(listingCard(page, fixtureListingTitle).first()).toBeVisible();
});
