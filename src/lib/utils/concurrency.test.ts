import { describe, expect, it } from "vitest";
import { mapWithBoundedConcurrency, normalizeConcurrencyLimit } from "./concurrency";

describe("normalizeConcurrencyLimit", () => {
  it("clamps unusable limits to a single worker", () => {
    expect(normalizeConcurrencyLimit(0)).toBe(1);
    expect(normalizeConcurrencyLimit(0.5)).toBe(1);
    expect(normalizeConcurrencyLimit(-4)).toBe(1);
    expect(normalizeConcurrencyLimit(Number.NaN)).toBe(1);
    expect(normalizeConcurrencyLimit(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalizeConcurrencyLimit(2.9)).toBe(2);
  });
});

describe("mapWithBoundedConcurrency", () => {
  it("keeps input order while never exceeding the limit", async () => {
    let inFlight = 0;
    let peak = 0;

    const { results, maxObservedInFlight } = await mapWithBoundedConcurrency(
      [40, 10, 30, 0, 20],
      2,
      async (delay, index) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, delay));
        inFlight -= 1;
        return `${index}:${delay}`;
      },
    );

    expect(results).toEqual(["0:40", "1:10", "2:30", "3:0", "4:20"]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(maxObservedInFlight).toBe(peak);
  });

  it("runs serially for an unusable limit and does nothing for an empty list", async () => {
    let peak = 0;
    let inFlight = 0;

    const serial = await mapWithBoundedConcurrency([1, 2, 3], 0, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return item * 2;
    });

    expect(serial.results).toEqual([2, 4, 6]);
    expect(peak).toBe(1);

    const worker = () => Promise.reject(new Error("must not run"));
    await expect(mapWithBoundedConcurrency([], 4, worker)).resolves.toEqual({
      results: [],
      maxObservedInFlight: 0,
    });
  });

  it("releases its slot when a worker throws", async () => {
    await expect(
      mapWithBoundedConcurrency([1, 2], 1, () => {
        throw new Error("worker-failed");
      }),
    ).rejects.toThrow("worker-failed");
  });
});
