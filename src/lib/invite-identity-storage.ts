import { INVITE_IDENTITY_STORAGE_KEY, parseInviteInput } from "./listings";

/** Version prefix for the browser-local keys this module owns. */
const inviteIdentityStorageVersion = "v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoredInviteIdentity = {
  version: typeof inviteIdentityStorageVersion;
  inviteCode: string;
  displayName: string;
  groupId?: string;
  persistedIn: "localStorage";
  storageKey: typeof INVITE_IDENTITY_STORAGE_KEY;
  updatedAt: string;
};

export type InviteIdentityInput =
  | { kind: "complete"; inviteCode: string; displayName: string }
  | { kind: "incomplete"; feedback: string };

export function createSelectedListingStorageKey(groupId: string): string {
  return `apt-thing:${inviteIdentityStorageVersion}:groups:${groupId}:selected-listing`;
}

/**
 * Normalizes user-entered invite input (a code or an invite link) and display name. Whether the
 * code is accepted is decided only by the server; see POST /api/group/session.
 */
export function normalizeInviteIdentityInput(
  inviteInput: string,
  displayName: string,
): InviteIdentityInput {
  const { inviteCode } = parseInviteInput(inviteInput);
  const normalizedDisplayName = displayName.trim();

  if (!inviteCode) {
    return { kind: "incomplete", feedback: "Enter an invite code before saving group records." };
  }
  if (!normalizedDisplayName) {
    return { kind: "incomplete", feedback: "Enter a display name before saving group records." };
  }

  return { kind: "complete", inviteCode, displayName: normalizedDisplayName };
}

export function readStoredInviteIdentity(storage: StorageLike): StoredInviteIdentity | undefined {
  try {
    const storedIdentity = storage.getItem(INVITE_IDENTITY_STORAGE_KEY);
    if (!storedIdentity) return undefined;

    const parsedIdentity = JSON.parse(storedIdentity) as Partial<StoredInviteIdentity>;
    if (
      typeof parsedIdentity.inviteCode !== "string" ||
      typeof parsedIdentity.displayName !== "string"
    ) {
      return undefined;
    }

    return {
      version: inviteIdentityStorageVersion,
      inviteCode: parsedIdentity.inviteCode,
      displayName: parsedIdentity.displayName,
      groupId: typeof parsedIdentity.groupId === "string" ? parsedIdentity.groupId : undefined,
      persistedIn: "localStorage",
      storageKey: INVITE_IDENTITY_STORAGE_KEY,
      updatedAt:
        typeof parsedIdentity.updatedAt === "string"
          ? parsedIdentity.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return undefined;
  }
}

export function writeStoredInviteIdentity(
  storage: StorageLike,
  input: { inviteCode: string; displayName: string; groupId?: string },
): StoredInviteIdentity {
  const storedIdentity: StoredInviteIdentity = {
    version: inviteIdentityStorageVersion,
    inviteCode: input.inviteCode.trim(),
    displayName: input.displayName.trim(),
    groupId: input.groupId,
    persistedIn: "localStorage",
    storageKey: INVITE_IDENTITY_STORAGE_KEY,
    updatedAt: new Date().toISOString(),
  };

  storage.setItem(INVITE_IDENTITY_STORAGE_KEY, JSON.stringify(storedIdentity));
  return storedIdentity;
}
