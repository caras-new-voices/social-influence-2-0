# Social Influence Workspace (proof of concept)

A standalone IMAI-themed workspace where a brand team chats with an analyst over social-listening data, approves the dashboard elements it proposes, and saves a custom dashboard.

- **Data**: a preloaded export of 6,168 creator posts, 31,688 analysed comments and 3,332 creator profiles about Venus (the focal brand) and five competitors: Estrid, Veet, Philips OneBlade, Wilkinson Sword and Mercadona.
- **Chat**: Claude (`claude-opus-5-5`) with two tools, `run_sql` (read-only Postgres) and `propose_widget`. Every answer is grounded in a query; proposals appear as live preview cards the person can add, replace, refine or dismiss.
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

Open http://localhost:3000, create a dashboard from the default template (twelve curated elements) or start blank, and ask the analyst a question.

## Deploy to Vercel

1. Create a Postgres database (Vercel Postgres / Neon) and copy its connection string.
2. Import this repository in Vercel and set the environment variables:
   - `DATABASE_URL` – the Postgres connection string
   - `ANTHROPIC_API_KEY` – a Claude API key
3. Deploy. The first request after deploy creates the tables and seeds the dataset from `data/seed/*.json.gz` (bundled with the functions; takes 20 to 60 seconds on a hosted database, only once). To seed ahead of time instead, run `DATABASE_URL=... npm run db:seed` from your machine.

Serverless functions have a 300 second limit configured for the chat route (`maxDuration`); adjust for your plan if needed.

## Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables Claude. Without it the app runs in demo mode with scripted answers. |
| `ANTHROPIC_WORKSPACE_ID` | Only for organisation-level keys not scoped to a workspace; the API otherwise rejects requests asking for the `anthropic-workspace-id` header. |
| `DATABASE_URL` | Postgres connection. Empty means embedded PGlite (local only). |
| `CLAUDE_MODEL` | Defaults to `claude-opus-5-5`. |
| `CLAUDE_EFFORT` | `low`, `medium` (default), `high`, `xhigh`, `max`. |
| `CLAUDE_FALLBACKS` | Server-side refusal fallbacks are on by default; set `0` to disable. |
| `MOCK_LLM` | Set `1` to force demo mode. |

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
src/lib/brands.ts     brand context and the validated categorical palette
src/components/       workspace UI (chat panel, proposal cards, grid canvas, charts, editor)
src/app/api/          dashboards, chat (NDJSON stream), widget data, status
```

## Rebuilding the dataset

Put the four CSV exports in a folder as `segments.csv`, `posts.csv`, `comments.csv`, `influencers.csv` and run:

```bash
python3 -I scripts/build_seed.py /path/to/csvs
```

Then bump `SEED_VERSION` in `src/lib/schema.ts` so existing databases reload, or drop the four data tables.
