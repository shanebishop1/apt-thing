# Setup

This guide starts with a local, persistent shortlist without paid providers, then
covers optional extraction and Cloudflare deployment. Run commands from the
repository root unless a step says otherwise.

## 1. Install And Clone

Install Git, Node.js **22.15.1**, and pnpm **10.13.1**, matching `package.json`.
If pnpm is not installed, after selecting the correct Node version run:

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
variables prefixed with `NEXT_PUBLIC_`. Use `.env` rather than `.dev.vars` here:
the latter is not covered by this repository's checked-in ignore rules, and a
`.dev.vars` file also takes precedence over Wrangler's `.env` loading.

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

Apply all four migrations and regenerate binding types:

```sh
pnpm exec wrangler d1 migrations apply DB --local
pnpm cf:types
```

Confirm the migration prompt if shown. The first migration creates the demo
search group; the fourth creates the `app_*` tables used by the shared-list API.
Applying only the fourth migration is not sufficient. Migrations do not populate
the shortlist with sample listings.

Local database files live under `.wrangler/state/`. They survive server restarts
but are separate from any remote database. Removing that directory loses local
data. `pnpm cf:types` updates `worker-configuration.d.ts`; inspect generated and
configuration changes before including them in your own commits.

## 3. Start And Use The App

```sh
pnpm dev --hostname 127.0.0.1
```

Open `http://localhost:3000`, enter invite code **`apt-g1`**, and choose a nonempty
display name. The code and group are defined in `src/lib/listings.ts` and seeded
by the migrations. There is no invite-code environment variable, registration,
password, or email setup.

`next.config.ts` initializes OpenNext's development bridge. With the binding and
migrations from step 2, Next.js can use the **local D1 emulator**, not live D1.
Keep browser storage enabled so the UI can remember the invite identity.

To exercise saving without a working source or provider, paste
`https://example.invalid/listing/setup-check` into the add-listing form. This
reserved, nonresolving domain intentionally fails extraction. The app should save
an editable manual-review record, not report successful AI extraction. Edit its
fields, change its status, and add a comment or reaction. Reload to check
persistence; saving the same URL again should open the existing record.

Real URLs are fetched by the server even when provider keys are blank. A fetched
page may contribute metadata, but Gemini extraction without a key reports
`gemini-api-key-missing`. Failed or blocked source requests also leave records
for manual review. No paid key is necessary for saving and editing those records.

### Check The API

In another terminal, with the server still running:

```sh
curl -sS -H 'X-Invite-Code: apt-g1' http://localhost:3000/api/platform/smoke
curl -sS -H 'X-Invite-Code: apt-g1' http://localhost:3000/api/group/listings
```

The smoke payload should show `contextStatus: "available"` and
`bindings.db: "bound"`. `appCache: "missing"` is expected. The listings response
should have `ok: true` and a `snapshot`. A smoke response's `ok: true` alone does
not prove that a database is bound or migrated; check the binding fields and the
listings endpoint. Without the invite header, a configured listings API returns 403. The API also accepts the invite code in request bodies or query parameters;
prefer headers for diagnostics to avoid putting it in URLs.

### Local Modes

| Mode                                           | What it actually does                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Unmodified config plus `pnpm dev`              | Loads the UI, but shared-list operations fail without D1.                                           |
| Local `DB` binding, migrations, and `pnpm dev` | Usable persistent shortlist backed by emulated D1. No cloud database access.                        |
| `pnpm cf:preview`                              | Builds OpenNext output and runs `wrangler dev`, normally on port 8787, with local bindings.         |
| Tests and fixture helpers                      | Use controlled data and mock/in-memory stores; they are not the browser app's persistence fallback. |
| Run history tab                                | Displays a fixture contract, not a live query of recorded runs.                                     |

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
| `STADIA_MAPS_API_KEY` | Optional Stadia Maps raster tiles through the authenticated server-side tile proxy. Without it, or if Stadia fails, the proxy tries CARTO tiles.                                                                            |
| `REALTYAPI_BASE_URL`  | Optional advanced override of the RealtyAPI base URL; normally leave unset. Only point it at a trusted endpoint because it receives your API key.                                                                           |
| `APP_ENV`             | Diagnostic environment label; `local` by default. Not a security or provider-disable switch.                                                                                                                                |
| `NEXTJS_ENV`          | OpenNext build/runtime environment setting; retain the template's `production` value.                                                                                                                                       |

For StreetEasy URLs, a configured RealtyAPI key takes the provider path first.
That path searches for an exact URL match and can make multiple paid requests;
it does not require Gemini when successful. Without RealtyAPI, the app attempts
the source-page/Gemini path, which may be blocked. Other URLs use source-page
fetching and Gemini. There is no login automation or CAPTCHA bypass.

The map and remote photos still require internet access without these keys.
Verify provider results against the original listing; coordinates, extracted
facts, availability, and visual evidence can be missing or incorrect.

### Source Loop And Fixtures

`/api/platform/daily-loop` supports `fixture` (the default) and `live-safe` modes.
It is an execution endpoint, including for GET requests, not a read-only history
endpoint. If D1 is bound, it can write run records and shortlist data.

**Fixture mode is not a universal no-spend switch:** a supplied Gemini key can
still activate the analyzer. For provider-free fixtures, leave keys blank in
`.env` and unset inherited provider credentials in your shell. Run fixtures only
against disposable local data, not a real group's database.

```sh
curl -sS -X POST http://localhost:3000/api/platform/daily-loop \
  -H 'Content-Type: application/json' \
  -H 'X-Invite-Code: apt-g1' \
  -d '{"mode":"fixture","cadence":"manual","trigger":"fixture"}'
```

Inspect `sourceCoverage`, `observability`, and `persistence` in the response.
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
```

`pnpm check` runs those five steps in order. Tests use fixtures/mocks and do not
require provider keys or a cloud account. GitHub Actions runs formatting, lint,
typechecking, and tests on pushes to `main` and pull requests, not deployment.
These checks do not prove live provider access or cloud bindings.

For Worker packaging and a local runtime check:

```sh
pnpm cf:deploy:dry
pnpm cf:preview
```

The dry run builds and bundles without uploading. Preview starts a local server;
use its printed URL for the same invite, save, reload, and API checks above.

## 6. Optional Cloudflare Deployment

This section creates real resources and can incur charges. It is not required
for local development. The repository's default config has `workers_dev: false`,
`preview_urls: false`, no routes, no resource bindings, an empty cron list, and
`DAILY_LOOP_ENABLED: "false"`. Deploying it unchanged is not a usable hosted app.

**Security first:** the invite code is public and bundled with the app. Display
names are not verified identities. Before sharing private listings or adding
paid credentials, restrict access with an independent authentication perimeter
covering both the UI and every API route. Changing the hardcoded code alone does
not provide secure authentication. Public deployment as-is is suitable only for
non-sensitive prototype data, without paid provider access.

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
6. Deploy:

```sh
pnpm cf:deploy
```

7. After access protection is in place, add only the optional secrets you need,
   using the interactive prompts rather than shell command arguments:

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
listing storage. R2 storage is intentionally disabled. Queue fan-out code is a
simulation; the Worker does not export a queue consumer, so adding queue bindings
alone does not enable a working queue pipeline.

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
| Unsupported-engine warning            | Use Node 22.15.1 and pnpm 10.13.1.                                                                               |
| `d1-binding-missing` / HTTP 503       | Add `DB`, restart the server, and check the smoke binding fields. `APP_ENV` does not create a binding.           |
| `no such table` or foreign-key errors | Apply all migrations to the same local or remote database used by the server.                                    |
| HTTP 403 / invalid invite             | Use `apt-g1`, a nonempty display name, and the correct request header/body.                                      |
| Empty shortlist after signing in      | A fresh database has no listings; an unavailable API can also leave the UI empty. Inspect `/api/group/listings`. |
| Extraction needs manual review        | Check the reported source/provider error. Saving a fallback record does not mean extraction succeeded.           |
| Blank or incomplete map               | Check tile requests, external network access, and whether the listing has usable coordinates.                    |
| History does not change after a run   | The UI history is fixture-backed, not connected to persisted run history.                                        |
| Deployed Worker has no reachable URL  | Check `workers_dev` or your route/domain configuration; both public URL mechanisms are off by default.           |

## References

Setup details were cross-checked with Context7 against these upstream references:

- [OpenNext Cloudflare setup](https://github.com/opennextjs/docs/blob/main/pages/cloudflare/get-started.mdx)
- [Cloudflare local environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables)
- [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1)
- [Cloudflare Workflow bindings](https://developers.cloudflare.com/workflows/build/workers-api)
