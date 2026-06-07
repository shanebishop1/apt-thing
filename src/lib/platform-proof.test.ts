import { describe, expect, it } from "vitest";
import { runCloudflareBindingProof } from "./platform-proof";

class MockD1Database {
  rows = new Map<string, { group_id: string; payload_json: string }>();

  prepare(sql: string) {
    return new MockD1Statement(this, sql);
  }
}

class MockD1Statement {
  values: unknown[] = [];

  constructor(
    private readonly db: MockD1Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    if (this.sql.startsWith("INSERT")) {
      const [id, groupId, payloadJson] = this.values as [string, string, string];
      this.db.rows.set(id, { group_id: groupId, payload_json: payloadJson });
    }

    if (this.sql.startsWith("DELETE")) {
      const [id] = this.values as [string];
      this.db.rows.delete(id);
    }

    return { success: true };
  }

  async first<T>() {
    const [id] = this.values as [string];
    return (this.db.rows.get(id) ?? null) as T | null;
  }
}

class MockR2Object {
  constructor(private readonly value: string) {}

  async text() {
    return this.value;
  }
}

class MockR2Bucket {
  objects = new Map<string, string>();

  async put(key: string, value: string) {
    this.objects.set(key, value);
    return null;
  }

  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : new MockR2Object(value);
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

class MockKVNamespace {
  values = new Map<string, string>();

  async put(key: string, value: string) {
    this.values.set(key, value);
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}

describe("Cloudflare binding proof", () => {
  it("writes, reads, and deletes D1/R2/KV fixture data while keeping KV cache/config only", async () => {
    const env = {
      DB: new MockD1Database() as unknown as D1Database,
      RAW_ARTIFACTS: new MockR2Bucket() as unknown as R2Bucket,
      APP_CACHE: new MockKVNamespace() as unknown as KVNamespace,
    };

    const result = await runCloudflareBindingProof(env, {
      groupId: "nyc-5br-2026",
      proofId: "proof-test-1",
    });

    expect(result.ok).toBe(true);
    expect(result.d1).toMatchObject({ ok: true, skipped: false });
    expect(result.r2).toMatchObject({ ok: true, skipped: false });
    expect(result.kv).toMatchObject({ ok: true, skipped: false, authoritativeState: false });
    expect(result.notes.join(" ")).toContain("KV is cache/config only");
  });

  it("reports skipped binding proof steps when worker bindings are unavailable", async () => {
    const result = await runCloudflareBindingProof(undefined, { proofId: "missing-bindings" });

    expect(result.ok).toBe(false);
    expect(result.d1).toMatchObject({ binding: "D1", skipped: true });
    expect(result.r2).toMatchObject({ binding: "R2", skipped: true });
    expect(result.kv).toMatchObject({ binding: "KV", skipped: true, authoritativeState: false });
  });
});
