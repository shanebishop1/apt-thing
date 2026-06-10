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
        headers: { "X-Invite-Code": defaultSearchGroup.inviteCode },
      }),
    );
    const payload = (await response.json()) as { ok: boolean; snapshot?: { groupId: string } };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, snapshot: { groupId: defaultSearchGroup.id } });
  });

  it("accepts explicit query-string invite codes for operator/API callers", async () => {
    mockState.env = { DB: createEmptyD1() };

    const response = await GET(
      new NextRequest(
        `http://localhost/api/group/listings?groupId=${defaultSearchGroup.id}&inviteCode=${defaultSearchGroup.inviteCode}`,
      ),
    );
    const payload = (await response.json()) as { ok: boolean; error?: string };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, snapshot: { groupId: defaultSearchGroup.id } });
  });

  it("rejects requests when no invite code is supplied", async () => {
    mockState.env = { DB: createEmptyD1() };

    const response = await GET(
      new NextRequest(`http://localhost/api/group/listings?groupId=${defaultSearchGroup.id}`),
    );
    const payload = (await response.json()) as { ok: boolean; error?: string };

    expect(response.status).toBe(403);
    expect(payload).toEqual({ ok: false, error: "invalid-invite-code" });
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
