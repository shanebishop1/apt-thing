import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as smokeGET } from "../../app/api/platform/smoke/route";
import { GET as proofGET } from "../../app/api/platform/proof/route";
import { defaultSearchGroup } from "./listings";

describe("platform API route authorization", () => {
  it("rejects platform smoke without the group code", async () => {
    const response = await smokeGET(new NextRequest("http://localhost/api/platform/smoke"));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(403);
    expect(body).toEqual({ ok: false, error: "invalid-invite-code" });
  });

  it("rejects platform proof without the group code before provider proof work", async () => {
    const response = await proofGET(new NextRequest("http://localhost/api/platform/proof"));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(403);
    expect(body).toEqual({ ok: false, error: "invalid-invite-code" });
  });

  it("accepts platform smoke with the group code", async () => {
    const response = await smokeGET(
      new NextRequest("http://localhost/api/platform/smoke", {
        headers: { "X-Invite-Code": defaultSearchGroup.inviteCode },
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, runtime: "cloudflare-workers" });
  });
});
