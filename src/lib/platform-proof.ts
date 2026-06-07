import { runGeminiStructuredOutputProof, type GeminiStructuredOutputProofResult } from "./gemini";
import { defaultSearchGroup } from "./listings";
import {
  simulateScheduledWorkflowFanout,
  type ScheduledWorkflowFanoutResult,
} from "./workflow-queue";

export type PlatformProofEnv = Partial<{
  DB: D1Database;
  RAW_ARTIFACTS: R2Bucket;
  APP_CACHE: KVNamespace;
}>;

export type BindingProofStep = {
  binding: "D1" | "R2" | "KV";
  ok: boolean;
  skipped: boolean;
  operation: string;
  detail: string;
};

export type CloudflareBindingProofResult = {
  contract: "cloudflare-binding-proof-v1";
  ok: boolean;
  groupId: string;
  proofId: string;
  d1: BindingProofStep;
  r2: BindingProofStep;
  kv: BindingProofStep & { authoritativeState: false };
  notes: string[];
};

export type G2BPlatformProofResult = {
  ok: boolean;
  bindingProof: CloudflareBindingProofResult;
  workflowProof: ScheduledWorkflowFanoutResult;
  geminiProof: GeminiStructuredOutputProofResult;
};

type D1SmokeRow = {
  group_id: string;
  payload_json: string;
};

export async function runCloudflareBindingProof(
  env: PlatformProofEnv | undefined,
  {
    groupId = defaultSearchGroup.id,
    proofId = `g2b-binding-proof-${Date.now()}`,
  }: { groupId?: string; proofId?: string } = {},
): Promise<CloudflareBindingProofResult> {
  const d1 = env?.DB
    ? await proveD1(env.DB, groupId, proofId)
    : skippedStep("D1", "write/read/delete group-scoped smoke row", "DB binding unavailable");
  const r2 = env?.RAW_ARTIFACTS
    ? await proveR2(env.RAW_ARTIFACTS, groupId, proofId)
    : skippedStep(
        "R2",
        "write/read/delete raw artifact pointer fixture",
        "RAW_ARTIFACTS binding unavailable",
      );
  const kvBase = env?.APP_CACHE
    ? await proveKV(env.APP_CACHE, proofId)
    : skippedStep("KV", "write/read/delete cache/config fixture", "APP_CACHE binding unavailable");
  const kv = { ...kvBase, authoritativeState: false as const };

  return {
    contract: "cloudflare-binding-proof-v1",
    ok: d1.ok && r2.ok && kv.ok,
    groupId,
    proofId,
    d1,
    r2,
    kv,
    notes: [
      "D1 is the authoritative relational owner for listing/group/run state.",
      "R2 stores raw source/evidence artifacts and D1 stores pointers/metadata.",
      "KV is cache/config only and is never authoritative listing or group-review state.",
    ],
  };
}

export async function runG2BPlatformProof({
  env,
  geminiApiKey,
}: {
  env?: PlatformProofEnv;
  geminiApiKey?: string;
} = {}): Promise<G2BPlatformProofResult> {
  const [bindingProof, workflowProof, geminiProof] = await Promise.all([
    runCloudflareBindingProof(env),
    simulateScheduledWorkflowFanout(),
    runGeminiStructuredOutputProof({ apiKey: geminiApiKey, fixtureFallback: true }),
  ]);

  return {
    ok: bindingProof.ok && workflowProof.runLog.status === "partial" && geminiProof.ok,
    bindingProof,
    workflowProof,
    geminiProof,
  };
}

async function proveD1(
  db: D1Database,
  groupId: string,
  proofId: string,
): Promise<BindingProofStep> {
  try {
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS platform_binding_smoke (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)",
      )
      .run();
    await db
      .prepare(
        "INSERT OR REPLACE INTO platform_binding_smoke (id, group_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(
        proofId,
        groupId,
        JSON.stringify({ proofId, groupId, owner: "d1" }),
        new Date().toISOString(),
      )
      .run();
    const row = await db
      .prepare("SELECT group_id, payload_json FROM platform_binding_smoke WHERE id = ?")
      .bind(proofId)
      .first<D1SmokeRow>();
    await db.prepare("DELETE FROM platform_binding_smoke WHERE id = ?").bind(proofId).run();

    const payload = row
      ? (JSON.parse(row.payload_json) as { proofId?: string; owner?: string })
      : undefined;

    return {
      binding: "D1",
      ok: row?.group_id === groupId && payload?.proofId === proofId && payload.owner === "d1",
      skipped: false,
      operation: "write/read/delete group-scoped smoke row",
      detail: `groupId=${row?.group_id ?? "missing"}; proofId=${payload?.proofId ?? "missing"}`,
    };
  } catch (error) {
    return failedStep("D1", "write/read/delete group-scoped smoke row", error);
  }
}

async function proveR2(
  bucket: R2Bucket,
  groupId: string,
  proofId: string,
): Promise<BindingProofStep> {
  const key = `${groupId}/platform-proof/${proofId}.json`;
  const payload = {
    groupId,
    proofId,
    sourceUrl: "https://streeteasy.com/building/batch-save/3",
    pointerRole: "raw-artifact-fixture",
  };

  try {
    await bucket.put(key, JSON.stringify(payload), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { groupId, proofId },
    });
    const object = await bucket.get(key);
    const text = object ? await object.text() : "";
    await bucket.delete(key);
    const deleted = (await bucket.get(key)) === null;
    const parsed = JSON.parse(text) as typeof payload;

    return {
      binding: "R2",
      ok: parsed.groupId === groupId && parsed.proofId === proofId && deleted,
      skipped: false,
      operation: "write/read/delete raw artifact pointer fixture",
      detail: `key=${key}; deleted=${String(deleted)}`,
    };
  } catch (error) {
    return failedStep("R2", "write/read/delete raw artifact pointer fixture", error);
  }
}

async function proveKV(cache: KVNamespace, proofId: string): Promise<BindingProofStep> {
  const key = `config:g2b-platform-proof:${proofId}`;
  const payload = {
    proofId,
    role: "cache-config-only",
    authoritativeListingState: false,
  };

  try {
    await cache.put(key, JSON.stringify(payload));
    const text = await cache.get(key);
    await cache.delete(key);
    const deleted = (await cache.get(key)) === null;
    const parsed = text ? (JSON.parse(text) as typeof payload) : undefined;

    return {
      binding: "KV",
      ok:
        parsed?.role === "cache-config-only" &&
        parsed.authoritativeListingState === false &&
        deleted,
      skipped: false,
      operation: "write/read/delete cache/config fixture",
      detail: `key=${key}; deleted=${String(deleted)}; authoritativeListingState=false`,
    };
  } catch (error) {
    return failedStep("KV", "write/read/delete cache/config fixture", error);
  }
}

function skippedStep(
  binding: BindingProofStep["binding"],
  operation: string,
  detail: string,
): BindingProofStep {
  return { binding, ok: false, skipped: true, operation, detail };
}

function failedStep(
  binding: BindingProofStep["binding"],
  operation: string,
  error: unknown,
): BindingProofStep {
  return {
    binding,
    ok: false,
    skipped: false,
    operation,
    detail: error instanceof Error ? error.message : "Unknown binding proof failure",
  };
}
