# Readiness Hardening Plan

Status: In progress — contracts fixed (see Contract Decisions)
Last updated: 2026-09-16

## Goal

Close the remaining MVP readiness gaps without activating paid or remote infrastructure:

- keep invite credentials out of public source and client bundles;
- prevent stale clients from silently overwriting or recreating listings;
- render Runs from persisted operational history instead of fixtures;
- verify protected routes and two-client behavior against SQLite/D1 semantics;
- leave reproducible operator documentation and explicit deployment blockers.

## Constraints

- Keep Cloudflare hibernated: `workers_dev: false`, `preview_urls: false`, no cron triggers, and no committed production bindings.
- Do not deploy, mutate remote D1, or call paid providers without explicit credentials and approval.
- Preserve the invite-link MVP model; do not introduce accounts, public signup, or self-serve group creation.
- Treat D1 as authoritative for listings, actions, and run history.
- Production Runs history must represent actual persisted manual or scheduled operations. Do not label fixture history as operational data.
- Add focused behavioral and database tests rather than broad low-value test matrices.
- The primary agent owns planning, integration review, commits, pushes, and final reporting. Scoped implementation should be delegated to engineer subagents with non-overlapping file ownership.

## Acceptance Criteria

### Authorization

- No accepted invite credential is embedded in repository source, generated client JavaScript, or public page data.
- Operator-created group credentials are supplied through server-only configuration.
- Invalid or missing credentials receive `401` or `403` from every protected group, platform, daily-loop, extraction, and map route.
- The browser can retain the user-entered invite identity locally, but public code cannot reveal a credential that independently authorizes an API request.
- Secret comparison avoids obvious timing-sensitive string comparison where practical.

### Listing Concurrency

- Every persisted listing has a monotonically increasing revision.
- Existing-record mutations submit the revision last observed by the client.
- D1 updates use `WHERE id = ? AND group_id = ? AND revision = ?`; a successful update increments the revision atomically.
- A stale revision returns `409 conflict` with enough current state for the client to refresh.
- A missing or rejected/deleted listing returns `404` and is never recreated by an update path.
- Listing creation remains a distinct insert path; existing-record mutations do not use an upsert.
- The UI reports a conflict or removal, refreshes current state, and never claims a stale mutation succeeded.

### Operational Run History

- The Runs panel fetches group-scoped history from D1 through an authenticated API path.
- History is assembled from persisted `daily_loop_runs`, `daily_loop_sources`, `daily_loop_candidates`, `daily_loop_candidate_status`, `daily_loop_seen_memory`, and `daily_loop_briefings` records as applicable.
- Empty history renders an honest empty state.
- Persisted manual and scheduled runs display their real status, timestamps, source coverage/failures, candidate counts, skipped/seen details, provider metadata, and briefing data.
- `g3cBriefingRunHistoryFixture` is not wired into the production workspace.

### Verification And Documentation

- Real SQLite-backed tests exercise edit/edit and edit/reject races through the D1 store contract.
- A two-client integration or browser flow proves that one client observes the other and that stale writes are rejected.
- Existing unauthorized-route coverage remains passing and is extended for new history/auth paths.
- `README.md` and `SETUP.md` describe server secret setup, local migrations, real Runs behavior, conflict handling, and hibernated deployment constraints.
- Final validation includes formatting, lint, typecheck, unit/integration tests, production build, clean-clone frozen install, and desktop/mobile browser smoke checks.

## Contract Decisions

Recorded before implementation (step 1 exit gate). Single-agent execution: the primary agent owns every lane sequentially, so lane file ownership collapses to commit ordering.

### Server-only group credentials

- Public source keeps only group metadata (`id`, `name`, `createdAt`) in `searchGroups`. No invite code or invite path is committed.
- Accepted invite codes come from one server-only variable, `GROUP_INVITE_CODES`, formatted as comma-separated `groupId=inviteCode` pairs (for example `nyc-5br-2026=<random>`).
  - Cloudflare: `wrangler secret put GROUP_INVITE_CODES` (not committed to `wrangler.jsonc`).
  - `wrangler dev`: `.dev.vars`. `next dev` / tests: `.env.local` or `process.env`.
  - Lookup order: `getCloudflareContext().env.GROUP_INVITE_CODES`, then `process.env.GROUP_INVITE_CODES`.
  - Entries for unknown group ids, empty codes, or codes shorter than 16 characters are ignored. If no valid entry remains, protected routes fail closed with `503 {"ok":false,"error":"group-auth-unconfigured"}`.
- The historical `apt-g1` code is public in git history and must never be configured.

### Request flow

- Browser: `POST /api/group/session` with `{ inviteCode, displayName }`.
  - Success `200 { ok: true, identity: { groupId, groupName, displayName, identityToken } }` and `Set-Cookie: apt_group_session=…; HttpOnly; SameSite=Strict; Path=/api; Max-Age=2592000` (+ `Secure` on https).
  - Wrong code `403 invalid-invite-code`; blank display name `400 display-name-required`; unconfigured `503 group-auth-unconfigured`.
  - `DELETE /api/group/session` clears the cookie.
- Session cookie value: `v1.<b64url groupId>.<b64url displayName>.<issuedAtSeconds>.<b64url HMAC-SHA256>`; the HMAC key is the group's configured invite code, so rotating the code invalidates every session. Sessions expire after 30 days. Verification uses `crypto.subtle.verify`.
- Operators/CLI: `X-Invite-Code` header (optional `X-Display-Name`). Invite codes are no longer accepted from query strings or JSON bodies.
- Protected routes (`/api/group/**`, `/api/platform/{smoke,proof,daily-loop}`, `/api/map/tiles/**`) call `authorizeGroupRequest(request)`:
  - no credential → `401 authentication-required`;
  - invalid, expired, or tampered session cookie → `401 session-invalid`;
  - wrong `X-Invite-Code` → `403 invalid-invite-code`;
  - unconfigured → `503 group-auth-unconfigured`.
- Header codes are compared by HMAC-digesting both values under a per-process random key and comparing digests in constant time.
- Group scope always comes from the authenticated identity; a `groupId` query parameter is ignored.
- Map tiles authenticate via the cookie (sent automatically on same-origin `<img>` requests), so tile URLs carry no credential.
- Browser `localStorage` keeps the user-entered invite code and display name so a reload or `401 session-invalid` can silently re-establish the session once.

### Listing revisions

- Migration `0005_listing_revisions.sql`: `ALTER TABLE app_saved_listings ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`. Existing rows start at revision 1; empty databases get the column through the same migration.
- Reads expose the column as `ListingCandidate.revision` (the column overrides any value in `listing_json`).
- Creation (`POST /api/group/listings`) is a plain `INSERT`; a unique-index race resolves to the existing duplicate.
- Existing-record mutations (`PATCH /api/group/listings/:id` for `field`, `status`, `review-decision`) require an integer `revision` in the body (`400 revision-required` otherwise) and run `UPDATE … SET …, revision = revision + 1 WHERE id = ? AND group_id = ? AND revision = ?` (or the equivalent conditional `DELETE` for review rejection).
- When zero rows change, the listing is re-read:
  - missing → `404 { ok:false, error:"listing-not-found", snapshot }`;
  - present → `409 { ok:false, error:"listing-revision-conflict", listing, snapshot }`.
- Side records (group actions, rejected memory) are written only after the conditional write succeeds.
- Comments, reactions, and source-link opens append to `app_group_actions`; they need no revision but still return `404` when the listing is gone.
- The daily loop's listing upsert increments `revision` on conflict so stale clients conflict instead of overwriting loop output.
- Client: mutations read the latest observed revision when the queued request runs. On `409` or `404` the client applies the returned snapshot and reports the conflict or removal; it never reports success.

### Persisted run history

- `GET /api/group/runs` → `200 { ok:true, history: { groupId, generatedAt, runs: PersistedRunHistoryRun[] } }`, newest first, limited to 25 runs.
- `PersistedRunHistoryRun` extends `BriefingRunHistoryRun` with `mode`, `skipped { seen, saved, rejected, triaged }`, `materialChanges`, `memoryUpdates`, and `briefingSummary?`.
- Assembly sources:
  - status, timestamps, cadence, trigger, mode, and counts come from `daily_loop_runs`;
  - coverage and failures come from `daily_loop_sources`;
  - bucket counts come from `daily_loop_candidates`;
  - skip and material-change counts come from `daily_loop_candidate_status`;
  - memory updates come from `daily_loop_seen_memory.last_run_id`;
  - provider metadata, candidate summaries, and the briefing summary come from `daily_loop_briefings` (the run's own persisted history contract and briefing record).
- Queued or running runs without a briefing render with empty summaries.
- Fixture-mode runs that were actually executed are shown with an explicit `Fixture mode` label.
- The UI shows loading, error (with retry), and empty states, plus a refresh button. `g3cBriefingRunHistoryFixture` is removed from the production workspace.

## Execution Sequence

### 1. Contract And Security Design

Owner: primary agent with a read-only adversarial architecture review.

- Define the server-only group credential environment contract and Cloudflare/local lookup path.
- Decide whether API requests continue carrying the user-entered invite directly or exchange it for an HTTP-only signed session. Prefer the smallest design that satisfies the no-public-credential criterion and all protected route requirements.
- Define migration compatibility for existing local D1 databases.
- Define revision response and error payloads used by server and client.
- Define the persisted history response model without changing daily-loop persistence unnecessarily.
- Update the canonical feature/story documentation before implementation if the chosen access behavior materially changes the accepted contract.

Exit gate: exact environment names, request flow, schema changes, error shapes, and file ownership are documented with no unresolved security decision.

### 2. Persisted Run History Lane

Owner: engineer subagent. This lane should avoid listing mutation and authorization internals except consuming the shared auth helper.

- Add a D1 query/assembly module for group-scoped run history.
- Add an authenticated group run-history route or include history in the existing group snapshot when payload size and ownership remain clear.
- Add frontend transport/state wiring and replace the fixture passed by `SavedListWorkspace`.
- Implement loading, error, refresh, and empty states without inventing run data.
- Add focused store, route, model, and UI tests.

Likely surfaces:

- `src/lib/daily-source-loop.ts`
- a new run-history store module under `src/lib/`
- `app/api/group/` route files
- `src/components/saved-list/SavedListWorkspace.tsx`
- `src/components/saved-list/RunHistoryPanel.tsx`
- `src/components/saved-list/run-history-model.ts`
- `src/components/saved-list/shared-listings-client.ts`
- `src/components/saved-list/useSavedListings.ts`

Exit gate: the production workspace renders persisted rows and shows a true empty state when no operational run exists.

### 3. Optimistic Concurrency Lane

Owner: engineer subagent. Run after schema/error contracts are fixed; coordinate route ownership with the authorization lane.

- Add a migration for `app_saved_listings.revision` with an initial revision for existing records.
- Return revision metadata when reading listings.
- Split creation from existing-record update behavior.
- Replace unconditional update upserts with atomic revision-checked updates.
- Apply the same precondition to field edits, statuses, review decisions, extraction updates, and other existing-record mutations.
- Ensure rejected/deleted rows cannot be resurrected by a delayed client.
- Return explicit `409` and `404` responses.
- Add client conflict recovery and user-visible messaging followed by a current-state refresh.
- Add SQLite-backed race regressions using Node's SQLite support or another dependency-free repository-compatible harness.

Likely surfaces:

- a new migration under `migrations/`
- `src/lib/shared-listing-store.ts`
- `src/lib/shared-listing-api.ts`
- `app/api/group/listings/[listingId]/route.ts`
- extraction mutation routes that update an existing listing
- `src/components/saved-list/shared-listings-client.ts`
- `src/components/saved-list/useSavedListings.ts`
- related route/store/component tests

Exit gate: edit/edit yields one success and one conflict; edit/reject cannot recreate the rejected listing; the losing client refreshes and reports the conflict.

### 4. Server-Only Authorization Lane

Owner: engineer subagent with security review. Start after the access design gate and sequence route edits around concurrency work.

- Remove the accepted invite from `src/lib/listings.ts` and all fixture/default paths that ship to the browser.
- Load accepted operator-created group credentials from server-only environment bindings with a local development equivalent.
- Keep client identity construction separate from server authorization so tests and UI models do not require embedding a real accepted secret.
- Update `requireGroupCode` and all protected routes to use the server-only credential source.
- Ensure map tile requests no longer require placing a reusable credential in a URL if the selected session design supports cookie authorization.
- Add tests proving unauthorized access, valid configured access, missing server configuration, and absence of the credential from client-facing sources/build output.

Likely surfaces:

- `src/lib/api-auth.ts`
- `src/lib/listings.ts`
- `src/lib/saved-list-storage.ts`
- protected `app/api/**/route.ts` files
- `wrangler.jsonc` comments or types only, without adding live bindings
- auth, route, storage, and build-inspection tests

Exit gate: a configured secret authorizes requests, an absent/invalid secret fails closed, and the accepted value cannot be recovered from public source or client artifacts.

### 5. Integration And Adversarial Review

Owner: primary agent plus validation subagent.

- Review every changed route for group isolation, authorization, SQL parameterization, and consistent conflict semantics.
- Run the two-client local D1 scenario for create, edit, status change, reject/remove, stale edit, polling refresh, comments, and reactions.
- Run a persisted daily-loop operation locally and verify the Runs panel reads that record rather than fixture state.
- Inspect generated client assets for configured secret values.
- Verify desktop and 390px behavior, including conflict and empty-history states.
- Confirm no Cloudflare schedules, deployments, paid provider calls, or remote data mutations occurred.

Exit gate: no correctness or security findings remain; all reproducible checks pass or an external blocker is documented precisely.

### 6. Documentation And Handoff

Owner: documentation subagent after implementation behavior is stable, reviewed by the primary agent.

- Update `README.md` to remove hardcoded-auth and fixture-history descriptions once those statements are no longer true.
- Update `SETUP.md` with secret generation/configuration, local D1 migration, persisted run creation, conflict troubleshooting, and validation commands.
- Update authoritative feature/story docs only where behavior changed.
- Replace this plan's `Status` with the actual completion state and append commit hashes, verification evidence, deployment requirements, residual risks, and exact external blockers.

Exit gate: documentation matches observable behavior and another engineer can reproduce setup and validation from a clean clone.

## Commit And Push Plan

Create small validated commits in this order:

1. `Document readiness hardening contracts`
2. `Load run history from D1`
3. `Reject stale listing mutations`
4. `Move invite authorization server-side`
5. `Cover multi-client readiness flows`
6. `Document secure setup and handoff`

Before each push:

- inspect `git status`, the scoped diff, and recent log;
- stage only the intended files;
- run validation matched to that commit's changed surface;
- never bypass hooks;
- push only after the commit passes its checks.

## Validation Commands

Exact scripts should be confirmed from `package.json` before execution. Expected final commands include:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

Additional targeted checks:

- local D1 migrations from an empty database and an existing pre-revision database;
- SQLite-backed edit/edit and edit/reject race tests;
- unauthorized and authorized requests across every protected route;
- persisted daily-loop run followed by Runs API/UI inspection;
- generated-client-asset secret scan;
- desktop and 390px browser smoke tests;
- clean-clone frozen install and full check;
- GitHub Actions result for the pushed head commit.

## External Blockers

The following cannot be claimed complete without user-provided access or explicit activation approval:

- production Cloudflare deployment;
- remote D1 migration or data restoration;
- Cron/Workflow activation;
- live Gemini, RealtyAPI, Stadia Maps, or other paid/provider verification;
- production secret provisioning and rotation.

These blockers do not prevent local implementation and SQLite/D1-semantic verification, but they must remain explicit in final readiness reporting.
