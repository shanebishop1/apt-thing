import { describe, expect, it } from "vitest";
import { parseJson, safeJson } from "./json";

describe("parseJson", () => {
  it("returns undefined instead of throwing on malformed stored JSON", () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson("[]")).toEqual([]);
    expect(parseJson("null")).toBeNull();
    expect(parseJson("")).toBeUndefined();
    expect(parseJson("{oops}")).toBeUndefined();
  });
});

describe("safeJson", () => {
  it("reads a JSON body without consuming the caller's response", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });

    expect(await safeJson(response)).toEqual({ ok: true });
    expect(response.bodyUsed).toBe(false);
  });

  it("returns undefined for empty or non-JSON bodies", async () => {
    expect(await safeJson(new Response("<html>nope</html>"))).toBeUndefined();
    expect(await safeJson(new Response(null, { status: 502 }))).toBeUndefined();
  });
});
