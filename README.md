# Social Influence Workspace (proof of concept)

A standalone IMAI-themed workspace where a brand team chats with an analyst over social-listening data, approves the dashboard elements it proposes, and saves a custom dashboard.

- **Data**: a preloaded export of 6,168 creator posts, 31,688 analysed comments and 3,332 creator profiles about Venus (the focal brand) and five competitors: Estrid, Veet, Philips OneBlade, Wilkinson Sword and Mercadona.
- **Chat**: an LLM analyst (OpenAI when `OPEN_AI_KEY` is set, otherwise Claude) with two tools, `run_sql` (read-only Postgres) and `propose_widget`. Every answer is grounded in a query; proposals appear as live preview cards the person can add, replace, refine or dismiss.
- **Dashboard**: a 12-column drag-and-resize grid with KPI rows, bar, stacked bar, line and segmented charts, tables, section headers, notes and insight cards. Every widget is a saved SQL query plus a rendering recipe, editable in place.
- **Persistence**: Postgres (hosted) so everyone internally sees the same dashboards and chat history. No auth in this version. Share and Export are placeholders.

## Run locally

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY to use Claude; leave empty for demo mode
npm run dev
```

The first request creates the schema and loads the dataset into an embedded PGlite database under `data/pglite` (about five seconds). No external database is needed locally. You can also seed explicitly:

```bash
npm run db:seed
```

Open http://localhost:3000 and create a dashboard: build it with the analyst (guided questions, see `docs/onboarding-wizard-plan.md`), start from a template, or start blank, then ask the analyst a question. Every dashboard has a global time period (the bar above the grid): a month, a custom range or all time, with an optional comparison period. The period is applied inside the database, so every saved query follows it without changes (see `docs/time-periods-plan.md`). Templates live in `src/lib/templates.ts`: the starter template (`src/lib/starter.ts`: five first-person questions that work for any brand, with sections left out when the data cannot support them, see `docs/starter-template-plan.md`) and Eran's template (eight strategic questions). Nothing in the code names a brand: the tracked brands and the focal brand come from the `segments` table, and SQL uses `focal_brand()` and `is_competitor(brand)`. `npm run check:templates` runs every element with each brand of every industry as the focal brand.

Every dashboard looks at a chosen set of brands: one industry, one brand as "your company" and the competitors you pick from that industry. You choose them when you create a dashboard (the picker shows what each brand is, who owns it and how much data it has, with a summary of the industry) and can change them later with the Brands button. The choice is enforced in the database, not in each query: `posts`, `comments`, `influencers` and `segments` are views that only return the dashboard's brands, so every template, saved element and analyst query follows it without changes. The catalogue (`/data`, one industry at a time) lists what is loaded.

Every AI interaction is metered in tokens (see `docs/token-usage-plan.md`). The answer shows what it used and what is left, the header shows the balance, and the Usage page (`/usage`) shows the totals, a daily chart, where the tokens went, the full log (with CSV export) and the statement. At zero the analyst stops until tokens are added. In demo mode the counts are estimates from text length and are labelled "estimated". `npm run check:usage` runs one interaction of every kind against a local app and checks the log, the statement and the balance agree.

## Deploy to Vercel

1. Create a Postgres database (Vercel Postgres / Neon) and copy its connection string.
2. Import this repository in Vercel and set the environment variables:
   - `DATABASE_URL` – the Postgres connection string
   - `OPEN_AI_KEY` – an OpenAI API key (or `ANTHROPIC_API_KEY` for Claude)
3. Deploy. The first request after deploy creates the tables and seeds the dataset from `data/seed/*.json.gz` (bundled with the functions; takes 20 to 60 seconds on a hosted database, only once). To seed ahead of time instead, run `DATABASE_URL=... npm run db:seed` from your machine.

Serverless functions have a 300 second limit configured for the chat route (`maxDuration`); adjust for your plan if needed.

## Configuration

| Variable | Purpose |
|---|---|
| `OPEN_AI_KEY` | Enables the OpenAI provider (default model `gpt-5.2`, override with `OPENAI_MODEL`; optional `OPENAI_REASONING_EFFORT`). Takes precedence over Claude. |
| `LLM_PROVIDER` | `openai` or `claude` to force a provider when both keys are set. |
| `ANTHROPIC_API_KEY` | Enables Claude. Without any key the app runs in demo mode with scripted answers. |
| `ANTHROPIC_WORKSPACE_ID` | Only for organisation-level keys not scoped to a workspace; the API otherwise rejects requests asking for the `anthropic-workspace-id` header. |
| `DATABASE_URL` | Postgres connection. Empty means embedded PGlite (local only). |
| `CLAUDE_MODEL` | Defaults to `claude-opus-5-5`. |
| `CLAUDE_EFFORT` | `low`, `medium` (default), `high`, `xhigh`, `max`. |
| `CLAUDE_FALLBACKS` | Server-side refusal fallbacks are on by default; set `0` to disable. |
| `MOCK_LLM` | Set `1` to force demo mode. |
| `IMPORT_TOKEN` | When set, `POST /api/imports`, `GET /api/imports` and `/api/cron/coverage` require `Authorization: Bearer <token>` (Vercel's `CRON_SECRET` is accepted for the cron). Unset means open (local). |
| `NOTIFY_WEBHOOK_URL` | Optional: every new period event is POSTed there as JSON (`{ type: "period_event", event }`). |
| `STARTING_TOKENS` | Token allowance granted the first time the app starts on a database. Defaults to 1,000,000. |
| `DEMO_TOPUP` | The demo "Add tokens" button and `POST /api/usage/top-up` are on by default (no payment is taken). Set `0` to turn them off. |
| `USAGE_PRICES` | Optional JSON price table for the cost estimate on the usage page: `{ "model-id": [usd per million input tokens, usd per million output tokens] }`. Defaults are in `src/lib/usage.ts`. |

## Project layout

```
data/seed/            gzipped JSON seed files built from the four CSV exports
scripts/build_seed.py rebuilds data/seed from the raw CSVs (python3 -I scripts/build_seed.py <csv dir>)
scripts/seed.ts       CLI seeder (npm run db:seed)
src/lib/db.ts         database adapter: pg when DATABASE_URL is set, PGlite otherwise
src/lib/schema.ts     DDL, seeding, ensureReady()
src/lib/sql-guard.ts  read-only SQL checks and row caps for model-written queries
src/lib/claude.ts     chat turn: system prompt, tools, streaming loop, persistence, demo mode
src/lib/widgets.ts    widget spec schema, default catalog, starter questions
src/lib/templates.ts  dashboard templates (default, Eran's template, blank) and their grid layout
src/lib/period.ts     period model: month/range/all time, comparison windows, URL serialisation
src/lib/coverage.ts   what the dataset covers, per month, from the data and the import log
src/lib/brands.ts     workspace registry (tracked brands, focal brand) and the validated categorical palette
src/lib/catalog.ts    the industries and brands, loaded from the data; catalogue file and industry packs
src/lib/scope.ts      the brand scope of a request: which brands a dashboard sees
src/lib/workspace.ts  reloads the catalogue after an import
src/lib/starter.ts    the brand-neutral starter template
src/components/       workspace UI (chat panel, proposal cards, grid canvas, charts, editor)
src/lib/imports.ts    incremental imports (idempotent upserts, import log)
src/lib/period-events.ts  month_started / completed / revised / missing detection
scripts/import.ts     CLI import (npm run import -- <dir>)
src/app/api/          dashboards, chat (NDJSON stream), widget data, status, imports, period-events, cron
```

## Industries and brands

The database holds several industries. One is "live": it has audience comments with comment analysis and receives new months through imports. The others are fixed snapshots of creator posts for one month, loaded from industry packs.

- `data/seed/catalog.json` describes every industry (name, category, region, summary, suggested company) and every brand (description, owner, kind, aliases). It is the only place brand and industry words live; the app copies it into the `industries` and `segments_raw` tables when the file changes.
- `data/seed/packs/<industry>.json.gz` holds one industry's posts and creators. The app loads packs that are missing or changed a few seconds at a time after start, and remembers how far it got, so the first requests after a deploy are not held up. An industry appears in the picker once its pack has finished loading.
- To build packs from per-brand post exports (one folder per industry, `<month>/<Brand>.csv` inside), add the industry and its brands to `catalog.json` with `"source"` set to the folder and file names, then run:

```bash
python3 -I scripts/build_packs.py <folder with the exports> --cap 1000
```

Each brand is sampled at random down to the cap (fixed seed, so a rebuild gives the same pack). Posts-only industries have no comments, so the starter template leaves out the sections that need them, Eran's template leaves out its comment-based elements, and the guided setup asks only the questions the data can answer. Each says so in the dashboard's chat.

How scoping works: the data lives in `posts_raw`, `comments_raw`, `influencers_raw` and `segments_raw`. A request that belongs to a dashboard runs inside its scope (`src/lib/scope.ts`), which sets two transaction-local settings, `app.brands` and `app.focal_brand`. The views `posts_all`, `comments_all`, `influencers` and `segments` filter to those brands; `posts` and `comments` add the period. `focal_brand()` and `is_competitor(brand)` follow the same settings. Queries written by a person or by the analyst cannot name the raw tables.

## Rebuilding the dataset

Put the four CSV exports in a folder as `segments.csv`, `posts.csv`, `comments.csv`, `influencers.csv` and run:

```bash
python3 -I scripts/build_seed.py /path/to/csvs
```

Then bump `SEED_VERSION` in `src/lib/schema.ts` so existing databases reload, or drop the four data tables.

## Importing new data

New exports are loaded incrementally; the bundled seed counts as the first import. Files use the normalised column layout of `data/seed` (raw IMAI CSVs go through `scripts/build_seed.py` first).

```bash
# a folder with any of segments, posts, comments, influencers as .json, .json.gz or .csv
npm run import -- /path/to/export --source imai-2026-08 --from 2026-08-01 --to 2026-08-31
```

With local PGlite stop `next dev` first (one process per database). Over HTTP, `POST /api/imports` takes `{ source, covers_from, covers_to, segments, posts, comments, influencers }` as JSON (up to 8 MB; Vercel caps bodies at 4.5 MB, so use the CLI against `DATABASE_URL` for bigger drops). `--from`/`--to` (`covers_from`/`covers_to`) are the export's own date range and default to the min and max `published_at` of the batch.

Loading is idempotent: posts and comments are upserted on `(segment_id, post_id)` / `(segment_id, comment_id)` and their metrics refreshed, influencers and segments are replaced. Each import is logged in `imports` (`GET /api/imports`) and compared with the coverage before it, producing `period_events` (`GET /api/period-events?since=<id>`):

| Event | When |
|---|---|
| `month_started` | a month had no rows and now has some |
| `month_completed` | the coverage now reaches the end of the month |
| `month_revised` | an already complete month changed its post or comment count |
| `month_missing` | the daily cron (`vercel.json`, `/api/cron/coverage`) found last calendar month still incomplete |

Events drive the header bell, the "July 2026 data is in" banner on dashboards and the analyst's "summarise what changed" nudge (read state per browser), plus the optional webhook.
