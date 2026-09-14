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
- Compare listings on a Leaflet map with neighborhood, subway, and grocery context.
- Use list and map views on desktop or mobile, with light and dark themes.

## How It Works

```text
Browser -> Next.js API routes -> source page / RealtyAPI / Gemini
                            -> D1 listings, edits, and group actions
Browser <- shared snapshot, refreshed periodically
```

The frontend uses Next.js App Router, React, TypeScript, Leaflet, and CSS. The API
stores shared state in Cloudflare D1; browser storage remembers identity and UI
preferences, not an independent shared database. OpenNext packages the app for
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
- Authentication is a public, hardcoded invite code and a self-chosen display
  name. This is a single-group prototype, not secure account authentication.
  Do not expose private data or paid provider access to untrusted users.
- Extraction depends on source access and provider availability. Blocked pages,
  missing keys, or incomplete results need manual review; AI output is not a
  guarantee of availability, accuracy, or apartment suitability.
- Run history in the UI is fixture-backed. The backend source loop has fixture
  and live modes, but automated discovery is not enabled by default and is not a
  comprehensive search of every rental site.
- Maps and source-hosted images need external services. Raw image/artifact storage
  is disabled; there is no R2 archive.

## Setup

See **[SETUP.md](SETUP.md)** for a clean-clone local setup, a local D1 database,
optional provider credentials, verification commands, and optional Cloudflare
deployment. No cloud account or paid API key is needed for the local manual-review path.
