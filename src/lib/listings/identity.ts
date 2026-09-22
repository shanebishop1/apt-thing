import { stableHash } from "../utils/ids";
import { SEARCH_CONFIG } from "../search-config";
import type { InviteIdentity, ParsedInviteInput, SearchGroup } from "./domain";
import { INVITE_IDENTITY_STORAGE_KEY, INVITE_LINK_BASE_PATH } from "./config";

const searchGroups: SearchGroup[] = [
  {
    id: "nyc-5br-2026",
    name: `NYC ${SEARCH_CONFIG.minBedrooms}BR search`,
    createdAt: "2026-06-04T00:00:00.000Z",
  },
];

export const defaultSearchGroup = searchGroups[0]!;

export function createInviteLinkPath(inviteCode: string): string {
  return `${INVITE_LINK_BASE_PATH}/${encodeURIComponent(inviteCode.trim())}`;
}

export function findSearchGroup(groupId: string): SearchGroup | undefined {
  return searchGroups.find((group) => group.id === groupId.trim());
}

export function createGroupIdentity(
  groupId: string,
  displayName: string,
): InviteIdentity | undefined {
  const group = findSearchGroup(groupId);
  const normalizedDisplayName = displayName.trim();

  if (!group || !normalizedDisplayName) {
    return undefined;
  }

  return {
    groupId: group.id,
    displayName: normalizedDisplayName,
    identityToken: createActorIdentityToken(group.id, normalizedDisplayName),
    persistedIn: "localStorage",
    storageKey: INVITE_IDENTITY_STORAGE_KEY,
  };
}

export function parseInviteInput(inviteInput: string): ParsedInviteInput {
  const trimmedInput = inviteInput.trim();

  try {
    const url = new URL(trimmedInput);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const inviteIndex = pathParts.indexOf(INVITE_LINK_BASE_PATH.slice(1));

    if (inviteIndex >= 0 && pathParts[inviteIndex + 1]) {
      return {
        resolvedFrom: "invite-link",
        inviteCode: decodeURIComponent(pathParts[inviteIndex + 1]!),
      };
    }
  } catch {
    // Plain invite codes and relative invite paths continue below.
  }

  if (trimmedInput.startsWith(`${INVITE_LINK_BASE_PATH}/`)) {
    return {
      resolvedFrom: "invite-link",
      inviteCode: decodeURIComponent(trimmedInput.slice(INVITE_LINK_BASE_PATH.length + 1)),
    };
  }

  return { resolvedFrom: "invite-code", inviteCode: trimmedInput };
}

export function createId(value: string): string {
  return `listing-${stableHash(value)}`;
}

function createActorIdentityToken(groupId: string, displayName: string): string {
  const normalizedDisplayName = displayName.trim().toLowerCase();
  const bytes = new TextEncoder().encode(`${groupId}:${normalizedDisplayName}`);
  let hash = 0;

  for (const byte of bytes) {
    hash = (hash * 31 + byte) >>> 0;
  }

  return `actor_${groupId}_${hash.toString(36)}`;
}
