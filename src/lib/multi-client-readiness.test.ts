import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as listingsGET, POST as listingsPOST } from "../../app/api/group/listings/route";
import {
  PATCH as listingPATCH,
  POST as listingActionPOST,
} from "../../app/api/group/listings/[listingId]/route";
import { GET as runsGET } from "../../app/api/group/runs/route";
import { POST as sessionPOST } from "../../app/api/group/session/route";
import { TEST_INVITE_CODE } from "../test-support/group-auth";
import { createSqliteD1, type SqliteD1 } from "../test-support/sqlite-d1";
import { runDailySourceAgentLoop } from "./daily-source-loop";
import { createGroupIdentity, defaultSearchGroup, type ListingCandidate } from "./listings";
import type { PersistedRunHistory } from "./run-history-store";
import type { SharedListingSnapshot } from "./shared-listing-store";

const mockState = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: mockState.env }),
}));

type ApiBody = {
  ok: boolean;
  error?: string;
  snapshot: SharedListingSnapshot;
  listing?: ListingCandidate;
  result?: { kind: string; listing: ListingCandidate };
};

/** A browser-like client that holds only its own session cookie and last observed snapshot. */
class Client {
  private cookie = "";
  snapshot?: SharedListingSnapshot;

  constructor(private readonly displayName: string) {}

  async signIn() {
    const response = await sessionPOST(
      this.request("/api/group/session", "POST", {
        inviteCode: TEST_INVITE_CODE,
        displayName: this.displayName,
      }),
    );
    expect(response.status).toBe(200);
    this.cookie = /apt_group_session=[^;]+/.exec(response.headers.get("set-cookie") ?? "")![0];
  }

  async poll() {
    return this.observe(await listingsGET(this.request("/api/group/listings")));
  }

  async create(url: string) {
    return this.observe(await listingsPOST(this.request("/api/group/listings", "POST", { url })));
  }

  listing(id: string) {
    return this.snapshot?.listings.find((listing) => listing.id === id);
  }

  async patch(listingId: string, mutation: Record<string, unknown>) {
    const response = await listingPATCH(
      this.request(`/api/group/listings/${listingId}`, "PATCH", {
        ...mutation,
        revision: this.listing(listingId)?.revision,
      }),
      { params: Promise.resolve({ listingId }) },
    );
    return this.observe(response);
  }

  async act(listingId: string, action: Record<string, unknown>) {
    const response = await listingActionPOST(
      this.request(`/api/group/listings/${listingId}`, "POST", action),
      { params: Promise.resolve({ listingId }) },
    );
    return this.observe(response);
  }

  async runs() {
    const response = await runsGET(this.request("/api/group/runs"));
    return (await response.json()) as { ok: boolean; history: PersistedRunHistory };
  }

  private async observe(response: Response) {
    const body = (await response.json()) as ApiBody;
    // Mirror the UI: success and 409/404 responses both carry the current snapshot to adopt.
    if (body.snapshot) this.snapshot = body.snapshot;
    return { status: response.status, body };
  }

  private request(path: string, method = "GET", body?: unknown) {
    return new NextRequest(`https://apt.test${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

let db: SqliteD1;

beforeEach(() => {
  db = createSqliteD1();
  mockState.env = { DB: db };
  vi.stubEnv("GEMINI_API_KEY", "");
  // No provider or source-page traffic: extraction degrades to an editable manual-review record.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network disabled in tests")));
});

afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("two-client shared list readiness", () => {
  it("syncs create, edit, status, comments, and reactions, and rejects stale or removed writes", async () => {
    const alice = new Client("Alice");
    const bob = new Client("Bob");
    await alice.signIn();
    await bob.signIn();

    const created = await alice.create("https://example.invalid/listing/two-client");
    expect(created.status).toBe(200);
    const listingId = created.body.result!.listing.id;
    expect(alice.listing(listingId)?.revision).toBe(1);

    await bob.poll();
    expect(bob.listing(listingId)).toMatchObject({ revision: 1 });
    expect((await bob.create("https://example.invalid/listing/two-client")).body.result?.kind).toBe(
      "duplicate",
    );

    const aliceEdit = await alice.patch(listingId, {
      mutation: "field",
      field: "title",
      value: "Alice's title",
    });
    expect(aliceEdit.status).toBe(200);
    expect(alice.listing(listingId)).toMatchObject({ title: "Alice's title", revision: 2 });

    // Bob has not polled since Alice's edit: his write is stale and must not land.
    const staleEdit = await bob.patch(listingId, { mutation: "field", field: "rent", value: 9000 });
    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body).toMatchObject({
      error: "listing-revision-conflict",
      listing: { title: "Alice's title", revision: 2 },
    });
    expect(bob.listing(listingId)).toMatchObject({ title: "Alice's title", revision: 2 });
    expect(bob.listing(listingId)?.rent).not.toBe(9000);

    // After adopting the conflict snapshot, Bob's retry applies on top of Alice's change.
    expect((await bob.patch(listingId, { mutation: "status", status: "interested" })).status).toBe(
      200,
    );
    await bob.act(listingId, { actionType: "comment", commentBody: "Worth a tour" });
    await bob.act(listingId, { actionType: "reaction", reaction: "thumbs-up" });

    await alice.poll();
    expect(alice.listing(listingId)).toMatchObject({
      title: "Alice's title",
      reviewStatus: "interested",
      revision: 3,
    });
    expect(alice.snapshot!.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionType: "comment", actorDisplayName: "Bob" }),
        expect.objectContaining({ actionType: "reaction", reaction: "thumbs-up" }),
      ]),
    );

    // Bob rejects from current state; Alice's delayed edit from revision 3 cannot recreate it.
    expect(
      (await bob.patch(listingId, { mutation: "review-decision", decision: "reject" })).status,
    ).toBe(200);
    const delayed = await alice.patch(listingId, {
      mutation: "field",
      field: "title",
      value: "Too late",
    });
    expect(delayed.status).toBe(404);
    expect(delayed.body.error).toBe("listing-not-found");
    expect(alice.listing(listingId)).toBeUndefined();
    expect((await alice.act(listingId, { actionType: "comment", commentBody: "?" })).status).toBe(
      404,
    );

    await bob.poll();
    expect(bob.snapshot!.listings).toHaveLength(0);
    expect(bob.snapshot!.memory).toEqual([
      expect.objectContaining({
        memoryState: "rejected",
        sourceUrl: created.body.result!.listing.url,
      }),
    ]);
  });

  it("shows both clients the same persisted run history instead of fixtures", async () => {
    const alice = new Client("Alice");
    const bob = new Client("Bob");
    await alice.signIn();
    await bob.signIn();

    expect((await alice.runs()).history.runs).toEqual([]);

    const run = await runDailySourceAgentLoop({
      identity: createGroupIdentity(defaultSearchGroup.id, "Operator")!,
      env: { DB: db },
      cadence: "manual",
      trigger: "manual",
    });

    const [aliceRuns, bobRuns] = await Promise.all([alice.runs(), bob.runs()]);
    expect(aliceRuns.history.runs.map((item) => item.runId)).toEqual([run.run.id]);
    expect(bobRuns.history).toEqual({
      ...aliceRuns.history,
      generatedAt: bobRuns.history.generatedAt,
    });
  });
});
