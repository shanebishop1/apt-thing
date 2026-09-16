import { NextRequest, NextResponse } from "next/server";
import { authorizeGroupRequest } from "@/lib/api-auth";
import { REVIEW_STATUSES, type FieldProvenance } from "@/lib/listings";
import {
  d1BindingMissingResponse,
  isD1Database,
  jsonError,
  readCloudflareEnv,
  readJsonObject,
} from "@/lib/route-support";
import {
  ListingMutationError,
  appendSharedAction,
  mutateSharedListingReviewDecision,
  mutateSharedListingField,
  mutateSharedListingStatus,
  parseExpectedRevision,
} from "@/lib/shared-listing-api";
import { readSharedListingSnapshot, type D1DatabaseLike } from "@/lib/shared-listing-store";

type AppRouteEnv = Partial<Record<"DB", unknown>>;
type RouteContext = { params: Promise<{ listingId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const body = await readJsonObject(request);
  const auth = await authorizeGroupRequest(request, { body, displayName: "Group Listing API" });
  if (!auth.ok) return auth.response;

  const env = await readCloudflareEnv<AppRouteEnv>();
  if (!isD1Database(env?.DB)) return d1BindingMissingResponse();
  const identity = auth.identity;

  const { listingId } = await context.params;
  const expectedRevision = parseExpectedRevision(body.revision);
  if (expectedRevision === undefined) {
    return jsonError(400, "revision-required");
  }

  try {
    if (body.mutation === "status" && REVIEW_STATUSES.includes(body.status as never)) {
      const snapshot = await mutateSharedListingStatus({
        db: env.DB,
        identity,
        listingId,
        status: body.status as never,
        expectedRevision,
      });
      return NextResponse.json({ ok: true, snapshot });
    }

    if (
      body.mutation === "review-decision" &&
      (body.decision === "approve" || body.decision === "reject")
    ) {
      const snapshot = await mutateSharedListingReviewDecision({
        db: env.DB,
        identity,
        listingId,
        decision: body.decision,
        expectedRevision,
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
        expectedRevision,
      });
      return NextResponse.json({ ok: true, snapshot });
    }

    return jsonError(400, "unsupported-mutation");
  } catch (error) {
    return mutationErrorResponse(env.DB, identity.groupId, error, "listing-mutation-failed");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const body = await readJsonObject(request);
  const auth = await authorizeGroupRequest(request, { body, displayName: "Group Listing API" });
  if (!auth.ok) return auth.response;

  const env = await readCloudflareEnv<AppRouteEnv>();
  if (!isD1Database(env?.DB)) return d1BindingMissingResponse();
  const identity = auth.identity;

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
    return mutationErrorResponse(env.DB, identity.groupId, error, "listing-action-failed");
  }
}

async function mutationErrorResponse(
  db: D1DatabaseLike,
  groupId: string,
  error: unknown,
  fallback: string,
) {
  if (error instanceof ListingMutationError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        ...(error.current ? { listing: error.current } : {}),
        snapshot: await readSharedListingSnapshot(db, groupId),
      },
      { status: error.status },
    );
  }

  return jsonError(400, error instanceof Error ? error.message : fallback);
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
