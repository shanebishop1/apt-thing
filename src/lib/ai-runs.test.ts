import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/platform/daily-loop/route";
import { extractListingFromUrlLive } from "./single-link-extraction";
import { runDailySourceAgentLoop } from "./daily-source-loop";
import { scheduledDailySourceAgentLoop } from "./daily-source-worker";
import { createGroupIdentity, defaultSearchGroup } from "./listings";
import { TEST_INVITE_CODE } from "../test-support/group-auth";
import { POST as saveListing } from "../../app/api/group/listings/route";
import { createSqliteD1 } from "../test-support/sqlite-d1";
import { areAiRunsEnabled } from "./ai-runs";

const { runtimeEnv } = vi.hoisted(() => ({ runtimeEnv: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: runtimeEnv }),
}));

const identity = createGroupIdentity(defaultSearchGroup.id, "Paused AI test")!;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const key of Object.keys(runtimeEnv)) delete runtimeEnv[key];
});

describe("paid AI run switch", () => {
  it.each(["true", "1", " ON "])("explicitly opts in with %s", (value) => {
    expect(areAiRunsEnabled({ AI_RUNS_ENABLED: value })).toBe(true);
  });

  it("honors the Cloudflare off binding over process env and saves a manual record", async () => {
    const db = createSqliteD1();
    vi.stubEnv("AI_RUNS_ENABLED", "true");
    Object.assign(runtimeEnv, {
      DB: db,
      AI_RUNS_ENABLED: "false",
      GEMINI_API_KEY: "test-gemini",
      REALTYAPI_KEY: "test-realty",
    });
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected network"));
    try {
      const response = await saveListing(
        new NextRequest("http://localhost/api/group/listings", {
          method: "POST",
          headers: { "X-Invite-Code": TEST_INVITE_CODE, "Content-Type": "application/json" },
          body: JSON.stringify({
            url: "https://streeteasy.com/building/manual-paused/1",
            AI_RUNS_ENABLED: "true",
          }),
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        result: { extraction: { failureCode: "ai-runs-disabled", providerCalled: false } },
        snapshot: { listings: [expect.objectContaining({ extractionStatus: "manual-needed" })] },
      });
      expect(network).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
  it.each(["false", "0", " OFF ", "", "typo", undefined])(
    "blocks manual live runs when disabled (%s)",
    async (value) => {
      vi.stubEnv("AI_RUNS_ENABLED", value);
      vi.stubEnv("REALTYAPI_KEY", "test-realty");
      vi.stubEnv("GEMINI_API_KEY", "test-gemini");
      const network = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("unexpected network"));
      const response = await POST(
        new NextRequest("http://localhost/api/platform/daily-loop", {
          method: "POST",
          headers: { "X-Invite-Code": TEST_INVITE_CODE, "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "live-safe", AI_RUNS_ENABLED: "true" }),
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, error: "ai-runs-disabled" });
      expect(network).not.toHaveBeenCalled();
    },
  );

  it("skips scheduled Workflow creation even with the schedule enabled", async () => {
    const create = vi.fn();
    const env = {
      AI_RUNS_ENABLED: "false",
      DAILY_LOOP_ENABLED: "true",
      DAILY_SOURCE_AGENT_LOOP_WORKFLOW: { create },
    };
    const result = await scheduledDailySourceAgentLoop(
      { cron: "0 10 * * *", scheduledTime: Date.now() },
      env,
    );
    expect(result).toMatchObject({
      disabled: true,
      reason: "ai-runs-disabled",
      envVar: "AI_RUNS_ENABLED",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks direct live execution before touching D1", async () => {
    const prepare = vi.fn(() => {
      throw new Error("unexpected database access");
    });
    await expect(
      runDailySourceAgentLoop({
        mode: "live-safe",
        env: { AI_RUNS_ENABLED: "false", DB: { prepare } },
      }),
    ).rejects.toThrow("ai-runs-disabled");
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each(["https://streeteasy.com/building/paused/1", "https://example.com/paused"])(
    "saves manual-needed data without requests: %s",
    async (rawUrl) => {
      const fetchImpl = vi.fn();
      const env = {
        AI_RUNS_ENABLED: "false",
        GEMINI_API_KEY: "test-gemini",
        REALTYAPI_KEY: "test-realty",
      };
      const result = await extractListingFromUrlLive({ rawUrl, identity, env, fetchImpl });
      expect(result.listing).toMatchObject({ url: rawUrl, extractionStatus: "manual-needed" });
      expect(result.extraction).toMatchObject({
        providerCalled: false,
        sourcePageFetched: false,
        failureCode: "ai-runs-disabled",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("keeps fixture mode offline even when keys and AI are enabled", async () => {
    const fetchImpl = vi.fn();
    const result = await runDailySourceAgentLoop({
      mode: "fixture",
      env: { AI_RUNS_ENABLED: "true", GEMINI_API_KEY: "test-gemini", REALTYAPI_KEY: "test-realty" },
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
