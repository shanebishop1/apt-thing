import { expect, test } from "@playwright/test";
import { signIn } from "./support/app";

test("switching away during map zoom leaves no uncaught animation errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "Map Tester");
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page.locator(".leaflet-map.leaflet-container")).toBeVisible();
    await page.locator(".leaflet-map .leaflet-control-zoom-in").click();
    // Unmount while Leaflet's zoom transition can still have work queued.
    await page.waitForTimeout(60);
    await page.getByRole("button", { name: "Runs", exact: true }).click();
    await page.waitForTimeout(300);
  }
  expect(errors).toEqual([]);
});
