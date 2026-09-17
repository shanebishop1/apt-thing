# Setup

This guide starts with a local, persistent shortlist without paid providers, then
covers optional extraction and Cloudflare deployment. Run commands from the
repository root unless a step says otherwise.

## 1. Install And Clone

Install Git, Node.js **22.15.1** (the version in `.node-version`, which
`package.json` requires as a floor and CI pins exactly), and pnpm **10.13.1**.
`.editorconfig` carries the shared whitespace settings. If pnpm is not installed,
after selecting the correct Node version run:

```sh
npm install --global pnpm@10.13.1
```

```sh
git clone https://github.com/shanebishop1/apt-thing.git
cd apt-thing
node --version
pnpm --version
pnpm install --frozen-lockfile
cp .env.example .env
```

Leave the provider keys blank initially. `.env` is ignored by Git and is read by
Next.js and Wrangler. Do not put credentials in `wrangler.jsonc`, client code, or
variables prefixed with `NEXT_PUBLIC_`. Prefer `.env` for local development. If
you do create `.dev.vars` (also ignored by Git), Wrangler stops loading `.env`, so
every local variable must then live in `.dev.vars`.

### Create A Group Invite Code

Invite codes are server-only configuration; none is committed to the repository.
Generate a random code for the demo group and add it to `.env`:

```sh
echo "GROUP_INVITE_CODES=nyc-5br-2026=$(openssl rand -hex 16)" >> .env
```

The value is a comma-separated list of `groupId=inviteCode` pairs. Group ids must
exist in `searchGroups` in `src/lib/listings.ts` (only `nyc-5br-2026` today), and
codes shorter than 16 characters are ignored. If no valid entry is configured,
every protected API route fails closed with HTTP 503 `group-auth-unconfigured`.
The old `apt-g1` code is public in git history and is never accepted.

## 2. Add A Local Database Binding

The committed `wrangler.jsonc` intentionally has no `DB` binding. Without one,
the invite screen can load, but `/api/group/listings` returns HTTP 503 with
`d1-binding-missing`. There is no in-memory save fallback in the running UI.

Add this top-level property to your local `wrangler.jsonc`, keeping the existing
properties and valid JSONC commas:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "apt-thing-local",
    "database_id": "00000000-0000-0000-0000-000000000000",
    "migrations_dir": "migrations"
  }
]
```

The all-zero ID is a **local-only placeholder**, not a provisioned Cloudflare
database. Do not deploy it. Do not add `remote: true` or use `--remote` for local
setup. No login or cloud resource creation is needed.

Apply all migrations and regenerate binding types:

```sh
pnpm exec wrangler d1 migrations apply DB --local
pnpm cf:types
```

Confirm the migration prompt if shown. 0001 creates the demo search group, 0003
the `daily_loop_*` run tables, 0004 the `app_*` tables used by the shared-list
API, 0005 the listing `revision` column used for conflict detection, and 0006
replaces the retired committed invite code in `search_groups` with a placeholder.
Applying only some of them is not enough, and no migration seeds sample listings.

An existing local database only needs the pending migrations. The same
`pnpm exec wrangler d1 migrations apply DB --local` adds `revision = 1` to every
saved listing without touching listing data. If Wrangler reports 0001 as applied
but `search_groups` does not exist, the local state is inconsistent: move
`.wrangler/state/v3/d1` aside and apply all migrations to a fresh database.

Local database files live under `.wrangler/state/`. They survive server restarts
but are separate from any remote database. Removing that directory loses local
data. `pnpm cf:types` updates `worker-configuration.d.ts`; inspect generated and
configuration changes before including them in your own commits.

## 3. Start And Use The App

```sh
pnpm dev --hostname 127.0.0.1
```

Open `http://localhost:3000`, enter the invite code you generated in
`GROUP_INVITE_CODES` (or an invite link ending in `/invite/<code>`), and choose a
nonempty display name. There is no registration, password, or email setup.

The browser sends the code once to `POST /api/group/session`, which returns an
HTTP-only, `SameSite=Strict` session cookie scoped to `/api` and valid for 30 days.
The cookie is signed with the group's invite code, so changing the code in
`GROUP_INVITE_CODES` revokes every existing session. The browser keeps the
user-entered code and display name in `localStorage` and silently re-establishes
an expired session once; if the server rejects the code, the app returns to the
invite screen. Map tiles authenticate with the same cookie, so tile URLs contain
no credential.

`next.config.ts` initializes OpenNext's development bridge. With the binding and
migrations from step 2, Next.js can use the **local D1 emulator**, not live D1.
Keep browser storage enabled so the UI can remember the invite identity.

To exercise saving without a working source or provider, paste
`https://example.invalid/listing/setup-check` into the add-listing form. This
reserved, nonresolving domain intentionally fails extraction. The app should save
an editable manual-review record, not report successful AI extraction. Edit its
fields, change its status, and add a comment or reaction. Reload to check
persistence; saving the same URL again should open the existing record.

To see conflict handling, open the app in two browser profiles (separate
cookies) with different display names. Change a listing's status in one window,
then, before the 15-second refresh, change the same listing in the other. The
second change is rejected (HTTP 409 `listing-revision-conflict`), that window
shows a "Someone else changed that listing first" alert, and it adopts the current
listing. Rejecting a listing in one window and then editing it in the other returns
HTTP 404 `listing-not-found`; the listing is not recreated.

Real URLs are fetched by the server even when provider keys are blank. A fetched
page may contribute metadata, but Gemini extraction without a key reports
`gemini-api-key-missing`. Failed or blocked source requests also leave records
for manual review. No paid key is necessary for saving and editing those records.

### Check The API

In another terminal, with the server still running:

```sh
export INVITE_CODE='<the code from GROUP_INVITE_CODES>'
curl -sS -H "X-Invite-Code: $INVITE_CODE" http://localhost:3000/api/platform/smoke
curl -sS -H "X-Invite-Code: $INVITE_CODE" http://localhost:3000/api/group/listings
curl -sS -H "X-Invite-Code: $INVITE_CODE" http://localhost:3000/api/group/runs
```

The smoke payload should show `contextStatus: "available"` and
`bindings.db: "bound"`. `appCache: "missing"` is expected. The listings response
should have `ok: true` and a `snapshot`. A smoke response's `ok: true` alone does
not prove that a database is bound or migrated; check the binding fields and the
listings endpoint.

Every route except `/api/group/session` is protected: `/api/group/listings*`,
`/api/group/runs`, `/api/platform/*`, and `/api/map/tiles/*` accept either the
browser session cookie or the operator `X-Invite-Code` header.
Invite codes in query strings or JSON bodies are ignored. Responses: no credential
→ 401 `authentication-required`; expired or tampered session → 401
`session-invalid`; wrong code → 403 `invalid-invite-code`; nothing configured → 503
`group-auth-unconfigured`. The group is always the authenticated one; a `groupId`
query parameter has no effect.

Existing-listing mutations (`PATCH /api/group/listings/<id>`) must include the
`revision` last read from the snapshot, for example
`{"mutation":"status","status":"touring","revision":1}`. Missing revisions return
400 `revision-required`; stale revisions return 409 with the current `listing` and
`snapshot`.

### Local Modes

| Mode                                           | What it actually does                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Unmodified config plus `pnpm dev`              | Loads the UI, but shared-list operations fail without D1.                                           |
| Local `DB` binding, migrations, and `pnpm dev` | Usable persistent shortlist backed by emulated D1. No cloud database access.                        |
| `pnpm cf:preview`                              | Builds OpenNext output and runs `wrangler dev`, normally on port 8787, with local bindings.         |
| Tests and fixture helpers                      | Use controlled data and mock/in-memory stores; they are not the browser app's persistence fallback. |
| Runs tab                                       | Reads persisted `daily_loop_*` rows from D1 via `/api/group/runs`; empty until a run executes.       |

Stop the Next.js server before switching to `pnpm cf:preview`. This previews the
Worker runtime and wrapper in `src/worker.ts`; `next dev` does not exercise Cron
dispatch. Plain `pnpm build` produces a Next.js build, not a deployed Worker.
`pnpm start` is not a substitute for the configured Cloudflare binding runtime.

## 4. Optional Provider Access

Create credentials with the providers you intend to use, enable the necessary
API access/quota on those accounts, and put the values in the existing `.env`
entries. Restart the server after changing them. Providers may charge even when
the app itself is running locally; consult their current terms and pricing.

| Variable              | Used for                                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`      | A Google Gemini API key, obtainable through Google AI Studio. Single-link extraction tries `gemini-2.5-flash`, then `gemini-3.5-flash`; the daily-loop analyzer uses `gemini-3.5-flash`. Model access is account-dependent. |
| `REALTYAPI_KEY`       | RealtyAPI access to its StreetEasy API. Requests use `x-realtyapi-key` at `https://streeteasy.realtyapi.io`, with `/search/rent` and `/rental_detailsbyid`. This is not a StreetEasy website login.                         |
| `STADIA_MAPS_API_KEY` | Optional Stadia Maps raster tiles through the authenticated server-side tile proxy. Without it, or if Stadia fails, the proxy falls back to OpenStreetMap tiles.                                                                            |
| `REALTYAPI_BASE_URL`  | Optional advanced override of the RealtyAPI base URL; normally leave unset. Only point it at a trusted endpoint because it receives your API key.                                                                           |
| `APP_ENV`             | Diagnostic environment label; `local` by default. Not a security or provider-disable switch.                                                                                                                                |
| `NEXTJS_ENV`          | OpenNext build/runtime environment setting; retain the template's `production` value.                                                                                                                                       |

For StreetEasy URLs, a configured RealtyAPI key takes the provider path first.
That path searches for an exact URL match and can make multiple paid requests;
it does not require Gemini when successful. Pasted links and the source loop read
the same provider record, so a pasted StreetEasy listing saves the provider's
coordinates and gets a map pin. Without RealtyAPI, the app attempts the
source-page/Gemini path, which may be blocked. Other URLs use source-page fetching
and Gemini. There is no login automation or CAPTCHA bypass.

Map tiles, the subway route overlay, and remote photos still require internet
access without these keys; the nearest-station list is computed locally from the
committed MTA dataset in `src/lib/nyc-subway-stations.ts`, but only for listings
that have coordinates. Verify provider results against the original listing;
coordinates, extracted facts, availability, and visual evidence can be missing or
incorrect.

To check RealtyAPI access on its own, run `pnpm proof:streeteasy` with
`REALTYAPI_KEY` exported in your shell or set in `.env.local`, which is the only
env file that script reads. It writes request and response evidence to
`tmp/streeteasy-live-proof/`. `pnpm proof:streeteasy -- --fixture` writes the same
shape offline and makes no paid request.

### Source Loop And Fixtures

`POST /api/platform/daily-loop` runs the loop in `fixture` (the default) or
`live-safe` mode. POST is the only verb the route exports, so a GET returns 405;
read past runs from `GET /api/group/runs` instead. With D1 bound, a run writes run
records and shortlist data.

**Fixture mode is not a universal no-spend switch:** a supplied Gemini key can
still activate the analyzer. For provider-free fixtures, leave keys blank in
`.env` and unset inherited provider credentials in your shell. Run fixtures only
against disposable local data, not a real group's database.

```sh
curl -sS -X POST http://localhost:3000/api/platform/daily-loop \
  -H 'Content-Type: application/json' \
  -H "X-Invite-Code: $INVITE_CODE" \
  -d '{"mode":"fixture","cadence":"manual","trigger":"fixture"}'
```

Inspect `sourceCoverage`, `observability`, and `persistence` in the response.
With D1 bound, `persistence.d1.rowsWritten` is nonzero and the run now appears in
the Runs tab (use its refresh button) and in `GET /api/group/runs`, labeled
**Fixture mode**, with its status, source failures, skip counts, and briefing.
Provider metadata from fixture runs is shown as simulated AI attempts. The tab
also reports how many attempts failed, so a run that fell back to deterministic
triage is visible rather than reading as a clean set of AI calls.
Missing KV and disabled R2 are not evidence of a live storage failure. The
`live-safe` name does not mean free: that mode can call RealtyAPI and Gemini.
Its secondary source is not a live Zillow crawler. Automated scheduling is
disabled in the checked-in configuration.

## 5. Development Checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check:client-secrets
```

`pnpm check` runs those six steps in order. Oxfmt and Oxlint cover `app`, `src`,
`scripts`, `e2e`, and the root config files, and `typecheck` runs `next typegen` before
`tsc --noEmit`, so a clean checkout generates Next's types on its first run.
Tests use fixtures, mocks, and an
in-memory `node:sqlite` database that applies the real migrations, covering the
listing race, two-client, and run-history paths. They need no provider key and no
cloud account. `check:client-secrets` scans `.next/static` for the retired invite
code, for `GROUP_INVITE_CODES` entries found in the environment, `.env.local`, or
`.dev.vars`, and for provider key values. After `pnpm cf:build`, run
`node scripts/check-client-secrets.mjs --open-next` to scan the Worker assets too.
GitHub Actions runs the same checks on pushes to `main` and pull requests, without
deploying. None of them prove live provider access or cloud bindings.

For Worker packaging and a local runtime check:

```sh
pnpm cf:deploy:dry
pnpm cf:preview
```

The dry run builds and bundles without uploading. Preview starts a local server;
use its printed URL for the same invite, save, reload, and API checks above.

### End-to-end tests

```sh
pnpm exec playwright install chromium  # once per machine
pnpm test:e2e                          # pnpm test:e2e:ui for the interactive runner
```

These are not part of `pnpm check`; they are a separate suite that drives a real
browser against a real `next dev` server on `http://127.0.0.1:3111`. The server is
started by Playwright with `APT_WRANGLER_CONFIG=e2e/wrangler.e2e.jsonc`, which is a
copy of the committed Wrangler config plus a local `DB` binding, so requests reach
the D1 emulator instead of a mock. Its data lives in `.wrangler/e2e-state`, separate
from the `.wrangler/state` a normal `wrangler dev` uses, and `e2e/reset-database.mjs`
deletes and re-migrates that directory before every run so each suite starts empty.
Provider keys are blank for this server, so pasted links become manual-review
records; that is what the specs assert against. `e2e/.dev.vars` holds the dummy
invite code the suite signs in with — it is a fixture, not a secret. A failing run
leaves an HTML report in `playwright-report/`; open it with
`pnpm exec playwright show-report`. GitHub Actions runs the same suite in a second
`e2e` job after the checks job and uploads that report when it fails.

## 6. Optional Cloudflare Deployment

This section creates real resources and can incur charges. It is not required
for local development. The repository's default config has `workers_dev: false`,
`preview_urls: false`, no routes, no resource bindings, an empty cron list, and
`DAILY_LOOP_ENABLED: "false"`. Deploying it unchanged is not a usable hosted app.

**Security first:** API and map-tile access requires the server-only invite code
(or a session derived from it), and `next.config.ts` sets baseline response
headers, but the static UI shell is public, the code is shared by the whole group,
display names are not verified identities, and invite attempts are not rate
limited. Use a long random code, share it privately, and rotate it if it leaks.
Consider an additional perimeter (for example Cloudflare Access) before adding
paid provider credentials.

1. Choose your own Worker name in `wrangler.jsonc`, retain `main: "src/worker.ts"`
   and the existing assets/compatibility settings, and set `vars.APP_ENV` to
   `production`. Keep `DAILY_LOOP_ENABLED: "false"` and `triggers.crons: []`.
2. Authenticate and create a database in your account:

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create apt-thing-db --update-config=false
```

3. Replace the local placeholder binding with the returned `database_id` and
   `database_name`, retaining `binding: "DB"` and `migrations_dir: "migrations"`.
   Do not add a second `DB` binding. Keep local development local by leaving
   `remote: true` unset.
4. Apply the schema to the real database, then check packaging:

```sh
pnpm exec wrangler d1 migrations apply DB --remote
pnpm cf:types
pnpm cf:deploy:dry
```

5. Choose a reachable endpoint. For a non-sensitive prototype, set
   `workers_dev: true` to use your account's workers.dev subdomain. Alternatively,
   configure your own route/custom domain and access protection; no project
   domain is provided. `preview_urls` can remain false.
6. Set the invite code secret before deploying, or every protected route returns 503:

```sh
pnpm exec wrangler secret put GROUP_INVITE_CODES
```

   Enter `nyc-5br-2026=<random code>` at the prompt. To rotate, run the same
   command with a new code; all existing browser sessions are revoked and members
   re-enter the new code.

7. Deploy:

```sh
pnpm cf:deploy
```

8. Add only the optional provider secrets you need, using the interactive
   prompts rather than shell command arguments:

```sh
pnpm exec wrangler secret put GEMINI_API_KEY
pnpm exec wrangler secret put REALTYAPI_KEY
pnpm exec wrangler secret put STADIA_MAPS_API_KEY
```

Local `.env` values are not automatically provisioned as deployed secrets. Local
SQLite data is not uploaded by migrations or deployment. Use the deployment URL
to repeat the smoke/listings requests and the browser save/reload test. Check
that D1 is bound and that real source/provider calls behave as expected before
relying on the deployment.

### What Is Not Required

The manually maintained shortlist needs D1, but does not require KV, R2, Queues,
or Workflows. `APP_CACHE` is an optional KV cache/config binding, not authoritative
listing storage. R2 storage is intentionally disabled. The Worker does not export
a queue consumer, so adding queue bindings alone does not enable a queue pipeline.

Scheduled discovery is a separate, opt-in operational step. The Worker exports
`DailySourceAgentLoopWorkflow`; its expected binding name is
`DAILY_SOURCE_AGENT_LOOP_WORKFLOW`. A workflow-backed schedule needs that binding
and a Cron schedule, plus deliberately enabling `DAILY_LOOP_ENABLED` and validating
live provider access and spending limits. The scheduler has an inline fallback
if the Workflow binding is missing or dispatch fails. Leave scheduling disabled
until that path has been tested for your account.

`DAILY_LOOP_ENABLED: "false"` gates the scheduled handler only. It does **not**
block manual API calls, listing extraction, or the daily-loop HTTP endpoint.
Disabling the Cron schedule is not a substitute for securing those endpoints.

## Troubleshooting

| Symptom                               | Check                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Unsupported-engine warning            | Use Node 22.15.1 (see `.node-version`) and pnpm 10.13.1.                                                         |
| `d1-binding-missing` / HTTP 503       | Add `DB`, restart the server, and check the smoke binding fields. `APP_ENV` does not create a binding.           |
| `no such table` or foreign-key errors | Apply all migrations to the same local or remote database used by the server.                                    |
| HTTP 401 `authentication-required`    | Sign in through the UI (session cookie) or send `X-Invite-Code`; codes in query strings or bodies are ignored.  |
| HTTP 403 / invalid invite             | Use the code configured in `GROUP_INVITE_CODES` and a nonempty display name. `apt-g1` is retired.                |
| HTTP 503 `group-auth-unconfigured`    | Set `GROUP_INVITE_CODES` (`.env` locally, `wrangler secret put` when deployed) with a known group id and a code of 16+ characters, then restart. |
| HTTP 409 `listing-revision-conflict`  | Someone changed the listing first. Reload or use the returned snapshot, then reapply the change with the new `revision`. |
| HTTP 400 `revision-required`          | Include the listing's current `revision` in `PATCH /api/group/listings/<id>` bodies.                             |
| Empty shortlist after signing in      | A fresh database has no listings; an unavailable API can also leave the UI empty. Inspect `/api/group/listings`. |
| Extraction needs manual review        | Check the reported source/provider error. Saving a fallback record does not mean extraction succeeded.           |
| Blank or incomplete map               | Check tile requests, external network access, and whether the listing has usable coordinates; a listing saved without them gets no pin and no subway context. `tile-fetch-failed` (502 when the fallback returned no status) means both Stadia and OpenStreetMap refused the tile. |
| Run missing from the Runs tab         | Check the run response's `persistence.d1` (a missing binding writes nothing), then use the Runs refresh button.  |
| Deployed Worker has no reachable URL  | Check `workers_dev` or your route/domain configuration; both public URL mechanisms are off by default.           |

## References

- [OpenNext Cloudflare setup](https://github.com/opennextjs/docs/blob/main/pages/cloudflare/get-started.mdx)
- [Cloudflare local environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables)
- [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1)
- [Cloudflare Workflow bindings](https://developers.cloudflare.com/workflows/build/workers-api)
