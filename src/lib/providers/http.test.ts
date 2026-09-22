import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./http";

afterEach(() => vi.useRealTimers());

describe("bounded provider transport", () => {
  it("retries transient failures once and reports each actual attempt", async () => {
    const attempts: unknown[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const response = await fetchWithRetry(
      "https://provider.test",
      {},
      { fetchImpl, retryDelayMs: 0, onAttempt: (attempt) => attempts.push(attempt) },
    );
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(attempts).toMatchObject([
      { attempt: 1, status: 503 },
      { attempt: 2, status: 200 },
    ]);
  });

  it("does not retry permanent failures or exceed the retry budget", async () => {
    for (const status of [401, 403, 404, 429, 503]) {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response(null, { status }));
      expect(
        (await fetchWithRetry("https://provider.test", {}, { fetchImpl, retryDelayMs: 0 })).status,
      ).toBe(status);
      expect(fetchImpl).toHaveBeenCalledTimes(status >= 429 ? 2 : 1);
    }
  });

  it("does not retry earlier than an oversized Retry-After", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    expect((await fetchWithRetry("https://provider.test", {}, { fetchImpl })).status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled response body and stops after two attempts", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(new ReadableStream({ start() {} })));
    const operation = fetchWithRetry(
      "https://provider.test",
      {},
      { fetchImpl, timeoutMs: 100, retryDelayMs: 0 },
    );
    const assertion = expect(operation).rejects.toThrow("provider-request-timeout");
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honors caller cancellation without another attempt", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    await expect(
      fetchWithRetry("https://provider.test", { signal: controller.signal }, { fetchImpl }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
