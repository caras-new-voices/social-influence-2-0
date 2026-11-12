# Plan: time periods, new data, and period comparison

Status: proposal, nothing built yet.

## 1. What we are solving

Today a dashboard is a set of saved queries over one fixed dataset (posts Oct 2025 to Jul 2026, comments to Sep 2026). Four things are missing:

1. **A global notion of "which time period am I looking at"**, shown in one place and applied to every element.
2. **Month-by-month views and reports**, including splitting the data we already have into its ten months.
3. **New data arriving over time** (a new month of posts and comments), with a notification that a new period is available.
4. **Comparison**: this month versus last month, or any period versus any other period, element by element.

The constraint that shapes everything: every element is a saved SQL query, written by us, by the analyst, or by the client. Whatever we build must work for all three without asking anyone to rewrite queries.

## 2. Design decisions

### 2.1 Apply the period in the database, not in the SQL

Every widget query already runs inside a transaction that does `SET LOCAL statement_timeout` (`src/lib/db.ts`, both the Postgres and the PGlite path). We use the same mechanism to carry the period:

- Rename the physical tables `posts` and `comments` to `posts_all` and `comments_all`.
- Create views named `posts` and `comments` that filter by two transaction-local settings:

```sql
CREATE VIEW posts AS
SELECT * FROM posts_all
WHERE published_at >= coalesce(current_setting('app.period_start', true)::timestamptz, '-infinity')
  AND published_at <  coalesce(current_setting('app.period_end',   true)::timestamptz, 'infinity');
-- same for comments, filtered on the comment's own published_at
```

- `runWidgetQuery(sql, { period })` issues `SET LOCAL app.period_start = '...'` and `SET LOCAL app.period_end = '...'` before the query. No period set means "all time", so nothing changes for existing behaviour.

Consequences:

- Every saved query, including the templates, the analyst's proposals and anything the client wrote in the editor, becomes period-aware on day one. Nothing is rewritten.
- Queries that need to look outside the period (previous-period benchmarks, "first seen" dates, lifetime totals) use `posts_all` and `comments_all` explicitly. The analyst's system prompt is told this.
- `influencers` and `segments` are not time-series tables and stay unfiltered. Elements built only on them (creator profiles, the precomputed strategy insight) are labelled "not period-specific" in the UI.
- Comments are filtered by when the comment was written, not by the date of the post it sits on. "What people said in June" is the question a period answers. The posts table answers "what was published in June".
- The SQL guard already blocks `set session` and `set role`; it must also block any `SET`, `RESET` and `current_setting` writes from user SQL so a query cannot widen its own period. Reads of `current_setting('app.period_start')` are fine and useful (a widget can print its own window).

Alternative considered and rejected: `{{period_start}}` placeholders in SQL. It only works for queries that opt in, every template and every analyst proposal would need them, and client-written SQL would silently stay all-time.

### 2.2 The period is dashboard state with per-element overrides

Add to the dashboard record (`dashboards.period jsonb`):

```ts
interface PeriodState {
  mode: "all" | "month" | "range";
  start?: string;        // ISO date, inclusive
  end?: string;          // ISO date, exclusive
  compare?: { mode: "previous" | "same_last_year" | "custom"; start?: string; end?: string } | null;
}
```

Per element, an optional `period` field on `WidgetSpec`: `"inherit"` (default), `"all"` (ignore the global period, for lifetime KPIs), or a fixed `{start, end}` (a pinned "June 2026 only" chart kept next to a live one). The grid shows a small badge on anything that does not inherit.

The URL mirrors the state (`?period=2026-06&compare=prev`) so a view can be shared and so the monthly reports (section 5) are just links.

### 2.3 Period coverage comes from the data, never from a constant

A `coverage` query (already half-built in `dataset-stats.ts`) reports, per brand and per table: first and last date, rows per month, and which months are complete. A month is "complete" when the latest import's `covers_to` is at or past the end of that month (section 4). The header, the month picker, the analyst's dataset description and the notifications all read from this. The hardcoded period line in `schema-doc.ts` becomes a short dynamic suffix appended to the cached system prompt each turn.

## 3. The global period bar

A bar directly under the dashboard header, present on every dashboard:

```
[ ‹ ]  June 2026  [ › ]     Viewing 1 Jun to 30 Jun 2026 · 212 posts · 3,418 comments     [ Compare ▾ ]   [ All time ]
```

- **Month stepper**: previous and next month within coverage. Keyboard left and right.
- **Picker**: months as a grid (greyed if no data, dot if partial), plus a custom range with two date inputs and presets (last 30 days of data, last 90 days, quarter, all time).
- **Coverage line**: always states the exact window and the row counts inside it, so "you're viewing data from this time period to that time period" is never ambiguous. A partial month says "partial: data to 14 Jul".
- **Compare**: off, previous period, same period last year, custom. When on, the line reads "June 2026 vs May 2026".
- Changing the period re-fetches every data element (the client cache key becomes `sql + period`, today it is `sql` only), updates the chat context, and updates the URL. The choice is saved with the dashboard.

## 4. New data: ingestion, coverage and notifications

### 4.1 Imports

Today the dataset is a one-time seed (`data/seed`, `SEED_VERSION`). Replace it with incremental imports while keeping the seed for local setup:

- New table `imports (id, received_at, source, covers_from, covers_to, posts_added, comments_added, influencers_added, status, notes)`.
- `POST /api/imports` accepts the same four exports we get from IMAI social listening (segments, posts, comments, influencers) as JSON or CSV, or a pointer to a file in object storage for large drops. A CLI wrapper (`npm run import -- <dir>`) uses the same code.
- Loading is idempotent: upsert on `(segment_id, post_id)` and `(segment_id, comment_id)`; influencer profiles are replaced per brand; the segments row (precomputed insights) is replaced when a newer one arrives. Engagement and view counts on existing posts are updated, so a re-export of last month refreshes the numbers rather than duplicating rows.
- Every import writes its `covers_from` and `covers_to` (the export's own date range, not the min and max of the rows, because a quiet brand can have no rows in a covered week).

### 4.2 Detecting a new period

After each import, a `period_events` step compares coverage before and after:

- A month that was incomplete and is now complete emits `month_completed` (for example "July 2026 is complete").
- A month that had no data and now has some emits `month_started` (partial).
- A re-export that changed existing months emits `month_revised` with the delta in rows and engagement.

Events are stored in `period_events (id, kind, period_start, period_end, import_id, summary jsonb, created_at)`.

### 4.3 Notifications

Three channels, all driven by `period_events`:

1. **In app**: a bell in the header with unread events; each dashboard shows a banner "July 2026 data is in: 1,120 new posts, 5,300 comments. [View July] [Compare with June]". Read state per user once auth exists (today: per browser).
2. **In the chat**: the analyst posts a system-originated message into every dashboard's conversation: "A new month was added. Want a summary of what changed versus June?" with the two buttons. This is where the product earns the usage-based billing: the summary is an analyst turn.
3. **Outbound**: email digest (via the IMAI platform's existing mailer) and a webhook so the main IMAI app can show the same badge. Both optional per workspace.

Scheduling: on Vercel, imports are push-based (the exporter calls the endpoint) so no cron is needed for detection. A daily cron (`/api/cron/coverage`) still runs to catch a month closing on the calendar with no new import, which should produce a "July has no data yet" warning rather than silence.

### 4.4 Loading the existing dataset through this path

The current seed is re-imported as a single historical import with `covers_from = 2025-10-01`, `covers_to = 2026-09-06`. That makes ten complete months (Oct 2025 to Jul 2026) plus two partial months of comments, and the month picker is populated immediately.

## 5. Month-by-month views and reports

- **Monthly view** is just the dashboard with `period.mode = "month"`. No new element types needed.
- **Reports index** (`/dashboard/:id/reports`): one row per complete month with the dashboard's headline KPIs for that month and the delta versus the previous month, a status (complete, partial, revised), and a link that opens the dashboard at that month with compare set to previous. Generated from the data, so splitting the current ten months into reports is a view, not a batch job.
- **Month in review**: when a `month_completed` event fires, a background analyst run executes every element of the dashboard for the new month and the previous one, and writes a short summary (what grew, what fell, three notable verbatims, one suggested action) into `period_reports (dashboard_id, period_start, period_end, summary_md, created_at)`. The report page shows it at the top with "Regenerate" and "Ask about this". Billable as analyst usage.
- **Export**: the existing placeholder Export button gets a real target: the monthly report as PDF (rendered from the same page in headless Chromium) with the period and coverage printed in the header, so a shared report always says which window it covers.

## 6. Comparison

Comparison is implemented once in the data layer, not per element.

- When `compare` is set, `POST /api/widgets/data` runs the element's SQL twice, with the two periods, and returns `{ rows, compareRows }`. One round trip per element.
- Rendering per element type:
  - **KPI**: the existing `compare` column convention already draws deltas (the "vs benchmark" arrows). The compare run fills it when the query does not provide its own.
  - **Bar and stacked bar**: grouped bars, period A solid and period B hatched, same category order; a delta label on hover.
  - **Line**: both periods overlaid on a normalised x axis (day 1 to day N of the period, or month index for ranges), B dashed and desaturated.
  - **Table**: rows joined on the first text column, with `Δ` and `Δ%` columns added for every numeric column, sorted by absolute change by default. Rows only in one period are marked new or gone.
  - **Insight and text**: unchanged, flagged "not period-specific".
- **Explain the change**: the "Ask AI" action on an element in compare mode sends both result sets to the analyst and asks for the reasons behind the biggest movements, with proposals for follow-up elements. This is the comparison feature the client will actually use most.
- **What changed section**: a template section that only makes sense in compare mode (top risers and fallers across creators, topics, objections and questions). Proposed automatically by the analyst after a `month_completed` event.

## 7. Changes to the analyst

- System prompt gains: the current period and compare period (as text, per turn, outside the cached block), the rule that `posts` and `comments` are already filtered to the period, and that `posts_all` and `comments_all` exist for cross-period questions.
- New tool `set_period({ start, end, compare })` so "show me June versus May" changes the bar rather than producing a one-off chart. The person sees the bar move and can undo it.
- `propose_widget` gains the optional `period` field (inherit, all, or fixed) so the analyst can pin a benchmark element.
- The dataset description's period line becomes dynamic (from coverage) and the row counts in the chat intro ("6,168 creator posts") read from coverage too.

## 8. Work plan

| Phase | Scope | Touches | Estimate |
|---|---|---|---|
| 1. Period model | `posts_all`/`comments_all` plus filtered views, `SET LOCAL` in `runWidgetQuery`, guard updates, `dashboards.period`, cache key, period bar with month stepper, picker and coverage line, URL sync, per-element override badge, analyst prompt and `set_period` tool | `schema.ts`, `db.ts`, `query.ts`, `sql-guard.ts`, `dashboards.ts`, `Workspace.tsx`, `WidgetCard.tsx`, `claude.ts`, new `PeriodBar.tsx` | 3 to 4 days |
| 2. Comparison | Dual-run data API, grouped bar, overlaid line, delta table, KPI fill-in, "Explain the change", "What changed" section | `widgets/data/route.ts`, `Charts.tsx`, `WidgetBody.tsx`, `templates.ts`, `claude.ts` | 3 to 4 days |
| 3. Imports and notifications | `imports`, `period_events`, `POST /api/imports` and CLI, idempotent upserts, coverage diff, bell and banners, analyst nudge message, webhook and email hooks, daily coverage cron, re-import of the seed as a historical import | `schema.ts`, new `imports.ts`, new API routes, `Shell.tsx`, `ChatPanel.tsx`, `vercel.json` | 4 to 5 days |
| 4. Monthly reports | Reports index, month-in-review generation and storage, regenerate and ask actions, PDF export with the coverage header | new `reports` page and route, `period_reports`, `claude.ts` | 3 days |

Phases 1 and 2 are independent of new data and can ship on the current dataset. Phase 3 is the one that depends on IMAI's export format and on where the files will be delivered; that interface should be agreed before it starts.

## 9. Risks and open questions

- **Comment dating**: filtering comments by comment date means a June view of a May post shows only its June comments. That is the right answer for "what people said in June" but will surprise anyone expecting per-post totals. The coverage line and the analyst's wording must make this explicit.
- **Revisions of past months**: engagement counts keep growing after publication. A re-export changes last month's numbers; the `month_revised` event and a "revised on" note in reports handle this, but we should decide whether reports freeze at generation time or always show the live numbers (recommendation: live numbers, with the frozen summary text).
- **Precomputed insights**: the segment-level AI insights are computed by IMAI over the whole scan, not per month. Until IMAI delivers them per period, the strategy insight element stays all-time and is labelled as such.
- **Query performance on Postgres**: the views add a predicate to every query; `published_at` needs an index on both tables (none today). PGlite locally is fine at this size.
- **Guard hardening**: with period state carried in session settings, the SQL guard becomes security-relevant rather than cosmetic. It needs a small test suite before phase 1 ships.
- **Auth**: read state for notifications and "my dashboards" need users. Notifications in phase 3 can start per browser, but the plan assumes auth arrives with the hardening phase already agreed.
