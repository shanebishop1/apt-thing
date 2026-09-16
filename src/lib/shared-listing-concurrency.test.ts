import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "../../app/api/group/listings/[listingId]/route";
import { applyMigrations, createSqliteD1, type SqliteD1 } from "../test-support/sqlite-d1";
import { DatabaseSync } from "node:sqlite";
import { fixtureListings } from "./fixtures";
import { runDailySourceAgentLoop } from "./daily-source-loop";
import { createInviteIdentity, defaultSearchGroup, type ListingCandidate } from "./listings";
import {
  ListingMutationError,
  mutateSharedListingField,
  mutateSharedListingReviewDecision,
  mutateSharedListingStatus,
} from "./shared-listing-api";
import {
  insertSavedListing,
  readSavedListing,
  readSharedListingSnapshot,
} from "./shared-listing-store";

const mockState = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: mockState.env }),
}));

const alice = createInviteIdentity(defaultSearchGroup.inviteCode, "Alice")!;
const bob = createInviteIdentity(defaultSearchGroup.inviteCode, "Bob")!;
let db: SqliteD1;
let listing: ListingCandidate;

beforeEach(async () => {
  db = createSqliteD1();
  mockState.env = { DB: db };
  const created = await insertSavedListing(db, { ...fixtureListings[0]!, groupId: alice.groupId });
  listing = created.listing;
});

afterEach(() => db.close());

describe("shared listing optimistic concurrency (SQLite/D1 semantics)", () => {
  it("creates listings at revision 1 and exposes the revision on reads", async () => {
    expect(listing.revision).toBe(1);
    expect((await readSavedListing(db, alice.groupId, listing.id))?.revision).toBe(1);
    expect((await readSharedListingSnapshot(db, alice.groupId)).listings[0]?.revision).toBe(1);
  });

  it("resolves a concurrent create of the same listing to the stored duplicate", async () => {
    const again = await insertSavedListing(db, { ...listing, title: "Overwrite attempt" });

    expect(again.kind).toBe("duplicate");
    expect((await readSavedListing(db, alice.groupId, listing.id))?.title).toBe(listing.title);
  });

  it("edit/edit race: exactly one write wins and the other conflicts", async () => {
    const results = await Promise.allSettled([
      mutateSharedListingField({
        db,
        identity: alice,
        listingId: listing.id,
        field: "title",
        value: "Alice title",
        expectedRevision: 1,
      }),
      mutateSharedListingField({
        db,
        identity: bob,
        listingId: listing.id,
        field: "rent",
        value: 12000,
        expectedRevision: 1,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(ListingMutationError);
    expect(error).toMatchObject({ code: "listing-revision-conflict", status: 409 });
    expect(error.current.revision).toBe(2);

    const stored = await readSavedListing(db, alice.groupId, listing.id);
    expect(stored?.revision).toBe(2);
    expect(stored?.title === "Alice title").not.toBe(stored?.rent === 12000);
  });

  it("edit/reject race: the rejected listing is never recreated by the edit", async () => {
    const results = await Promise.allSettled([
      mutateSharedListingReviewDecision({
        db,
        identity: alice,
        listingId: listing.id,
        decision: "reject",
        expectedRevision: 1,
      }),
      mutateSharedListingField({
        db,
        identity: bob,
        listingId: listing.id,
        field: "title",
        value: "Late edit",
        expectedRevision: 1,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const stored = await readSavedListing(db, alice.groupId, listing.id);
    if (results[0].status === "fulfilled") {
      expect(stored).toBeUndefined();
      expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
        code: "listing-not-found",
        status: 404,
      });
    } else {
      expect(stored).toMatchObject({ title: "Late edit", revision: 2 });
      expect((results[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "listing-revision-conflict",
      });
    }
  });

  it("rejects a delayed edit after rejection with 404 and leaves no row behind", async () => {
    await mutateSharedListingReviewDecision({
      db,
      identity: alice,
      listingId: listing.id,
      decision: "reject",
      expectedRevision: 1,
    });

    await expect(
      mutateSharedListingStatus({
        db,
        identity: bob,
        listingId: listing.id,
        status: "touring",
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "listing-not-found" });
    expect(await readSavedListing(db, alice.groupId, listing.id)).toBeUndefined();
    const snapshot = await readSharedListingSnapshot(db, alice.groupId);
    expect(snapshot.listings).toHaveLength(0);
    expect(snapshot.memory).toHaveLength(1);
    expect(snapshot.actions).toHaveLength(0);
  });

  it("does not record side effects for a stale status change", async () => {
    await mutateSharedListingStatus({
      db,
      identity: alice,
      listingId: listing.id,
      status: "interested",
      expectedRevision: 1,
    });

    await expect(
      mutateSharedListingStatus({
        db,
        identity: bob,
        listingId: listing.id,
        status: "rejected",
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "listing-revision-conflict" });
    const snapshot = await readSharedListingSnapshot(db, alice.groupId);
    expect(snapshot.listings[0]).toMatchObject({ reviewStatus: "interested", revision: 2 });
    expect(snapshot.actions).toHaveLength(1);
    expect(snapshot.memory).toHaveLength(0);
  });

  it("increments the revision when the daily loop rewrites a saved listing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const identity = createInviteIdentity(defaultSearchGroup.inviteCode, "Loop")!;
    const now = "2026-09-15T00:00:00.000Z";
    const first = await runDailySourceAgentLoop({ identity, env: { DB: db }, now });
    const loopListing = first.listings[0]!;
    await runDailySourceAgentLoop({ identity, env: { DB: db }, now });
    vi.unstubAllEnvs();

    expect((await readSavedListing(db, identity.groupId, loopListing.id))?.revision).toBe(2);
  });
});

describe("PATCH /api/group/listings/:id revision contract", () => {
  const patch = (body: Record<string, unknown>, listingId = listing.id) =>
    PATCH(
      new NextRequest(`http://localhost/api/group/listings/${listingId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Invite-Code": defaultSearchGroup.inviteCode,
        },
        body: JSON.stringify({ displayName: "Route Tester", ...body }),
      }),
      { params: Promise.resolve({ listingId }) },
    );

  it("requires a revision for existing-record mutations", async () => {
    const response = await patch({ mutation: "status", status: "touring" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "revision-required" });
  });

  it("returns 409 with current state for a stale revision", async () => {
    expect((await patch({ mutation: "status", status: "touring", revision: 1 })).status).toBe(200);

    const response = await patch({ mutation: "field", field: "title", value: "x", revision: 1 });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: "listing-revision-conflict",
      listing: { id: listing.id, revision: 2, reviewStatus: "touring" },
      snapshot: { listings: [{ id: listing.id, revision: 2 }] },
    });
  });

  it("returns 404 for a missing listing and never creates it", async () => {
    const response = await patch(
      { mutation: "status", status: "touring", revision: 1 },
      "missing-listing",
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: "listing-not-found" });
    expect(await readSavedListing(db, alice.groupId, "missing-listing")).toBeUndefined();
  });
});

describe("0005_listing_revisions migration", () => {
  it("adds revision 1 to listings saved before the migration", () => {
    const sqlite = new DatabaseSync(":memory:");
    applyMigrations(sqlite, { through: "0004_shared_app_state.sql" });
    sqlite.exec(`
      INSERT INTO app_saved_listings (id, group_id, url, duplicate_key, group_scoped_duplicate_key, listing_json, created_at, updated_at)
      VALUES ('legacy', '${defaultSearchGroup.id}', 'https://example.com/a', 'k', 'g:k', '{}', 'now', 'now');
    `);

    applyMigrations(sqlite);

    expect(
      sqlite.prepare("SELECT revision FROM app_saved_listings WHERE id = 'legacy'").get(),
    ).toEqual({
      revision: 1,
    });
    sqlite.close();
  });
});
