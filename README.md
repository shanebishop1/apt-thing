# apt-thing

[![CI](https://github.com/shanebishop1/apt-thing/actions/workflows/ci.yml/badge.svg)](https://github.com/shanebishop1/apt-thing/actions/workflows/ci.yml)

A shared apartment shortlist for a roommate group looking for a five-bedroom
apartment in NYC. Save listing links, review extracted facts, compare locations,
and keep the group's decisions in one place.

## Capabilities

- Save URLs with duplicate detection and editable fallback records when extraction fails.
- Extract listing details through RealtyAPI for StreetEasy or page fetching plus Gemini.
- Review rent, rooms, photos, floor plans, evidence, and field-edit provenance.
- Track interest and touring status, approve or reject candidates, and add comments and reactions.
- Protect concurrent edits with per-listing revisions: stale edits are rejected with a visible conflict, never silently overwritten, and rejected listings are never recreated by a delayed update.
- Review persisted source-loop runs (status, source coverage and failures, skips, triage counts, briefing) in the Runs tab.
- Compare listings on a Leaflet map with neighborhood, subway, and grocery context.
- Use list and map views on desktop or mobile, with light and dark themes.

## How It Works

```text
Browser -> POST /api/group/session (invite code) -> HTTP-only session cookie
Browser -> Next.js API routes -> source page / RealtyAPI / Gemini
                            -> D1 listings (revisioned), group actions, run history
Browser <- shared snapshot, refreshed periodically
```

The frontend uses Next.js App Router, React, TypeScript, Leaflet, and CSS. The API
stores shared state in Cloudflare D1; browser storage remembers the user-entered
invite, display name, and UI preferences, not an independent shared database.
Accepted invite codes exist only in server-side configuration (`GROUP_INVITE_CODES`). OpenNext packages the app for
Cloudflare Workers, with `src/worker.ts` providing the fetch and scheduled entrypoints.

`app/` contains pages and API routes, `src/components/` contains the review UI,
`src/lib/` holds extraction, storage, and source-loop logic, and `migrations/`
defines the database schema. Vitest covers behavior; Oxlint, Oxfmt, and TypeScript
provide static checks. GitHub Actions runs checks on pushes to `main` and pull requests,
without deploying the app.

## Current Limits

- The checked-in Cloudflare configuration is hibernated: no database, queue, or
  workflow bindings, no cron schedule, and no public Worker URL. Starting Next.js
  alone does **not** produce a working shared database.
- Access is a shared, operator-configured invite code plus a self-chosen display
  name, not per-person accounts. Anyone holding the code can act as any display
  name, and there is no rate limiting on invite attempts, so use a long random
  code and rotate it (which revokes all sessions) if it leaks.
- Extraction depends on source access and provider availability. Blocked pages,
  missing keys, or incomplete results need manual review; AI output is not a
  guarantee of availability, accuracy, or apartment suitability.
- The Runs tab shows only runs persisted to D1; it is empty until a manual or
  scheduled source-loop run executes. Fixture-mode runs are labeled as such.
  Automated discovery is not enabled by default and is not a comprehensive search
  of every rental site.
- Maps and source-hosted images need external services. Raw image/artifact storage
  is disabled; there is no R2 archive.

## Setup

See **[SETUP.md](SETUP.md)** for a clean-clone local setup, a local D1 database,
optional provider credentials, verification commands, and optional Cloudflare
deployment. No cloud account or paid API key is needed for the local manual-review path.
