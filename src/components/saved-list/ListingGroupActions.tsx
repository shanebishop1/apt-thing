"use client";

import { useRef, type FormEvent, type ToggleEvent } from "react";
import type { GroupActionRecord } from "@/lib/agent-contracts";
import type { InviteIdentity, ListingCandidate } from "@/lib/listings";
import type { ListingGroupActions as ListingGroupActionsState } from "@/lib/group-actions";
import { formatLabel } from "./listing-presentation";

export type ListingGroupActionsProps = {
  identity?: InviteIdentity | undefined;
  listing: ListingCandidate;
  actions?: ListingGroupActionsState | undefined;
  commentText: string;
  onCommentTextChange: (value: string) => void;
  onReaction: (listing: ListingCandidate, reaction: GroupActionRecord["reaction"]) => void;
  onComment: (event: FormEvent<HTMLFormElement>) => void;
};

export function ListingGroupActions({
  identity,
  listing,
  actions,
  commentText,
  onCommentTextChange,
  onReaction,
  onComment,
}: ListingGroupActionsProps) {
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  const handleCommentToggle = (event: ToggleEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open) {
      commentInputRef.current?.focus();
    }
  };

  return (
    <section className="group-actions-panel" aria-label="Group comments and reactions">
      <div className="group-actions-header">
        <h3>Group</h3>
      </div>
      <div className="group-control-row">
        <div className="reaction-row" aria-label="Roommate reactions">
          {(["thumbs-up", "thumbs-down"] as const).map((reaction) => (
            <button
              type="button"
              key={reaction}
              aria-label={`React ${formatLabel(reaction)} to ${listing.title}`}
              title={formatLabel(reaction)}
              onClick={() => onReaction(listing, reaction)}
            >
              <span aria-hidden="true">{reactionGlyph(reaction)}</span>
              <small>{reactionShortLabel(reaction)}</small>
            </button>
          ))}
        </div>
      </div>
      <details className="detail-disclosure" onToggle={handleCommentToggle}>
        <summary>
          <CommentIcon />
          <span>Add comment</span>
        </summary>
        <form className="group-action-form" onSubmit={onComment}>
          <label>
            Comment
            <textarea
              ref={commentInputRef}
              enterKeyHint="done"
              aria-label={`Comment on ${listing.title}`}
              value={commentText}
              onChange={(event) => onCommentTextChange(event.target.value)}
              placeholder="Note"
            />
          </label>
          <button type="submit" disabled={!identity}>
            Save
          </button>
        </form>
      </details>
      <GroupActionSummary actions={actions} />
    </section>
  );
}

export type GroupActionSummaryProps = {
  actions?: ListingGroupActionsState | undefined;
};

export function GroupActionSummary({ actions }: GroupActionSummaryProps) {
  if (!actions) {
    return (
      <p className="empty-state">Open this listing with a valid invite to see group activity.</p>
    );
  }

  const hasDigestItems = actions.comments.length > 0;

  if (!hasDigestItems) {
    return null;
  }

  return (
    <div className="group-action-summary" aria-label="Saved group action summary">
      <section className="group-action-digest-section" aria-label="Comments">
        <h4>Comments</h4>
        <ul>
          {actions.comments.map((action) => (
            <li key={action.id}>
              <strong>{action.actorDisplayName}</strong> · {action.commentBody}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export type ReactionScoreBadgeProps = {
  reactions: GroupActionRecord[];
};

export function ReactionScoreBadge({ reactions }: ReactionScoreBadgeProps) {
  const reactionDigest = createReactionScoreDigest(reactions);

  if (reactionDigest.score === 0) {
    return null;
  }

  return (
    <div
      className={`reaction-score-badge ${reactionDigest.tone}`}
      tabIndex={0}
      aria-label={`Reaction score: ${reactionDigest.accessibleScore}. Hover or focus to see who liked or passed.`}
    >
      <strong>{reactionDigest.displayScore}</strong>
      <div className="reaction-score-popover" role="tooltip">
        <ReactionNameGroup label="Liked" names={reactionDigest.likedNames} />
        <ReactionNameGroup label="Passed" names={reactionDigest.passedNames} />
      </div>
    </div>
  );
}

function createReactionScoreDigest(reactions: GroupActionRecord[]) {
  const likedNames = reactions
    .filter((action) => action.reaction === "thumbs-up")
    .map((action) => action.actorDisplayName);
  const passedNames = reactions
    .filter((action) => action.reaction === "thumbs-down")
    .map((action) => action.actorDisplayName);
  const score = likedNames.length;
  const displayScore = `+${score}`;

  return {
    score,
    displayScore,
    accessibleScore: `plus ${score}`,
    tone: "positive",
    likedNames,
    passedNames,
  };
}

function ReactionNameGroup({ label, names }: { label: string; names: string[] }) {
  return (
    <section className="reaction-name-group" aria-label={label}>
      <h4>{label}</h4>
      {names.length === 0 ? (
        <p>No one yet.</p>
      ) : (
        <ul>
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function reactionGlyph(reaction: NonNullable<GroupActionRecord["reaction"]>) {
  switch (reaction) {
    case "thumbs-up":
      return <ThumbIcon direction="up" />;
    case "thumbs-down":
      return <ThumbIcon direction="down" />;
    default:
      return null;
  }
}

function reactionShortLabel(reaction: NonNullable<GroupActionRecord["reaction"]>) {
  switch (reaction) {
    case "thumbs-up":
      return "Like";
    case "thumbs-down":
      return "Pass";
    default:
      return "React";
  }
}

function ThumbIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={direction === "down" ? "reaction-icon down" : "reaction-icon"}
    >
      <path
        d="M7 10v10M7 10H4.8c-.7 0-1.3.6-1.3 1.3v7.4c0 .7.6 1.3 1.3 1.3H7m0-10 4.2-6.3c.4-.6 1.1-.9 1.8-.7.9.2 1.5 1 1.3 1.9l-.7 3.1h4.3c1.4 0 2.4 1.3 2.1 2.6l-1.3 5.8c-.3 1.2-1.2 2-2.5 2H7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="summary-icon">
      <path
        d="M5 5.5h14v10H9l-4 3.5V5.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
