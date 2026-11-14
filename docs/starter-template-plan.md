# Plan: a starter template that works for any brand

Status: built. Section 9 records what shipped.

## 1. What we are solving

We have three templates (Default, Eran's, and a plan for Tom's). All three were written against one dataset: Venus, razors, five named competitors. A starter template has a different job. It must give a useful first dashboard to a skincare brand, a consumer electronics brand, a snack brand or a retailer, on day one, with no one editing SQL, and it must still look right when the brand is small or the month is thin.

That turns into four requirements:

1. **No brand, category or product words in the template.** Not in SQL, titles, subtitles or the analyst's prompts.
2. **Only signals that are dense for every brand.** An element that is empty for a small brand makes the whole product look broken.
3. **Benchmarks that need no category knowledge.** Compare with the brand's own previous period and with its tracked competitors, never with a fixed threshold.
4. **Short.** A starter is a first screen, not a research programme. The depth lives in Eran's and Tom's templates and in the analyst.

## 2. What the data says about "works for any brand"

Measured on the current dataset, per brand, all time and in a single month (June 2026). The six brands range from 2,228 posts down to 24, which makes them a fair stand-in for clients of different sizes.

| Signal | Largest brand, one month | Smallest real brand, one month (Wilkinson Sword, 182 comments) | Verdict |
|---|---|---|---|
| Post metrics: engagement, creator tier, country, EMV | complete | complete | Core |
| Views | about 85% of posts | about 65% | Core, with engagement as the fallback |
| Comment sentiment | 99% of comments | 100% | Core |
| Purchase intent | 275 comments | 23 | Core |
| Loyalty signals | 167 | 13 | Core as verbatims, not as a chart |
| Unanswered questions | 154 | 11 | Core as verbatims |
| Objections (8 fixed categories) | 110 | 7 | Conditional |
| Sponsorship perception | 61 | 9 | Conditional |
| Competitors named in comments | 57 | 3 | Conditional |
| Feature requests | 16 | 3 | Conditional, all-time only |
| Safety complaints | 33 | 1 | Conditional, category-dependent |
| Purchase blockers, use cases, crisis flags | 2 to 14 | 0 to 2 | Not in the starter |
| Creator audience demographics | 539 of 3,332 creators | same | Not in the starter |

Two further findings shape the design:

- **Free-text fields cannot be charted.** Comment topics have 11,275 distinct values and the most common are reactions ("praise", "affection", "compliment"), not subjects. Question topics have 1,616 distinct values. Any "top topics" bar chart is noise for any brand. Free text belongs in verbatim tables, sorted by likes, where it is the most persuasive thing on the dashboard.
- **Fixed vocabularies travel.** Sentiment, purchase-intent stage, objection category, loyalty type, feature-request type, platform, post type and creator tier are the same set of values for every brand and category. Charts in the starter use only these.

## 3. Design principles

1. **The focal brand comes from the data, not the code.** The `segments` table already marks one brand `focal` and the rest `competitor`. Add two SQL functions next to `period_start()`: `focal_brand()` and `is_competitor(brand)`. Template SQL then reads `WHERE brand = focal_brand()`, identical for every client, and a dashboard can be duplicated or shared between workspaces without edits.
2. **Titles speak in the first person.** "Our share of voice", "What our audience says", "Creators already talking about us". No brand name to substitute, and it reads the way a client talks.
3. **Every number has a comparison.** KPI tiles compare with the previous period (already built). Rates are shown against the competitor average. Nothing depends on knowing what a good engagement rate is for razors versus laptops.
4. **Rates, not counts, across brands.** Per 1,000 comments, share of total, engagement per view. A brand ten times bigger must not look ten times better.
5. **Data-aware at creation.** Conditional sections are included only if the workspace's data passes a minimum (for example 50 objection comments all time). The check runs once when the dashboard is created, so a client never sees an empty section. A line in the chat says what was left out and why, and offers to add it later.
6. **Graceful empty states.** In a thin month an element says "Not enough comments this month (7 of 30 needed). Showing all time instead." with a one-click switch, instead of an empty chart.
7. **Twelve elements, five questions.** One screen and a half. Everything else is one question to the analyst away.

## 4. The starter template

Section titles are the questions a new client asks in their first meeting. Element sizes are in grid columns.

### 1. How are we doing? (always)

| Element | Type | What it shows |
|---|---|---|
| Our month at a glance | KPI row (12) | Posts, creators, engagement, views, engagement per view, purchase-intent comments per 1,000. Each versus the previous period. |
| Share of voice | Bar (5) | Posts per tracked brand, ours highlighted. Table view switches to views and engagement. |
| Engagement over time | Line (7) | Monthly engagement, us against each competitor. |

### 2. What is working? (always)

| Element | Type | What it shows |
|---|---|---|
| Where our content lands | Bar (5) | Engagement per 1,000 views by platform and format (falls back to engagement per post where views are missing). |
| Creators driving our conversation | Table (7) | Creator, platform, size, posts, engagement, views, paid or organic. Links to the creator page. |
| Our top posts | Table (12) | The posts with the most engagement: creator, caption, format, numbers, link. |

### 3. What does our audience say? (always)

| Element | Type | What it shows |
|---|---|---|
| Sentiment, us versus competitors | Stacked bar, 100% (6) | Positive, neutral, negative share of comments per brand. |
| Intent to buy, us versus competitors | Bar (6) | Buying-intent comments per 1,000 comments per brand. |
| In their own words | Table (12) | The most-liked comments, labelled praise, question, objection or buying intent. Filterable by label. |

### 4. What should we do next? (always, with conditional elements)

| Element | Type | Condition |
|---|---|---|
| Questions nobody answered | Table (6) | Always. Most-liked question comments with no reply, and where they were asked. |
| Creators already talking about us | Table (6) | Always. Never-paid creators ranked by engagement: the partnership shortlist. |
| What they push back on | Bar (6) | 50+ objection comments all time. Objection categories, us against the competitor average, per 1,000. |
| What they ask us to make | Table (6) | 30+ feature requests all time. Request type and the most-liked verbatims. |

### 5. What changed? (always)

| Element | Type | What it shows |
|---|---|---|
| Rising and falling creators | Table (12) | Engagement by creator, this period versus the one before (already built as a "What changed" element). |

### Conditional sections, added only when the data supports them

- **Risk and safety**: 40+ safety complaints or crisis flags all time. Monthly trend and the complaints verbatim. Relevant to personal care, food, health and children's products; absent for most others.
- **How sponsorships land**: 20+ paid posts. Engagement and sentiment on paid versus organic posts, and sponsorship perception.
- **Strategy insight**: when the precomputed insight exists for the focal brand.

That is twelve elements for every client and up to seventeen for a large one.

## 5. Making the rest of the product brand-neutral

The template is only universal if the product around it is. The current code names the brand in seven files; all of it moves to a workspace configuration read from the `segments` table (focal brand, competitors, category label) plus an optional list of brand aliases.

| Where | Today | Change |
|---|---|---|
| `src/lib/brands.ts` | Six brands and colours hardcoded | Load from `segments`; assign colours from the validated palette in a stable order, focal brand keeps the primary purple |
| `src/lib/templates.ts`, `wizard.ts`, `reports.ts` | `brand = 'Venus'` interpolated; `NOT ILIKE '%gil%ette%'` to drop self-mentions | `focal_brand()`; self-mention filter driven by the alias list |
| `src/lib/widgets.ts` | Default catalogue, starter questions and goal prompts name Venus and Estrid | First-person wording; competitor names injected from the configuration where a name is needed |
| `src/lib/schema-doc.ts`, `claude.ts`, `voice.ts` | Analyst prompt states the brand, the company, the category and row counts | Built from the configuration and live coverage |
| `DashboardList.tsx`, `Shell.tsx`, `ChatPanel.tsx`, `data/page.tsx` | "Social influence for Venus", "P&G Venus", "female hair removal" | Brand and category from the configuration |

## 6. How we prove it works across brands

"Works for any brand" becomes a test, not a claim.

- **Rotation test** (`npm run check:templates`): for each of the six brands in turn, mark it focal, build the starter, and run every element in all-time and in each single month. An element passes if it returns rows or its designed empty state. Mercadona (24 posts, 254 comments) is the stress case; the conditional sections must drop out for it and the core must still render.
- **Neutrality check**: a scan of the built dashboard's SQL, titles and subtitles for any brand, competitor or category word. Zero allowed.
- **Second dataset**: before calling it done, load one export from a different category (electronics or food) through the import path and run the same rotation. This is the only real proof; the plan assumes IMAI can provide one export.
- **Thin-month check**: the smallest brand in its thinnest month must show the empty-state message with the all-time switch, never a blank chart.

## 7. Work plan

| Phase | Scope | Estimate |
|---|---|---|
| A. Workspace configuration | `focal_brand()` and `is_competitor()` SQL functions, configuration loaded from `segments`, alias list, dynamic colours, brand-neutral copy and prompts across the seven files | 2 days |
| B. Starter template | The twelve core elements and the conditional elements as first-person, vocabulary-only SQL; the data-aware builder that checks thresholds at creation and tells the analyst what was left out; registered as the first template and as the wizard's fallback | 2 days |
| C. Empty states | Minimum-sample metadata per element (`minRows`, `minComments`), the "showing all time instead" fallback and its message | 1 day |
| D. Proof | Rotation test script, neutrality scan, thin-month check; run on a second-category export when available | 1 day, plus the second dataset |

About six working days. Phase A is also the prerequisite for onboarding any second client, so it is not optional work.

## 8. Decisions to take before building

- **Does the starter replace "Default template"?** Recommendation: yes. One obvious starting point, with Eran's and Tom's as the deeper options. The current default's twelve elements overlap the starter almost entirely.
- **Focal brand per workspace or per dashboard?** Recommendation: per workspace (from the data) now; a per-dashboard override later for agencies that track several brands in one workspace.
- **What "competitors" means for benchmarks.** The competitor average is unweighted across tracked competitors with at least 30 posts in the period, so a tiny brand does not swing it. The threshold is editable in one place.
- **Vertical packs.** After the starter, optional add-on sections per category (personal care: safety and ingredients; electronics: features and durability; food: taste and availability; retail: delivery and service). They need category-specific attribute vocabularies from IMAI's enrichment, so they are a follow-up, not part of this work.
- **Topic normalisation.** A charted "what are they talking about" needs IMAI to map free-text topics to a controlled list per category. Until then the starter uses verbatims, which is the honest version.


## 9. As built

| Piece | Where |
|---|---|
| Workspace from the data: tracked brands, focal brand, colours, company, category, aliases | `src/lib/brands.ts` (registry), `src/lib/workspace.ts` (loads `segments` and `app_meta`), `data/seed/workspace.json` (company, category, aliases for the bundled dataset), `src/components/WorkspaceProvider.tsx` |
| SQL functions `focal_brand()`, `is_competitor(brand)`, `is_self_mention(text)` | `src/lib/schema.ts` |
| The starter template: 14 core elements in five questions, plus conditional elements and sections | `src/lib/starter.ts` |
| Data-aware builder and the chat note listing what was left out | `src/lib/template-build.ts`, `src/lib/dashboards.ts` |
| Thin-data state on elements (minimum sample, "Show all time instead") | `sample` on the widget spec, `src/app/api/widgets/data/route.ts`, `src/components/WidgetCard.tsx` |
| Rotation test | `src/lib/template-check.ts`, `GET /api/templates/check`, `npm run check:templates [-- eran]` |

Decisions taken: the starter replaces the Default template (`"default"` is still accepted by the API and maps to it); the focal brand is per workspace, read from the `segments` table; cross-brand rate charts include competitors with 100+ comments in the period.

Differences from the plan: the core is 14 elements, not 12 (the two "what should we do next" tables and the "what changed" table are all always on); performance by platform and format uses engagement per 1,000 followers reached, because views are missing for image posts; the verbatim table labels loyalty comments instead of generic praise, because the most-liked positive comments are usually about the creator, not the brand.

Result of the rotation test on the bundled dataset: all six brands as focal, 1,596 queries over all time and eleven months, no failing element and no brand or category word in the template. The three large brands get 19 elements, the mid-sized one 16, the two small ones 13. Eran's template passes the same test.

Not done: the second-category dataset (needs an export from IMAI), per-dashboard focal brand, vertical packs, and topic normalisation.
