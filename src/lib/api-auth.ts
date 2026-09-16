import { NextRequest, NextResponse } from "next/server";
import { createGroupIdentity, findSearchGroup, type InviteIdentity } from "./listings";

export const INVITE_CODE_HEADER = "X-Invite-Code" as const;
export const DISPLAY_NAME_HEADER = "X-Display-Name" as const;
export const GROUP_INVITE_CODES_ENV = "GROUP_INVITE_CODES" as const;
export const GROUP_SESSION_COOKIE = "apt_group_session" as const;
export const GROUP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const MIN_INVITE_CODE_LENGTH = 16;

const SESSION_VERSION = "v1";
const encoder = new TextEncoder();

export type GroupAuthErrorCode =
  | "authentication-required"
  | "session-invalid"
  | "invalid-invite-code"
  | "group-auth-unconfigured";

export type ApiAuthResult =
  | { ok: true; identity: InviteIdentity; via: "session" | "invite-header" }
  | { ok: false; response: NextResponse<{ ok: false; error: GroupAuthErrorCode }> };

export type GroupInviteCodes = ReadonlyMap<string, string>;

/**
 * Parses the server-only `GROUP_INVITE_CODES` value (`groupId=code,groupId=code`). Entries for
 * unknown groups, blank codes, or codes shorter than MIN_INVITE_CODE_LENGTH are ignored.
 */
export function parseGroupInviteCodes(value: string | undefined): GroupInviteCodes {
  const codes = new Map<string, string>();

  for (const entry of (value ?? "").split(",")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const groupId = entry.slice(0, separator).trim();
    const code = entry.slice(separator + 1).trim();
    if (!findSearchGroup(groupId) || code.length < MIN_INVITE_CODE_LENGTH) continue;
    codes.set(groupId, code);
  }

  return codes;
}

export async function readGroupInviteCodes(): Promise<GroupInviteCodes> {
  return parseGroupInviteCodes(await readServerEnvString(GROUP_INVITE_CODES_ENV));
}

/** Authorizes a protected route by session cookie, or by the operator `X-Invite-Code` header. */
export async function authorizeGroupRequest(
  request: NextRequest,
  {
    body,
    displayName = "Apartment Search",
  }: { body?: Record<string, unknown>; displayName?: string } = {},
): Promise<ApiAuthResult> {
  const codes = await readGroupInviteCodes();
  if (codes.size === 0) return authFailure("group-auth-unconfigured");

  const headerCode = request.headers.get(INVITE_CODE_HEADER)?.trim();
  if (headerCode) {
    const groupId = await matchInviteCode(codes, headerCode);
    const identity = groupId
      ? createGroupIdentity(groupId, readDisplayName(request, body) ?? displayName)
      : undefined;
    return identity
      ? { ok: true, identity, via: "invite-header" }
      : authFailure("invalid-invite-code");
  }

  const sessionValue = request.cookies.get(GROUP_SESSION_COOKIE)?.value;
  if (!sessionValue) return authFailure("authentication-required");

  const identity = await verifyGroupSession(sessionValue, codes);
  return identity ? { ok: true, identity, via: "session" } : authFailure("session-invalid");
}

export async function matchInviteCode(
  codes: GroupInviteCodes,
  candidate: string,
): Promise<string | undefined> {
  const normalized = candidate.trim();
  let matchedGroupId: string | undefined;

  // Compare every configured code so timing does not reveal which group (if any) matched.
  for (const [groupId, code] of codes) {
    if ((await constantTimeEqual(normalized, code)) && !matchedGroupId) matchedGroupId = groupId;
  }

  return matchedGroupId;
}

export async function createGroupSession(
  identity: Pick<InviteIdentity, "groupId" | "displayName">,
  inviteCode: string,
  issuedAtSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload = [
    SESSION_VERSION,
    base64UrlEncode(encoder.encode(identity.groupId)),
    base64UrlEncode(encoder.encode(identity.displayName)),
    String(issuedAtSeconds),
  ].join(".");
  const key = await importSessionKey(inviteCode, "sign");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyGroupSession(
  value: string,
  codes: GroupInviteCodes,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<InviteIdentity | undefined> {
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== SESSION_VERSION) return undefined;
  const [, encodedGroupId, encodedDisplayName, issuedAtText, encodedSignature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const groupId = decodeText(encodedGroupId);
  const displayName = decodeText(encodedDisplayName);
  const issuedAt = Number(issuedAtText);
  const signature = base64UrlDecode(encodedSignature);
  const inviteCode = groupId ? codes.get(groupId) : undefined;
  if (!inviteCode || !displayName || !signature || !/^\d+$/.test(issuedAtText)) return undefined;
  if (issuedAt > nowSeconds + 60 || nowSeconds - issuedAt > GROUP_SESSION_MAX_AGE_SECONDS) {
    return undefined;
  }

  const key = await importSessionKey(inviteCode, "verify");
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(parts.slice(0, 4).join(".")),
  );

  return valid ? createGroupIdentity(groupId!, displayName) : undefined;
}

export function groupSessionCookie(request: NextRequest, value: string, maxAge: number) {
  return {
    name: GROUP_SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "strict" as const,
    secure: request.nextUrl.protocol === "https:",
    path: "/api",
    maxAge,
  };
}

export function authFailure(error: GroupAuthErrorCode): Extract<ApiAuthResult, { ok: false }> {
  const status =
    error === "group-auth-unconfigured" ? 503 : error === "invalid-invite-code" ? 403 : 401;
  return { ok: false, response: NextResponse.json({ ok: false, error }, { status }) };
}

async function readServerEnvString(name: string): Promise<string | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    const value = (context?.env as Record<string, unknown> | undefined)?.[name];
    if (typeof value === "string" && value.trim()) return value;
  } catch {
    // Outside the Workers runtime (next dev, tests) fall back to process.env.
  }

  return process.env[name];
}

function readDisplayName(request: NextRequest, body?: Record<string, unknown>) {
  const headerValue = request.headers.get(DISPLAY_NAME_HEADER);
  if (headerValue?.trim()) return headerValue;

  const bodyValue = body?.displayName;
  return typeof bodyValue === "string" && bodyValue.trim() ? bodyValue : undefined;
}

let comparisonKey: Promise<CryptoKey> | undefined;

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  comparisonKey ??= crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const key = await comparisonKey;
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(left)),
    crypto.subtle.sign("HMAC", key, encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftDigest);
  const b = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

function importSessionKey(inviteCode: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`apt-thing-group-session:${inviteCode}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return undefined;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function decodeText(value: string): string | undefined {
  const bytes = base64UrlDecode(value);
  if (!bytes) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
