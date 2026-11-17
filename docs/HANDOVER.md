# Handover: Social Influence

Read this first in a new session. It says what the project is, where things stand, what to do next and how to work in this repository without repeating earlier mistakes.

## 1. What this is

Social Influence is a Next.js proof of concept. Brand teams chat with an AI analyst over social-listening data (creator posts and audience comments) and build dashboards from the answers. The business model is a monthly platform fee plus billed AI usage.

- Repository: `caras-new-voices/social-influence-2-0`
- Production branch (Vercel deploys it): `claude/focused-wright-5lrrcp`
- Development branch used so far: `claude/confident-archimedes-b24knu`. A new session is given its own branch name; use that one.
- Everything described below is merged to production (pull requests 1 to 9, the last one being this file).

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
- **Four templates:** Starter, Eran's, Tom's Default Template, and "Toms No Hash".
- **Elements open at full width**, with charts and tables one row taller than their template size.

Not done, in order of importance:

1. **Model classification of posts has not run** (section 5). This is the next task.
2. **Accuracy of the word rules is unmeasured.** Only coverage is known.
3. **Tom has not reviewed** his template's numbers or the draft theme lists.
4. **The live site's AI key is unconfirmed.** The app reads `OPEN_AI_2` first. It must be set in Vercel's environment variables, not only in the Claude environment.
5. **Captions for the nine new industries are cut at 600 characters.**

## 4. The data

- **Live industry:** hair removal and shaving (6 brands, 6,168 posts, 31,688 comments with AI comment analysis, October 2025 to August 2026). It is the only industry with comments and several months.
- **Nine snapshot industries**, posts only, one month each: electric vehicles, Caribbean tourism, premium fashion, enterprise technology, sleep technology, hair care, spirits, NFL New York, the Israel conversation. 71,378 posts.
- Each new brand is a **random sample of up to 1,000 posts**. Share of voice between large brands is therefore flat.
- Seed files are in `data/seed/` (25 MB): the base dataset, `catalog.json` (industry and brand descriptions), `packs/` (one file per snapshot industry), `themes.json` (theme and hook rules).
- **The raw exports are not in the repository.** They came from a Google Drive folder the owner shared (nine `.tar.gz` files, one per industry, with `<month>/<Brand>.csv` inside). They are only needed to rebuild the packs, for example with longer captions. Ask the owner for the folder link again if needed; download with `curl` from `drive.usercontent.google.com/download?id=<file id>&export=download&confirm=t`.
- Some tracked posts are off-topic (a car post filed under a tourism destination). This comes from how the exports matched posts to brands.

## 5. Next task: run the model classifier

"Toms No Hash" gives every post themes and hooks. Today they come from word rules (`data/seed/themes.json`, applied by `src/lib/themes.ts`). The better version, already written, asks a language model.

Steps:

1. Confirm the key is visible: `env | grep -c OPEN_AI_2` should print 1. An earlier key (`OPENAI_API_KEY`) is valid but has no credit.
2. Pilot on a small sample and read the answers:

```bash
python3 -I scripts/classify_posts.py /tmp/labels-work --industry hair-care --limit 200 --workers 5
```

3. Check the token counts the script prints, estimate the full run (about 77,000 posts, 20 per request), and tell the owner before spending on the full run if it is large.
4. Run everything, then compile:

```bash
python3 -I scripts/classify_posts.py /tmp/labels-work --workers 8
```

```bash
python3 -I scripts/classify_posts.py /tmp/labels-work --compile
```

5. The compile step writes `data/seed/labels/<industry>.json.gz`. The app loads these in place of the word rules on the next start. With them, "Toms No Hash" counts theme shares on the primary theme, leaves out posts judged not about the brand, and shows a new element on how much of each brand's conversation is really about it.
6. Verify: restart the app, run `npm run check:scope`, run the rotation for `tomnohash` (section 7), look at a dashboard in a browser, then build and merge.
7. Measure accuracy: label about 150 posts per industry by hand (or review the model's answers) and report how often the theme is right. This has never been done.

The script uses the model `gpt-5.4-mini` by default (`--model` changes it). It was written but never run against a live key, so expect to fix small things in the request format.

Background: `docs/toms-template-themes-plan.md` (the plan and what was built) and `docs/theme-lists-draft.md` (the theme lists, for Tom to edit).

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
- **Commit finished work only.** Do not commit a background agent's half-written files. The stop hook asks for commits; commit to the development branch, never straight to production.

## 9. Open questions for the owner

- Should the nine industries be reloaded with more than 1,000 posts per brand, and with full captions? It fixes the flat share of voice and gives the classifier more to read.
- Should the extra element height apply to charts only? Short tables look emptier in taller cards.
- A dashboard has one "your company" brand. A company that owns several brands in an industry cannot yet combine them.
- `data/seed/workspace.json` is unused and can be deleted. A safety check blocked its removal earlier.
