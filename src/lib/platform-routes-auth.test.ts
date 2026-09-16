import { TEST_INVITE_CODE } from "../test-support/group-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildPlatformSmokePayload, GET as smokeGET } from "../../app/api/platform/smoke/route";
import { GET as tileGET } from "../../app/api/map/tiles/[z]/[x]/[y]/route";

describe("platform API route authorization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects platform smoke without the group code", async () => {
    const response = await smokeGET(new NextRequest("http://localhost/api/platform/smoke"));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: "authentication-required" });
  });

  it("accepts platform smoke with the group code", async () => {
    const response = await smokeGET(
      new NextRequest("http://localhost/api/platform/smoke", {
        headers: { "X-Invite-Code": TEST_INVITE_CODE },
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, runtime: "cloudflare-workers" });
  });

  it("reports binding state for available and unavailable Cloudflare contexts", () => {
    expect(buildPlatformSmokePayload()).toMatchObject({
      ok: true,
      runtime: "cloudflare-workers",
      contextStatus: "unavailable",
      appEnv: "unknown",
      bindings: {
        db: "missing",
        appCache: "missing",
        assets: "missing",
      },
      rawArtifacts: { storage: "disabled" },
    });

    expect(
      buildPlatformSmokePayload({
        APP_ENV: "local",
        DB: {},
        APP_CACHE: {},
        ASSETS: {},
      }),
    ).toMatchObject({
      ok: true,
      runtime: "cloudflare-workers",
      contextStatus: "available",
      appEnv: "local",
      bindings: {
        db: "bound",
        appCache: "bound",
        assets: "bound",
      },
      rawArtifacts: { storage: "disabled" },
    });
  });

  it("rejects map tile proxy requests without the group code", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await tileGET(
      new NextRequest("http://localhost/api/map/tiles/13/2412/3077.png"),
      {
        params: Promise.resolve({ z: "13", x: "2412", y: "3077.png" }),
      },
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: "authentication-required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches Stadia tiles through the server-side key after group-code authorization", async () => {
    vi.stubEnv("STADIA_MAPS_API_KEY", "server-only-test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("tile", {
        headers: { "content-type": "image/png" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await tileGET(
      new NextRequest("http://localhost/api/map/tiles/13/2412/3077.png", {
        headers: { "X-Invite-Code": TEST_INVITE_CODE },
      }),
      { params: Promise.resolve({ z: "13", x: "2412", y: "3077.png" }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstreamUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(upstreamUrl.toString()).toBe(
      "https://tiles.stadiamaps.com/tiles/alidade_smooth/13/2412/3077.png?api_key=server-only-test-key",
    );
  });

  it("falls back to OpenStreetMap tiles when Stadia rejects the server-side request", async () => {
    vi.stubEnv("STADIA_MAPS_API_KEY", "server-only-test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(
        new Response("fallback-tile", {
          headers: { "content-type": "image/png" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await tileGET(
      new NextRequest("http://localhost/api/map/tiles/13/2412/3077.png", {
        headers: { "X-Invite-Code": TEST_INVITE_CODE },
      }),
      { params: Promise.resolve({ z: "13", x: "2412", y: "3077.png" }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://tile.openstreetmap.org/13/2412/3077.png",
    );
  });

  it("returns 502 when both tile upstreams throw instead of responding", async () => {
    vi.stubEnv("STADIA_MAPS_API_KEY", "server-only-test-key");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failure"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await tileGET(
      new NextRequest("http://localhost/api/map/tiles/13/2412/3077.png", {
        headers: { "X-Invite-Code": TEST_INVITE_CODE },
      }),
      { params: Promise.resolve({ z: "13", x: "2412", y: "3077.png" }) },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, error: "tile-fetch-failed" });
  });

  it("falls back to OpenStreetMap tiles when the Stadia request throws", async () => {
    vi.stubEnv("STADIA_MAPS_API_KEY", "server-only-test-key");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network failure"))
      .mockResolvedValueOnce(
        new Response("fallback-tile", {
          headers: { "content-type": "image/png" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await tileGET(
      new NextRequest("http://localhost/api/map/tiles/13/2412/3077.png", {
        headers: { "X-Invite-Code": TEST_INVITE_CODE },
      }),
      { params: Promise.resolve({ z: "13", x: "2412", y: "3077.png" }) },
    );

    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://tile.openstreetmap.org/13/2412/3077.png",
    );
  });

  it("uses non-retina OpenStreetMap fallback tiles for retina requests", async () => {
    vi.stubEnv("STADIA_MAPS_API_KEY", "server-only-test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(new Response("fallback-tile", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await tileGET(
      new NextRequest("http://localhost/api/map/tiles/13/2412/3077@2x.png", {
        headers: { "X-Invite-Code": TEST_INVITE_CODE },
      }),
      { params: Promise.resolve({ z: "13", x: "2412", y: "3077@2x.png" }) },
    );

    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://tile.openstreetmap.org/13/2412/3077.png",
    );
  });
});
