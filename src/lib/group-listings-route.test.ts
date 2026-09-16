import { TEST_INVITE_CODE } from "../test-support/group-auth";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../../app/api/group/listings/route";
import { defaultSearchGroup } from "./listings";
import type { D1DatabaseLike } from "./shared-listing-store";

const mockState = vi.hoisted(() => ({ env: {} as { DB?: D1DatabaseLike } }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: mockState.env }),
}));

describe("GET /api/group/listings authorization", () => {
  it("accepts the invite code from X-Invite-Code and does not require it in the query string", async () => {
    mockState.env = { DB: createEmptyD1() };

    const response = await GET(
      new NextRequest(`http://localhost/api/group/listings?groupId=${defaultSearchGroup.id}`, {
        headers: { "X-Invite-Code": TEST_INVITE_CODE },
      }),
    );
    const payload = (await response.json()) as { ok: boolean; snapshot?: { groupId: string } };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, snapshot: { groupId: defaultSearchGroup.id } });
  });

  it("does not accept invite codes from the query string", async () => {
    mockState.env = { DB: createEmptyD1() };

    const response = await GET(
      new NextRequest(`http://localhost/api/group/listings?inviteCode=${TEST_INVITE_CODE}`),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "authentication-required" });
  });

  it("scopes the snapshot to the authenticated group, ignoring a groupId query", async () => {
    mockState.env = { DB: createEmptyD1() };

    const response = await GET(
      new NextRequest("http://localhost/api/group/listings?groupId=someone-elses-group", {
        headers: { "X-Invite-Code": TEST_INVITE_CODE },
      }),
    );

    expect(await response.json()).toMatchObject({
      ok: true,
      snapshot: { groupId: defaultSearchGroup.id },
    });
  });

  it("rejects requests when no invite code is supplied", async () => {
    mockState.env = { DB: createEmptyD1() };

    const response = await GET(
      new NextRequest(`http://localhost/api/group/listings?groupId=${defaultSearchGroup.id}`),
    );
    const payload = (await response.json()) as { ok: boolean; error?: string };

    expect(response.status).toBe(401);
    expect(payload).toEqual({ ok: false, error: "authentication-required" });
  });
});

function createEmptyD1(): D1DatabaseLike {
  return {
    prepare: vi.fn(() => {
      const statement = {
        bind: vi.fn(() => statement),
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => undefined),
      };

      return statement;
    }),
  };
}
