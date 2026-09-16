import { describe, expect, it } from "vitest";
import { stableHash } from "./ids";

describe("stableHash", () => {
  it("is deterministic across calls so re-runs reuse the same record ids", () => {
    const value = "nyc-5br-2026:daily-loop:daily:cron:2026-06-07T21:00:00.000Z";

    expect(stableHash(value)).toBe(stableHash(value));
    expect(stableHash(value)).toMatch(/^[0-9a-z]+$/);
  });

  it("separates inputs that differ only slightly, including multi-byte ones", () => {
    expect(stableHash("listing-a")).not.toBe(stableHash("listing-b"));
    expect(stableHash("https://example.com/1")).not.toBe(stableHash("https://example.com/2"));
    expect(stableHash("café")).not.toBe(stableHash("cafe"));
    expect(stableHash("")).toBe("0");
  });
});
