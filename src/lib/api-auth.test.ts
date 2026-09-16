import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as listingsGET, POST as listingsPOST } from "../../app/api/group/listings/route";
import {
  PATCH as listingPATCH,
  POST as listingActionPOST,
} from "../../app/api/group/listings/[listingId]/route";
import { GET as runsGET } from "../../app/api/group/runs/route";
import { DELETE as sessionDELETE, POST as sessionPOST } from "../../app/api/group/session/route";
import { GET as tileGET } from "../../app/api/map/tiles/[z]/[x]/[y]/route";
import {
  GET as dailyLoopGET,
  POST as dailyLoopPOST,
} from "../../app/api/platform/daily-loop/route";
import { GET as smokeGET } from "../../app/api/platform/smoke/route";
import { TEST_GROUP_INVITE_CODES, TEST_INVITE_CODE } from "../test-support/group-auth";
import { createSqliteD1, type SqliteD1 } from "../test-support/sqlite-d1";
import {
  GROUP_SESSION_COOKIE,
  GROUP_SESSION_MAX_AGE_SECONDS,
  createGroupSession,
  matchInviteCode,
  parseGroupInviteCodes,
  verifyGroupSession,
} from "./api-auth";
import { defaultSearchGroup } from "./listings";

const mockState = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: mockState.env }),
}));

type Handler = (request: NextRequest) => Promise<Response>;
const params = <T>(value: T) => ({ params: Promise.resolve(value) });

const protectedRoutes: Array<{ name: string; method: string; path: string; handler: Handler }> = [
  { name: "listings GET", method: "GET", path: "/api/group/listings", handler: listingsGET },
  { name: "listings POST", method: "POST", path: "/api/group/listings", handler: listingsPOST },
  {
    name: "listing PATCH",
    method: "PATCH",
    path: "/api/group/listings/l1",
    handler: (request) => listingPATCH(request, params({ listingId: "l1" })),
  },
  {
    name: "listing action POST",
    method: "POST",
    path: "/api/group/listings/l1",
    handler: (request) => listingActionPOST(request, params({ listingId: "l1" })),
  },
  { name: "runs GET", method: "GET", path: "/api/group/runs", handler: runsGET },
  { name: "smoke GET", method: "GET", path: "/api/platform/smoke", handler: smokeGET },
  {
    name: "daily-loop GET",
    method: "GET",
    path: "/api/platform/daily-loop",
    handler: dailyLoopGET,
  },
  {
    name: "daily-loop POST",
    method: "POST",
    path: "/api/platform/daily-loop",
    handler: dailyLoopPOST,
  },
  {
    name: "map tile GET",
    method: "GET",
    path: "/api/map/tiles/13/2412/3077.png",
    handler: (request) => tileGET(request, params({ z: "13", x: "2412", y: "3077.png" })),
  },
];

let db: SqliteD1;
const fetchMock = vi.fn();

beforeEach(() => {
  db = createSqliteD1();
  mockState.env = { DB: db };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(
  path: string,
  {
    method = "GET",
    headers = {},
    body,
  }: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  return new NextRequest(`https://apt.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createSessionCookie(displayName = "Ari") {
  const response = await sessionPOST(
    request("/api/group/session", {
      method: "POST",
      body: { inviteCode: TEST_INVITE_CODE, displayName },
    }),
  );
  const cookie = response.headers.get("set-cookie") ?? "";
  return { response, cookie, value: /apt_group_session=([^;]+)/.exec(cookie)?.[1] ?? "" };
}

describe("GROUP_INVITE_CODES parsing", () => {
  it("keeps only long codes for known groups", () => {
    const codes = parseGroupInviteCodes(
      ` ${defaultSearchGroup.id} = ${TEST_INVITE_CODE} , unknown-group=${TEST_INVITE_CODE}, nyc-5br-2026=short,broken`,
    );

    expect([...codes.entries()]).toEqual([[defaultSearchGroup.id, TEST_INVITE_CODE]]);
    expect(parseGroupInviteCodes(`${defaultSearchGroup.id}=short`).size).toBe(0);
    expect(parseGroupInviteCodes(undefined).size).toBe(0);
  });

  it("matches invite codes exactly", async () => {
    const codes = parseGroupInviteCodes(TEST_GROUP_INVITE_CODES);

    expect(await matchInviteCode(codes, ` ${TEST_INVITE_CODE} `)).toBe(defaultSearchGroup.id);
    expect(await matchInviteCode(codes, `${TEST_INVITE_CODE}x`)).toBeUndefined();
    expect(await matchInviteCode(codes, "apt-g1")).toBeUndefined();
  });

  it("prefers the Cloudflare binding over process.env", async () => {
    vi.stubEnv("GROUP_INVITE_CODES", "");
    mockState.env = { DB: db, GROUP_INVITE_CODES: TEST_GROUP_INVITE_CODES };

    const response = await smokeGET(
      request("/api/platform/smoke", { headers: { "X-Invite-Code": TEST_INVITE_CODE } }),
    );

    expect(response.status).toBe(200);
  });
});

describe("group sessions", () => {
  it("issues an HTTP-only, SameSite=Strict, /api-scoped session for a valid invite", async () => {
    const { response, cookie } = await createSessionCookie(" Ari ");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      identity: {
        groupId: defaultSearchGroup.id,
        groupName: defaultSearchGroup.name,
        displayName: "Ari",
        identityToken: expect.stringMatching(/^actor_nyc-5br-2026_/),
      },
    });
    expect(cookie).toContain(`${GROUP_SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toMatch(/Path=\/api/);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).not.toContain(TEST_INVITE_CODE);
  });

  it("accepts an invite link and rejects wrong codes, blank names, and missing configuration", async () => {
    const post = (body: unknown) =>
      sessionPOST(request("/api/group/session", { method: "POST", body }));

    expect(
      (await post({ inviteCode: `https://apt.test/invite/${TEST_INVITE_CODE}`, displayName: "A" }))
        .status,
    ).toBe(200);

    const wrong = await post({ inviteCode: "apt-g1", displayName: "Ari" });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ ok: false, error: "invalid-invite-code" });
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const blank = await post({ inviteCode: TEST_INVITE_CODE, displayName: "  " });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ ok: false, error: "display-name-required" });

    vi.stubEnv("GROUP_INVITE_CODES", "");
    const unconfigured = await post({ inviteCode: TEST_INVITE_CODE, displayName: "Ari" });
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toEqual({ ok: false, error: "group-auth-unconfigured" });
  });

  it("clears the session cookie on DELETE", async () => {
    const response = await sessionDELETE(request("/api/group/session", { method: "DELETE" }));

    expect(response.headers.get("set-cookie")).toMatch(/apt_group_session=;.*Max-Age=0/i);
  });

  it("rejects tampered, expired, and rotated-code sessions", async () => {
    const codes = parseGroupInviteCodes(TEST_GROUP_INVITE_CODES);
    const identity = { groupId: defaultSearchGroup.id, displayName: "Ari" };
    const now = 2_000_000_000;
    const session = await createGroupSession(identity, TEST_INVITE_CODE, now);

    expect(await verifyGroupSession(session, codes, now)).toMatchObject(identity);

    const [version, groupId, , issuedAt, signature] = session.split(".");
    const renamed = [version, groupId, btoa("Mallory"), issuedAt, signature].join(".");
    expect(await verifyGroupSession(renamed, codes, now)).toBeUndefined();
    expect(await verifyGroupSession(`${session}x`, codes, now)).toBeUndefined();
    expect(await verifyGroupSession("garbage", codes, now)).toBeUndefined();
    expect(
      await verifyGroupSession(session, codes, now + GROUP_SESSION_MAX_AGE_SECONDS + 1),
    ).toBeUndefined();
    expect(
      await verifyGroupSession(
        session,
        parseGroupInviteCodes(`${defaultSearchGroup.id}=rotated-invite-code-0001`),
        now,
      ),
    ).toBeUndefined();
  });
});

describe("protected route authorization matrix", () => {
  for (const route of protectedRoutes) {
    describe(route.name, () => {
      const send = (headers: Record<string, string> = {}) =>
        route.handler(
          request(route.path, {
            method: route.method,
            headers,
            body: route.method === "GET" ? undefined : {},
          }),
        );

      it("returns 401 without credentials and never reaches D1 or upstream fetches", async () => {
        const prepare = vi.spyOn(db, "prepare");
        const response = await send();

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ ok: false, error: "authentication-required" });
        expect(prepare).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("returns 403 for a wrong X-Invite-Code, including the retired committed code", async () => {
        for (const code of ["apt-g1", `${TEST_INVITE_CODE}-wrong`]) {
          const response = await send({ "X-Invite-Code": code });
          expect(response.status).toBe(403);
          expect(await response.json()).toEqual({ ok: false, error: "invalid-invite-code" });
        }
      });

      it("returns 401 for a forged session cookie", async () => {
        const forged = await createGroupSession(
          { groupId: defaultSearchGroup.id, displayName: "Mallory" },
          "attacker-guessed-invite-code",
        );
        const response = await send({ Cookie: `${GROUP_SESSION_COOKIE}=${forged}` });

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ ok: false, error: "session-invalid" });
      });

      it("fails closed with 503 when no invite code is configured", async () => {
        vi.stubEnv("GROUP_INVITE_CODES", "");
        const response = await send({ "X-Invite-Code": TEST_INVITE_CODE });

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ ok: false, error: "group-auth-unconfigured" });
      });

      it("authorizes a valid session cookie", async () => {
        fetchMock.mockResolvedValue(new Response("tile", { status: 200 }));
        const { value } = await createSessionCookie();
        const response = await send({ Cookie: `${GROUP_SESSION_COOKIE}=${value}` });

        expect([401, 403, 503]).not.toContain(response.status);
      });
    });
  }

  it("authorizes session-authenticated writes as the session's display name", async () => {
    const { value } = await createSessionCookie("Session Sam");
    db.sqlite.exec(`
      INSERT INTO app_saved_listings (id, group_id, url, duplicate_key, group_scoped_duplicate_key, listing_json, created_at, updated_at)
      VALUES ('l1', '${defaultSearchGroup.id}', 'https://example.com/l1', 'k', 'g:k',
        '${JSON.stringify({ id: "l1", groupId: defaultSearchGroup.id, url: "https://example.com/l1" })}', 'now', 'now');
    `);

    const response = await listingActionPOST(
      request("/api/group/listings/l1", {
        method: "POST",
        headers: { Cookie: `${GROUP_SESSION_COOKIE}=${value}` },
        body: { actionType: "comment", commentBody: "Hi", displayName: "Spoofed" },
      }),
      params({ listingId: "l1" }),
    );
    const body = (await response.json()) as {
      snapshot: { actions: Array<Record<string, unknown>> };
    };

    expect(response.status).toBe(200);
    expect(body.snapshot.actions[0]).toMatchObject({ actorDisplayName: "Session Sam" });
  });
});

describe("client-facing sources", () => {
  it("contain no invite credential and no group invite metadata", () => {
    const roots = ["app", "src/components", "src/lib"];
    const offenders = roots
      .flatMap((root) => listSourceFiles(join(process.cwd(), root)))
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          source.includes("apt-g1") ||
          source.includes(TEST_INVITE_CODE) ||
          /inviteCode:\s*["'`][^"'`]/.test(source)
        );
      })
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(entry) ? [path] : [];
  });
}
