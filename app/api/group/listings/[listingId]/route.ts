import { NextRequest, NextResponse } from "next/server";
import { REVIEW_STATUSES, type FieldProvenance } from "@/lib/listings";
import {
  appendSharedAction,
  mutateSharedListingField,
  mutateSharedListingStatus,
  parseApiIdentity,
} from "@/lib/shared-listing-api";
import type { D1DatabaseLike } from "@/lib/shared-listing-store";

type AppRouteEnv = Partial<Record<"DB", unknown>>;
type RouteContext = { params: Promise<{ listingId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const env = await getAppRouteEnv();
  if (!isD1Database(env?.DB)) {
    return NextResponse.json({ ok: false, error: "d1-binding-missing" }, { status: 503 });
  }

  const body = await readJson(request);
  const identity = parseApiIdentity(body);
  if (!identity) {
    return NextResponse.json({ ok: false, error: "invalid-invite-code" }, { status: 403 });
  }

  const { listingId } = await context.params;

  try {
    if (body.mutation === "status" && REVIEW_STATUSES.includes(body.status as never)) {
      const snapshot = await mutateSharedListingStatus({
        db: env.DB,
        identity,
        listingId,
        status: body.status as never,
      });
      return NextResponse.json({ ok: true, snapshot });
    }

    if (body.mutation === "field" && isEditableField(body.field)) {
      const snapshot = await mutateSharedListingField({
        db: env.DB,
        identity,
        listingId,
        field: body.field,
        value: typeof body.value === "number" ? body.value : String(body.value ?? ""),
      });
      return NextResponse.json({ ok: true, snapshot });
    }

    return NextResponse.json({ ok: false, error: "unsupported-mutation" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "listing-mutation-failed" },
      { status: error instanceof Error && error.message === "listing-not-found" ? 404 : 400 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const env = await getAppRouteEnv();
  if (!isD1Database(env?.DB)) {
    return NextResponse.json({ ok: false, error: "d1-binding-missing" }, { status: 503 });
  }

  const body = await readJson(request);
  const identity = parseApiIdentity(body);
  if (!identity) {
    return NextResponse.json({ ok: false, error: "invalid-invite-code" }, { status: 403 });
  }

  const { listingId } = await context.params;
  try {
    const snapshot = await appendSharedAction({
      db: env.DB,
      identity,
      listingId,
      action: {
        actionType: normalizeActionType(body.actionType),
        commentBody: typeof body.commentBody === "string" ? body.commentBody : undefined,
        reaction: normalizeReaction(body.reaction),
        sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
      },
    });
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "listing-action-failed" },
      { status: error instanceof Error && error.message === "listing-not-found" ? 404 : 400 },
    );
  }
}

async function getAppRouteEnv(): Promise<AppRouteEnv | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return context?.env as AppRouteEnv | undefined;
  } catch {
    return undefined;
  }
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

function isD1Database(value: unknown): value is D1DatabaseLike {
  return Boolean(value && typeof value === "object" && "prepare" in value);
}

function isEditableField(value: unknown): value is FieldProvenance["field"] {
  return (
    value === "title" ||
    value === "address" ||
    value === "neighborhood" ||
    value === "rent" ||
    value === "bedrooms" ||
    value === "bathrooms" ||
    value === "availableAt"
  );
}

function normalizeActionType(value: unknown) {
  return value === "reaction" || value === "source-link-open" || value === "feedback"
    ? value
    : "comment";
}

function normalizeReaction(value: unknown) {
  return value === "thumbs-up" ||
    value === "thumbs-down" ||
    value === "tour" ||
    value === "question"
    ? value
    : undefined;
}
