import { describe, expect, it } from "vitest";
import {
  appendGroupAction,
  clearSavedListings,
  createGroupActionsStorageKey,
  createListingGroupActions,
  createReviewDashboardModel,
  createSavedListing,
  createSavedListingsStorageKey,
  createSelectedListingStorageKey,
  createSeenRejectedMemoryStorageKey,
  getFixtureBatchRunSummary,
  readGroupActions,
  normalizeInviteIdentityInput,
  readStoredInviteIdentity,
  readSeenRejectedMemory,
  readSavedListings,
  sortSavedListingsForDashboard,
  updateSavedListingField,
  updateSavedListingStatus,
  upsertRejectedMemory,
  writeGroupActions,
  writeStoredInviteIdentity,
  writeSeenRejectedMemory,
  writeSavedListings,
  type StorageLike,
} from "./saved-list-storage";
import {
  INVITE_IDENTITY_STORAGE_KEY,
  REVIEW_STATUSES,
  createGroupIdentity,
  createListingFromUrl,
  defaultSearchGroup,
} from "./listings";
import { fixtureListings } from "./fixtures";

class MemoryStorage implements StorageLike {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const identity = createGroupIdentity(defaultSearchGroup.id, "Tester")!;

describe("saved-list local storage helpers", () => {
  it("hydrates group-scoped fixture listings when local storage is empty", () => {
    const storage = new MemoryStorage();
    const listings = readSavedListings(storage, defaultSearchGroup.id);

    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((listing) => listing.groupId === defaultSearchGroup.id)).toBe(true);
  });

  it("writes and reads a versioned group-scoped saved-list envelope", () => {
    const storage = new MemoryStorage();
    const listing = createListingFromUrl("https://streeteasy.com/building/example/1", identity, {
      title: "Example listing",
      rent: 12000,
      bedrooms: 5,
    });

    const envelope = writeSavedListings(storage, defaultSearchGroup.id, [
      listing,
      { ...listing, id: "other-group", groupId: "other-group" },
    ]);
    const stored = storage.getItem(createSavedListingsStorageKey(defaultSearchGroup.id));

    expect(envelope.groupId).toBe(defaultSearchGroup.id);
    expect(envelope.listings).toHaveLength(1);
    expect(stored).toContain(defaultSearchGroup.id);
    expect(readSavedListings(storage, defaultSearchGroup.id, [])).toEqual([listing]);
  });

  it("upgrades old persisted fixture photo URLs to loadable fixture images", () => {
    const storage = new MemoryStorage();
    const fixtureListing = fixtureListings.find((listing) => listing.photos.length > 0)!;
    const staleListing = {
      ...fixtureListing,
      photos: ["https://fixtures.test/streeteasy/batch/1.jpg"],
      imageEvidence: [
        {
          url: "https://fixtures.test/streeteasy/batch/1.jpg",
          role: "primary" as const,
          sentToAi: true,
        },
      ],
    };

    storage.setItem(
      createSavedListingsStorageKey(defaultSearchGroup.id),
      JSON.stringify({
        version: "v1",
        groupId: defaultSearchGroup.id,
        listings: [staleListing],
        updatedAt: "2026-06-07T00:00:00.000Z",
      }),
    );

    const hydratedListing = readSavedListings(storage, defaultSearchGroup.id, [])[0]!;

    expect(hydratedListing.photos).toEqual(fixtureListing.photos);
    expect(hydratedListing.photos.every((photoUrl) => photoUrl.startsWith("https://images."))).toBe(
      true,
    );
    expect(hydratedListing.imageEvidence).toEqual(fixtureListing.imageEvidence);
  });

  it("stores the user-entered invite and display name without validating the code locally", () => {
    const storage = new MemoryStorage();

    expect(normalizeInviteIdentityInput(" /invite/user-code ", " Grace ")).toEqual({
      kind: "complete",
      inviteCode: "user-code",
      displayName: "Grace",
    });
    expect(normalizeInviteIdentityInput("user-code", " ")).toMatchObject({ kind: "incomplete" });
    expect(normalizeInviteIdentityInput(" ", "Grace")).toMatchObject({ kind: "incomplete" });

    expect(readStoredInviteIdentity(storage)).toBeUndefined();
    writeStoredInviteIdentity(storage, {
      inviteCode: " user-code ",
      displayName: " Grace ",
      groupId: defaultSearchGroup.id,
    });
    expect(storage.getItem(INVITE_IDENTITY_STORAGE_KEY)).toContain('"displayName":"Grace"');
    expect(readStoredInviteIdentity(storage)).toMatchObject({
      inviteCode: "user-code",
      displayName: "Grace",
      groupId: defaultSearchGroup.id,
      persistedIn: "localStorage",
    });

    storage.setItem(INVITE_IDENTITY_STORAGE_KEY, "{not json");
    expect(readStoredInviteIdentity(storage)).toBeUndefined();
  });

  it("refuses local saved-list writes for identities outside a known group", () => {
    const rejected = createSavedListing([], "https://streeteasy.com/building/invalid-invite/1", {
      ...identity,
      groupId: "self-serve-group",
    });

    expect(rejected).toEqual({
      kind: "rejected",
      listings: [],
      feedback: "Enter a valid invite code before saving group records.",
    });
  });

  it("creates listings, detects duplicates, and keeps the existing record openable", () => {
    const first = createSavedListing(
      [],
      "https://www.zillow.com/homedetails/example/#photos",
      identity,
    );
    const second = createSavedListing(
      first.listings,
      "https://zillow.com/homedetails/example/",
      identity,
    );

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("duplicate");
    if (first.kind !== "created" || second.kind !== "duplicate") {
      throw new Error("Expected created then duplicate saved-list results");
    }
    expect(second.listing.id).toBe(first.listing.id);
    expect(second.listings).toHaveLength(1);
  });

  it("returns validation feedback when pasted intake rejects a URL", () => {
    const result = createSavedListing([], "javascript:alert(1)", identity);

    expect(result).toMatchObject({
      kind: "rejected",
      listings: [],
      feedback: "Only http:// and https:// apartment listing URLs can be saved.",
    });
  });

  it("updates status and editable fields with provenance for persisted records", () => {
    const storage = new MemoryStorage();
    const created = createSavedListing(
      [],
      "https://streeteasy.com/building/status-example/5",
      identity,
    );
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      throw new Error("Expected saved-list creation before updates.");
    }

    const statusUpdated = updateSavedListingStatus(
      created.listings,
      defaultSearchGroup.id,
      created.listing.id,
      "touring",
    );
    const edited = updateSavedListingField(
      statusUpdated,
      defaultSearchGroup.id,
      created.listing.id,
      "rent",
      14900,
      "Tester",
    );
    const listing = edited[0]!;

    expect(listing.reviewStatus).toBe("touring");
    expect(listing.display.reviewStatus).toBe("touring");
    expect(listing.rent).toBe(14900);
    expect(listing.display.rent).toBe(14900);
    expect(listing.fieldProvenance.at(-1)).toMatchObject({
      field: "rent",
      originalValue: "",
      editedValue: "14900",
      actorDisplayName: "Tester",
      actor: "Tester",
    });
    expect(Date.parse(listing.fieldProvenance.at(-1)?.updatedAt ?? "")).not.toBeNaN();

    writeSavedListings(storage, defaultSearchGroup.id, edited);
    expect(
      readSavedListings(storage, defaultSearchGroup.id, [])[0]?.fieldProvenance.at(-1),
    ).toEqual(listing.fieldProvenance.at(-1));
  });

  it("keeps status and field mutations scoped to the active group", () => {
    const listing = createListingFromUrl("https://streeteasy.com/building/shared/1", identity, {
      title: "Shared id",
      rent: 12000,
      bedrooms: 5,
    });
    const otherGroupListing = {
      ...listing,
      groupId: "other-group",
      reviewStatus: "new" as const,
      rent: 9000,
    };

    const statusUpdated = updateSavedListingStatus(
      [listing, otherGroupListing],
      defaultSearchGroup.id,
      listing.id,
      "rejected",
    );
    const fieldUpdated = updateSavedListingField(
      statusUpdated,
      defaultSearchGroup.id,
      listing.id,
      "rent",
      14999,
      "Tester",
    );

    expect(fieldUpdated[0]).toMatchObject({
      groupId: defaultSearchGroup.id,
      reviewStatus: "rejected",
      rent: 14999,
    });
    expect(fieldUpdated[1]).toMatchObject({
      groupId: "other-group",
      reviewStatus: "new",
      rent: 9000,
    });
  });

  it("persists comments, reactions, source opens, statuses, and feedback as group-scoped actions", () => {
    const storage = new MemoryStorage();
    const listing = createListingFromUrl(
      "https://streeteasy.com/building/group-action/1",
      identity,
      {
        title: "Action listing",
        rent: 12500,
        bedrooms: 5,
      },
    );
    const otherGroupListing = { ...listing, groupId: "other-group" };
    const actions = [
      { actionType: "comment" as const, commentBody: "Ask for the floorplan." },
      { actionType: "reaction" as const, reaction: "question" as const },
      { actionType: "status-change" as const, status: "touring" as const },
      { actionType: "source-link-open" as const, sourceUrl: listing.url },
      {
        actionType: "feedback" as const,
        feedback: {
          category: "evidence" as const,
          summary: "Bedroom evidence is thin.",
          disagreement: true,
          target: "source-evidence" as const,
          sourceEvidenceIds: listing.evidencePointers.map((pointer) => pointer.id),
          doesNotMutateRanking: true as const,
        },
      },
    ].reduce(
      (currentActions, action) => appendGroupAction(currentActions, identity, listing, action),
      appendGroupAction([], identity, otherGroupListing, {
        actionType: "comment",
        commentBody: "Should not cross groups.",
      }),
    );

    const envelope = writeGroupActions(storage, defaultSearchGroup.id, actions);
    const grouped = createListingGroupActions(
      readGroupActions(storage, defaultSearchGroup.id),
      defaultSearchGroup.id,
      listing.id,
    );

    expect(storage.getItem(createGroupActionsStorageKey(defaultSearchGroup.id))).toContain(
      "group-action-v1",
    );
    expect(envelope.actions).toHaveLength(5);
    expect(grouped.comments[0]).toMatchObject({
      groupId: defaultSearchGroup.id,
      listingId: listing.id,
      actorDisplayName: "Tester",
      actorIdentityToken: identity.identityToken,
      commentBody: "Ask for the floorplan.",
      sourceUrl: listing.url,
    });
    expect(grouped.reactions[0]?.reaction).toBe("question");
    expect(grouped.statusChanges[0]?.status).toBe("touring");
    expect(grouped.sourceLinkOpens[0]).toMatchObject({
      sourceUrl: listing.url,
      provenance: { source: "original-listing-source-link", visibleToGroup: true },
    });
    expect(grouped.feedback[0]).toMatchObject({
      feedback: {
        category: "evidence",
        disagreement: true,
        doesNotMutateRanking: true,
      },
      provenance: { source: "evidence-feedback", visibleToGroup: true },
    });
  });

  it("keeps only the current reaction per user and listing", () => {
    const listing = createListingFromUrl(
      "https://streeteasy.com/building/reaction-current/1",
      identity,
      {
        title: "Reaction current listing",
        rent: 12500,
        bedrooms: 5,
      },
    );
    const otherListing = createListingFromUrl(
      "https://streeteasy.com/building/reaction-current/2",
      identity,
      {
        title: "Other reaction listing",
        rent: 12500,
        bedrooms: 5,
      },
    );
    const otherIdentity = createGroupIdentity(defaultSearchGroup.id, "Other Tester")!;

    const actions = [
      { actionType: "reaction" as const, reaction: "thumbs-up" as const },
      { actionType: "reaction" as const, reaction: "thumbs-down" as const },
    ].reduce(
      (currentActions, action) => appendGroupAction(currentActions, identity, listing, action),
      appendGroupAction([], identity, otherListing, {
        actionType: "reaction",
        reaction: "thumbs-up",
      }),
    );
    const nextActions = appendGroupAction(actions, otherIdentity, listing, {
      actionType: "reaction",
      reaction: "thumbs-up",
    });
    const grouped = createListingGroupActions(nextActions, defaultSearchGroup.id, listing.id);
    const otherGrouped = createListingGroupActions(
      nextActions,
      defaultSearchGroup.id,
      otherListing.id,
    );

    expect(grouped.reactions).toHaveLength(2);
    expect(grouped.reactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorDisplayName: "Tester", reaction: "thumbs-down" }),
        expect.objectContaining({ actorDisplayName: "Other Tester", reaction: "thumbs-up" }),
      ]),
    );
    expect(otherGrouped.reactions).toHaveLength(1);
  });

  it("persists rejected status memory with group-scoped duplicate keys", () => {
    const storage = new MemoryStorage();
    const listing = updateSavedListingStatus(
      [
        createListingFromUrl("https://streeteasy.com/building/rejected-memory/1", identity, {
          title: "Rejected memory listing",
          rent: 13000,
          bedrooms: 5,
        }),
      ],
      defaultSearchGroup.id,
      createListingFromUrl("https://streeteasy.com/building/rejected-memory/1", identity).id,
      "rejected",
    )[0]!;
    const memory = upsertRejectedMemory([], listing, "Rejected by Tester");
    const envelope = writeSeenRejectedMemory(storage, defaultSearchGroup.id, memory);

    expect(storage.getItem(createSeenRejectedMemoryStorageKey(defaultSearchGroup.id))).toContain(
      "seen-rejected-memory-v1",
    );
    expect(envelope.memory).toHaveLength(1);
    expect(readSeenRejectedMemory(storage, defaultSearchGroup.id)[0]).toMatchObject({
      groupId: defaultSearchGroup.id,
      sourceUrl: listing.url,
      groupScopedDuplicateKey: listing.groupScopedDuplicateKey,
      memoryState: "rejected",
      reason: "Rejected by Tester",
    });
  });

  it("allows every G1 saved-list review status", () => {
    const listing = createListingFromUrl(
      "https://streeteasy.com/building/status-cycle/1",
      identity,
    );

    for (const status of REVIEW_STATUSES) {
      const [updated] = updateSavedListingStatus(
        [listing],
        defaultSearchGroup.id,
        listing.id,
        status,
      );

      expect(updated?.reviewStatus).toBe(status);
      expect(updated?.display.reviewStatus).toBe(status);
    }
  });

  it("sorts mobile dashboard records into current, review-needed batch, pasted, then history", () => {
    const current = createListingFromUrl("https://streeteasy.com/building/current/1", identity, {
      title: "Confirmed current fixture",
      rent: 12000,
      bedrooms: 5,
      bathrooms: 2,
      neighborhood: "Chelsea",
    });
    const currentMatch = { ...current, triageBucket: "confirmed-match" as const };
    const batchReviewNeeded = {
      ...createListingFromUrl("https://streeteasy.com/building/batch-review/2", identity, {
        title: "Batch review fixture",
        rent: 12000,
        bedrooms: 5,
        bathrooms: 2,
        neighborhood: "Williamsburg",
      }),
      id: "batch-review",
      userQualified: false,
      providerRoute: "streeteasy-realtyapi-batch-search" as const,
      triageBucket: "review-needed" as const,
    };
    const pastedRejected = updateSavedListingStatus(
      [
        {
          ...createListingFromUrl("https://zillow.com/homedetails/pasted", identity),
          id: "pasted",
        },
      ],
      defaultSearchGroup.id,
      "pasted",
      "rejected",
    )[0]!;
    const history = {
      ...createListingFromUrl("https://streeteasy.com/building/history/3", identity),
      id: "history",
      userQualified: false,
      providerRoute: "streeteasy-realtyapi-batch-search" as const,
      triageBucket: "rejected" as const,
    };

    expect(
      sortSavedListingsForDashboard([history, pastedRejected, batchReviewNeeded, currentMatch]).map(
        (item) => item.id,
      ),
    ).toEqual([currentMatch.id, "batch-review", "pasted", "history"]);
  });

  it("builds card-first review sections with skipped counts and pasted links always visible", () => {
    const batchRun = getFixtureBatchRunSummary();
    const listings = readSavedListings(new MemoryStorage(), defaultSearchGroup.id);
    const dashboard = createReviewDashboardModel(listings, batchRun);

    expect(dashboard.counts.skippedSeen).toBe(1);
    expect(dashboard.counts.skippedTriaged).toBe(1);
    expect(dashboard.currentMatches.length).toBeGreaterThan(0);
    expect(dashboard.reviewNeededBatch.every((listing) => !listing.userQualified)).toBe(true);
    expect(
      dashboard.reviewNeededBatch.every((listing) => listing.triageBucket === "review-needed"),
    ).toBe(true);
    expect(dashboard.userQualifiedPasted.length).toBeGreaterThan(0);
    expect(dashboard.userQualifiedPasted.every((listing) => listing.userQualified)).toBe(true);
  });

  it("clears saved-list and selected-record keys for local reset", () => {
    const storage = new MemoryStorage();
    const groupId = defaultSearchGroup.id;
    storage.setItem(createSavedListingsStorageKey(groupId), "[]");
    storage.setItem(createSelectedListingStorageKey(groupId), "listing-id");

    clearSavedListings(storage, groupId);

    expect(storage.getItem(createSavedListingsStorageKey(groupId))).toBeNull();
    expect(storage.getItem(createSelectedListingStorageKey(groupId))).toBeNull();
  });
});
