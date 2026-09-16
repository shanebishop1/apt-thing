import { describe, expect, it } from "vitest";
import {
  appendGroupAction,
  createListingGroupActions,
  upsertRejectedMemory,
} from "./group-actions";
import {
  createGroupIdentity,
  createListingFromUrl,
  defaultSearchGroup,
  updateReviewStatus,
} from "./listings";

const identity = createGroupIdentity(defaultSearchGroup.id, "Tester")!;

describe("group action records", () => {
  it("records comments, reactions, source opens, statuses, and feedback as group-scoped actions", () => {
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

    const grouped = createListingGroupActions(actions, defaultSearchGroup.id, listing.id);

    expect(actions).toHaveLength(5);
    expect(actions.every((action) => action.groupId === defaultSearchGroup.id)).toBe(true);
    expect(grouped.comments[0]).toMatchObject({
      contract: "group-action-v1",
      groupId: defaultSearchGroup.id,
      listingId: listing.id,
      actorDisplayName: "Tester",
      actorIdentityToken: identity.identityToken,
      commentBody: "Ask for the floorplan.",
      sourceUrl: listing.url,
    });
    expect(grouped.reactions[0]?.reaction).toBe("question");
    expect(grouped.statusChanges[0]).toMatchObject({
      status: "touring",
      provenance: { source: "shared-status-control", visibleToGroup: true },
    });
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

  it("ignores actions whose identity belongs to another group", () => {
    const listing = createListingFromUrl("https://streeteasy.com/building/cross-group/1", identity);

    expect(
      appendGroupAction([], { ...identity, groupId: "other-group" }, listing, {
        actionType: "comment",
        commentBody: "Should not cross groups.",
      }),
    ).toEqual([]);
  });

  it("upserts rejected status memory with group-scoped duplicate keys", () => {
    const listing = updateReviewStatus(
      createListingFromUrl("https://streeteasy.com/building/rejected-memory/1", identity, {
        title: "Rejected memory listing",
        rent: 13000,
        bedrooms: 5,
      }),
      "rejected",
    );
    const memory = upsertRejectedMemory([], listing, "Rejected by Tester");
    const reUpserted = upsertRejectedMemory(memory, listing, "Rejected again");

    expect(memory).toHaveLength(1);
    expect(memory[0]).toMatchObject({
      contract: "seen-rejected-memory-v1",
      groupId: defaultSearchGroup.id,
      sourceUrl: listing.url,
      groupScopedDuplicateKey: listing.groupScopedDuplicateKey,
      memoryState: "rejected",
      reason: "Rejected by Tester",
    });
    expect(reUpserted).toHaveLength(1);
    expect(reUpserted[0]?.reason).toBe("Rejected again");
  });

  it("leaves memory untouched for listings that are not rejected", () => {
    const listing = createListingFromUrl(
      "https://streeteasy.com/building/not-rejected/1",
      identity,
    );

    expect(upsertRejectedMemory([], listing, "Not rejected")).toEqual([]);
  });
});
