import { describe, expect, it } from "vitest";
import {
  createSelectedListingStorageKey,
  normalizeInviteIdentityInput,
  readStoredInviteIdentity,
  writeStoredInviteIdentity,
  type StorageLike,
} from "./invite-identity-storage";
import { INVITE_IDENTITY_STORAGE_KEY, defaultSearchGroup } from "./listings";

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

describe("invite identity browser storage", () => {
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

  it("ignores stored identities that are missing the invite code or display name", () => {
    const storage = new MemoryStorage();
    storage.setItem(INVITE_IDENTITY_STORAGE_KEY, JSON.stringify({ inviteCode: "user-code" }));

    expect(readStoredInviteIdentity(storage)).toBeUndefined();
  });

  it("scopes the selected-listing key to the group", () => {
    expect(createSelectedListingStorageKey(defaultSearchGroup.id)).toBe(
      `apt-thing:v1:groups:${defaultSearchGroup.id}:selected-listing`,
    );
    expect(createSelectedListingStorageKey("other-group")).not.toBe(
      createSelectedListingStorageKey(defaultSearchGroup.id),
    );
  });
});
