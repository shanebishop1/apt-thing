import { expect, test } from "@playwright/test";
import { E2E_INVITE_CODE, WRONG_INVITE_CODE, inviteHeaders } from "./support/app";

test.describe("group authentication", () => {
  test("rejects unauthenticated and mis-credentialled API reads", async ({ request }) => {
    const anonymous = await request.get("/api/group/listings");
    expect(anonymous.status()).toBe(401);
    expect(await anonymous.json()).toMatchObject({ ok: false, error: "authentication-required" });

    const wrongCode = await request.get("/api/group/listings", {
      headers: { ...inviteHeaders("Intruder"), "X-Invite-Code": WRONG_INVITE_CODE },
    });
    expect(wrongCode.status()).toBe(403);
    expect(await wrongCode.json()).toMatchObject({ ok: false, error: "invalid-invite-code" });

    const authorized = await request.get("/api/group/listings", {
      headers: inviteHeaders("E2E Auth"),
    });
    expect(authorized.status()).toBe(200);
  });

  test("the invite gate refuses a wrong code and accepts the configured one", async ({ page }) => {
    await page.goto("/");

    const gate = page.getByRole("form", { name: "Invite identity" });
    await expect(gate).toBeVisible();

    await gate.getByLabel("Invite code").fill(WRONG_INVITE_CODE);
    await gate.getByLabel("Display name").fill("Gate Crasher");
    await gate.getByRole("button", { name: "Enter shared list" }).click();

    await expect(gate.getByText("Invite code or display name is invalid.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Listings" })).toBeHidden();

    await gate.getByLabel("Invite code").fill(E2E_INVITE_CODE);
    await gate.getByRole("button", { name: "Enter shared list" }).click();

    await expect(page.getByRole("heading", { name: "Listings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Active group identity" })).toBeVisible();
  });
});
