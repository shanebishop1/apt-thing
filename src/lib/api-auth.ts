import { NextRequest, NextResponse } from "next/server";
import { createInviteIdentity, defaultSearchGroup, type InviteIdentity } from "./listings";

export const INVITE_CODE_HEADER = "X-Invite-Code" as const;

export type ApiAuthResult =
  | { ok: true; identity: InviteIdentity; inviteCode: string }
  | { ok: false; response: NextResponse<{ ok: false; error: "invalid-invite-code" }> };

export function requireGroupCode(
  request: NextRequest,
  body?: Record<string, unknown>,
  displayName = "Apartment Search",
): ApiAuthResult {
  const inviteCode = readInviteCode(request, body);
  if (inviteCode !== defaultSearchGroup.inviteCode) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "invalid-invite-code" }, { status: 403 }),
    };
  }

  const identity = createInviteIdentity(inviteCode, readDisplayName(request, body) ?? displayName);
  if (!identity) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "invalid-invite-code" }, { status: 403 }),
    };
  }

  return { ok: true, identity, inviteCode };
}

export function isAllowedInviteCode(value: unknown): boolean {
  return typeof value === "string" && value.trim() === defaultSearchGroup.inviteCode;
}

function readInviteCode(request: NextRequest, body?: Record<string, unknown>) {
  const headerValue = request.headers.get(INVITE_CODE_HEADER);
  if (headerValue) return headerValue.trim();

  const bodyValue = body?.inviteCode;
  if (typeof bodyValue === "string") return bodyValue.trim();

  const queryValue = request.nextUrl.searchParams.get("inviteCode");
  return queryValue?.trim();
}

function readDisplayName(request: NextRequest, body?: Record<string, unknown>) {
  const bodyValue = body?.displayName;
  if (typeof bodyValue === "string" && bodyValue.trim()) return bodyValue;

  const queryValue = request.nextUrl.searchParams.get("displayName");
  return queryValue && queryValue.trim() ? queryValue : undefined;
}
