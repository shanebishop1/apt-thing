import { NextRequest, NextResponse } from "next/server";
import {
  GROUP_SESSION_MAX_AGE_SECONDS,
  authFailure,
  createGroupSession,
  groupSessionCookie,
  matchInviteCode,
  readGroupInviteCodes,
} from "@/lib/api-auth";
import { createGroupIdentity, findSearchGroup, parseInviteInput } from "@/lib/listings";

/** Exchanges a user-entered invite code and display name for an HTTP-only group session. */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const codes = await readGroupInviteCodes();
  if (codes.size === 0) return authFailure("group-auth-unconfigured").response;

  const { inviteCode } = parseInviteInput(
    typeof body.inviteCode === "string" ? body.inviteCode : "",
  );
  const groupId = inviteCode ? await matchInviteCode(codes, inviteCode) : undefined;
  if (!groupId) return authFailure("invalid-invite-code").response;

  const identity = createGroupIdentity(
    groupId,
    typeof body.displayName === "string" ? body.displayName : "",
  );
  if (!identity) {
    return NextResponse.json({ ok: false, error: "display-name-required" }, { status: 400 });
  }

  const response = NextResponse.json({
    ok: true,
    identity: {
      groupId: identity.groupId,
      groupName: findSearchGroup(identity.groupId)?.name ?? identity.groupId,
      displayName: identity.displayName,
      identityToken: identity.identityToken,
    },
  });
  response.cookies.set(
    groupSessionCookie(
      request,
      await createGroupSession(identity, codes.get(groupId)!),
      GROUP_SESSION_MAX_AGE_SECONDS,
    ),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(groupSessionCookie(request, "", 0));
  return response;
}

async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
