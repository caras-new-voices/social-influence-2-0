# Handover: Social Influence

Read this first in a new session. It says what the project is, where things stand, what to do next and how to work in this repository without repeating earlier mistakes.

## 1. What this is

Social Influence is a Next.js proof of concept. Brand teams chat with an AI analyst over social-listening data (creator posts and audience comments) and build dashboards from the answers. The business model is a monthly platform fee plus billed AI usage.

- Repository: `caras-new-voices/social-influence-2-0`
- Production branch (Vercel deploys it): `claude/focused-wright-5lrrcp`
- Development branch used so far: `claude/confident-archimedes-b24knu`. A new session is given its own branch name; use that one.
- Everything described below is merged to production (pull requests 1 to 10; 10 added the model labels).

## 2. How the owner wants to work

- **Merge to production when the work is done and verified.** Do not ask whether to watch a pull request. Open it, merge it, report.
- **Plan first only when asked.** "Make a plan" means write the plan and stop. "Build it" means build, test, merge.
- **Go with your recommendations** when a decision is open, and say which you took.
- **Writing style for anything the owner reads:** lead with the outcome, short plain sentences, no em-dashes, no jargon. Say plainly what was not verified.
- **No tables in text meant to be copied and pasted** (emails, messages to colleagues). Use lists.
- People who come up: **Tom** (author of the five-question framework behind "Tom's Default Template") and **Eran** (author of the eight questions behind "Eran's template").

## 3. Where things stand

Built and live:

- **Dashboards with an AI analyst.** Chat proposes elements; an element is saved read-only SQL plus a rendering recipe.
- **Global time period** per dashboard, period comparison, monthly reports, new-data notifications.
- **Guided setup** (a wizard of questions) and a simplified New dashboard dialog.
- **Token usage:** every AI call is metered, with a balance, a demo top-up and a usage page.
- **Brand selection:** each dashboard looks at one industry, one "your company" brand and chosen competitors. Ten industries, 93 brands.
- **The default dashboard is "Tom's 8, Nov 8th"** (`src/lib/tom8.ts`), built to Tom's brief: eight measures, five questions, a written answer at the top of each section. New dashboard is now "pick your brands, name it". Guided setup and Blank are under "More ways to start". The earlier templates (Starter, Eran's, Tom's Default, Toms No Hash) still build but are no longer offered. See `docs/toms-feedback-plan.md`, `docs/brief-audit.md` and `docs/quality-gate.md`.
- **Corrected data.** Three things the supplied data gets wrong are fixed when the app starts (`applyFlags` in `src/lib/themes.ts`), from files made by `scripts/classify_flags.py`:
  - Paid, gifted and brand-owned posts: `is_paid` is a disclosure in the caption or, when the caption says nothing, the supplied flag (`paid_basis` says which); `is_affiliate` (TikTok Shop and commission posts), `is_gifted` and `is_owned` are new. A post is at most one of paid, affiliate and gifted, and what the caption says wins over the bare flag. Brand-owned accounts are in `data/seed/catalog.json` ("handles"), drafted by `scripts/make_brand_accounts.py`; the list for a person to confirm is `docs/brand-accounts-draft.md`.
  - Posts judged not to be about their brand are left out of the `posts` and `posts_all` views.
  - Every comment has `about` (brand, category, creator, other, noise), `attribute` (Tom's six) and `buying`. Comment measures read `brand_comments` / `brand_comments_all`, not `comments`.
- **`npm run check:numbers`** recomputes the default dashboard's headline numbers from the raw files, independently of the app's SQL, and compares them with a running app (`--base <url>` to point it at the live site). Run it after any change to a measure.
- **The quality gate.** Before a build goes to Tom, fill in `docs/quality-gate.md`: the brief audit, a walk-through as a client, and `npm run check:accuracy` (needs the app running and an OpenAI key; writes `docs/accuracy-report.md`).
- **Chat sessions:** New chat, a history of earlier chats per dashboard, rename and delete, a panel that can be widened or hidden, and a pinned list on very wide screens. See `docs/chat-sessions-plan.md`. `npm run check:sessions` tests it.
- **An "i" on every element** (`src/components/WidgetInfo.tsx`): what it shows (its subtitle), why it matters (its rationale), the kind of each number (count, share, rate), the period, and buttons to ask the analyst or change the element in the chat. Template elements and AI proposals all carry a subtitle and rationale; keep it that way for new ones.
- **Elements open at full width**, with charts and tables one row taller than their template size.

Not done, in order of importance:

1. **Tom has not reviewed** his template's numbers or the draft theme lists.
2. **No person has checked the model labels.** They agree with a stronger model 80% of the time on the theme (section 5).
3. **New imports are not classified by the model.** Posts from a later import fall back to the word rules.
4. **The live site's AI key is unconfirmed.** The app reads `OPEN_AI_2` first. It must be set in Vercel's environment variables, not only in the Claude environment.
5. **Captions for the nine new industries are cut at 600 characters.**

## 4. The data

- **Live industry:** hair removal and shaving (6 brands, 6,168 posts, 31,688 comments with AI comment analysis, October 2025 to August 2026). It is the only industry with comments and several months.
- **Nine snapshot industries**, posts only, one month each: electric vehicles, Caribbean tourism, premium fashion, enterprise technology, sleep technology, hair care, spirits, NFL New York, the Israel conversation. 71,378 posts.
- Each new brand is a **random sample of up to 1,000 posts**. Share of voice between large brands is therefore flat.
- Seed files are in `data/seed/` (25 MB): the base dataset, `catalog.json` (industry and brand descriptions), `packs/` (one file per snapshot industry), `themes.json` (theme and hook rules).
- **The raw exports are not in the repository.** They came from a Google Drive folder the owner shared (nine `.tar.gz` files, one per industry, with `<month>/<Brand>.csv` inside). They are only needed to rebuild the packs, for example with longer captions. Ask the owner for the folder link again if needed; download with `curl` from `drive.usercontent.google.com/download?id=<file id>&export=download&confirm=t`.
- Some tracked posts are off-topic (a car post filed under a tourism destination). This comes from how the exports matched posts to brands.

## 5. Model labels for posts (done)

Every post in all ten industries has a model label: a primary theme, up to two secondary themes, a hook and whether the post is really about the brand. The labels are in `data/seed/labels/<industry>.json.gz` and the app loads them in place of the word rules on start. "Toms No Hash" counts theme shares on the primary theme, leaves out posts judged not about the brand, and shows how much of each brand's conversation is really about it.

- Run in November 2026 with gpt-5.4-mini: about 10.9 million input and 4.4 million output tokens, roughly $25 at the price we assumed.
- Accuracy, judged by gpt-5.5 on 150 random posts per industry: the primary theme is accepted 80% of the time (73% to 87% by industry), and "about the brand" agrees 93% of the time. Only 48% of the themes the old word rules attach are accepted. Details in `docs/toms-template-themes-plan.md`, section 12.
- In a Claude cloud session the OpenAI key may be supplied by the environment for every call to api.openai.com, even when `OPEN_AI_2` is not set. Test with one small request before concluding there is no key.

To label again, for example after Tom edits a theme list (delete that industry's `.jsonl` in the work folder first, or use a new folder):

```bash
python3 -I scripts/classify_posts.py /tmp/labels-work --industry spirits --workers 8
```

```bash
python3 -I scripts/classify_posts.py /tmp/labels-work --compile
```

Compile only writes an industry when at least 98% of its posts are labelled. Run the first command a second time to fill gaps left by failed requests. To measure accuracy:

```bash
python3 -I scripts/review_labels.py /tmp/labels-work --per 150
```

Background: `docs/toms-template-themes-plan.md` (the plan, what was built and the results) and `docs/theme-lists-draft.md` (the theme lists, for Tom to edit).

## 6. How the code is organised

Stack: Next.js 16 (Turbopack), React 19, TypeScript, Postgres through `pg` when `DATABASE_URL` is set, embedded PGlite (`data/pglite`) locally. Read `AGENTS.md` before using a Next.js API you are unsure of: this version differs from older ones.

Key ideas:

- **Raw tables and scoped views.** The data lives in `posts_raw`, `comments_raw`, `influencers_raw`, `segments_raw`, `post_labels_raw`. Queries read views: `posts_all`, `comments_all`, `influencers`, `segments`, `post_themes`, `post_hooks`, `post_about` keep to a dashboard's brands; `posts` and `comments` add the period. The scope comes from two transaction-local settings, `app.brands` and `app.focal_brand`.
- **Scope per request.** A request that belongs to a dashboard runs inside `runInScope` (`src/lib/scope.ts`, AsyncLocalStorage). Reads go through `runWidgetQuery` or `readScoped` (`src/lib/query.ts`). Never read dataset tables with a plain `db.query` in request code.
- **No brand or industry words in code.** "Us" is `focal_brand()`, rivals are `is_competitor(brand)`. Names and descriptions live in `data/seed/catalog.json`.
- **Templates with conditions.** Sections and elements carry a `when` condition and are left out, with a note in the chat, when the brands lack the data.

Where things are:

- `src/lib/schema.ts`: tables, views, migrations, start-up (`ensureReady`), pack loading, statistics refresh. Bump `VIEWS_VERSION` when a view or a raw table's columns change.
- `src/lib/catalog.ts`: industries and brands, pack loader, scope validation.
- `src/lib/scope.ts`, `src/lib/scope-shared.ts`: the brand scope.
- `src/lib/themes.ts`: themes and hooks (word rules and model labels). The rules file `data/seed/themes.json` is generated by `scripts/make_themes.py`: edit the script, run it, commit both.
- `src/lib/claude.ts`: the analyst (Claude or OpenAI, or scripted demo mode), token metering.
- `src/lib/openai-key.ts`: the one place the OpenAI key is read.
- `src/lib/templates.ts`, `starter.ts`, `tom.ts`, `template-build.ts`, `template-check.ts`: the templates and their test.
- `src/lib/wizard.ts`: guided setup. `src/lib/usage.ts`: token usage. `src/lib/reports.ts`: month reviews.
- `src/components/BrandPicker.tsx`, `Workspace.tsx`, `ChatPanel.tsx`, `OnboardingWizard.tsx`, `DashboardList.tsx`: the main screens.
- `docs/`: one plan per feature, each with an "As built" section.

## 7. Running and checking

Start in demo mode (no AI key needed):

```bash
MOCK_LLM=1 npx next dev -p 3000
```

The first start on a fresh database loads the packs and classifies posts. Set `PACK_LOAD_BUDGET_MS=600000` to let it finish in one go locally.

Checks, all against a running app:

```bash
npm run check:scope
```

```bash
npm run check:usage
```

```bash
npm run check:verticals
```

```bash
npm run check:templates -- starter
```

For the larger templates, run the rotation one industry at a time, because all industries at once outlasts the request timeout:

```bash
curl -s -m 2400 "localhost:3000/api/templates/check?template=tomnohash&industry=spirits&months=0"
```

Template ids: `starter`, `eran`, `tom`, `tomnohash`. Industry ids: `hair-removal`, `ev-europe`, `caribbean-tourism`, `premium-fashion`, `enterprise-tech`, `sleep-tech`, `hair-care`, `spirits`, `nfl-new-york`, `nation-brand`.

Before every push:

```bash
npx tsc --noEmit
```

```bash
npx eslint src scripts
```

Before every merge, stop the dev server, then:

```bash
npm run build
```

Remove the `.next` folder before starting the dev server again after a build.

## 8. Lessons already paid for

- **Never push a tree that does not build.** Vercel builds every push. Run the type check and lint before each push and the full build before each merge.
- **Stop the dev server before `next build`**, and delete `.next` after a build. A stale `.next` makes the dev server reload in a loop.
- **Do not edit files under `src/` while a long test is running against the dev server.** It recompiles mid-run and can stall or panic. Restart the server after changing library files if a route still behaves like the old code.
- **PGlite cannot cancel a slow query.** One bad query stalls the whole local server until it is restarted. Time new SQL on its own first.
- **Test migrations on real Postgres.** Postgres 16 is installed in the cloud container (`/usr/lib/postgresql/16/bin`, run as the `postgres` user). Query plans differ from PGlite: check slow elements there with `EXPLAIN ANALYZE`.
- **Single-row and small CTEs in template SQL need `AS MATERIALIZED`** when they are joined to something large. Without it Postgres can recompute them per row.
- **After bulk loads, statistics must be refreshed.** The app does this (`refreshStatistics` in `schema.ts`); keep it when adding tables.
- **The SQL guard rejects a semicolon anywhere in a query**, even inside a string, and rejects the raw table names. Template SQL goes through the same guard.
- **Table cells format whole numbers and decimals only.** Express percentages as numbers from 0 to 100 with a column name that says so.
- **Shell safety check:** a command that mixes a heredoc with odd text can be blocked as a possible file removal. Write patch scripts to the scratchpad with the file-writing tool, then run them.
- **A new secret is only visible in a new session.** That is why `OPEN_AI_2` could not be used in the session that wrote this.
- **To test the live analyst in a Claude cloud session**, start the app with `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. Without them Node calls OpenAI directly with the old `OPENAI_API_KEY`, which has no credit, and every question fails with "rate limiting (429)". `curl` and Python go through the environment's proxy, which supplies a working key.
- **New posts and comments are not corrected until the classifiers run on them.** After an import, run `scripts/classify_flags.py posts`, `comments`, `refine` and `compile`, then restart. Until then new comments count as brand comments and new posts rely on the caption rules alone.
- **A label the small model gives freely needs a stricter second pass.** The first comment pass gave an attribute to "need it!"; agreement with the reviewer was 58%. The `refine` pass with a stronger model took it to 87%. Measure before trusting.
- **Counts and rates:** name number columns so their unit is clear ("share of voice %", "vs norm", "per 1K comments"); tables format cells from the name. See `docs/counts-and-rates-plan.md`.
- **Commit finished work only.** Do not commit a background agent's half-written files. The stop hook asks for commits; commit to the development branch, never straight to production.

## 9. Open questions for the owner

- Should the nine industries be reloaded with more than 1,000 posts per brand, and with full captions? It fixes the flat share of voice and gives the classifier more to read.
- Should the extra element height apply to charts only? Short tables look emptier in taller cards.
- A dashboard has one "your company" brand. A company that owns several brands in an industry cannot yet combine them.
- `data/seed/workspace.json` is unused and can be deleted. A safety check blocked its removal earlier.
