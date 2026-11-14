# Plan: "Tom's Default Template"

Status: proposal, nothing built yet.

Source: Tom's document "Social intelligence: from conversation to content, creators and product" (7 Nov 2026). It defines five questions, three lenses (Me, Competitors, Culture), eight measures calculated the same way every month, the sub-questions under each question, and the product priority grid. This plan turns that into a dashboard template on the current dataset, and says plainly where the dataset falls short of the document.

## 1. What the template is

A template in `src/lib/templates.ts`, selectable from the New dashboard dialog next to Default and Eran's, named **Tom's Default Template**. It opens with Tom's eight measures as the headline, then one section per question in his order, each element answering one sub-question with the measure he names. Every element follows the period bar and comparison like any other, so "the next month's read shows whether it moved" is the existing period and compare machinery, not new code.

The two lenses that the data supports, **Me** and **Competitors**, are built into every element (the focal brand versus the category and versus each named rival). The **Culture** lens needs a culture query (a Boolean beyond brand mentions) that the dataset does not contain; those sub-questions are listed as out of scope below rather than faked.

## 2. The eight measures on this dataset

Tom's measures are definitions, not columns. Each becomes a reusable SQL building block (a CTE or a view) in a new `src/lib/measures.ts`, used by every element so the numbers are calculated one way.

| Measure | Tom's definition | How it is computed here | Fidelity |
|---|---|---|---|
| Share of voice | Brand posts ÷ category posts; also by views, creators, engagements | `posts` grouped by brand over the six tracked brands (the category = all tracked brands); four variants | Direct |
| Engagement vs norm | Actual engagements ÷ expected; expected = views (followers for Instagram image posts) × the category's engagement rate for that platform and creator size; above 1.2 = outperforming | A `norms` CTE: category engagement rate per platform × tier from `posts_all` (engagement ÷ views; Instagram image: engagement ÷ followers). Per post: engagement ÷ (base × rate). Aggregated as the engagement-weighted mean | Direct; the "category" is the six brands, not the wider category |
| Momentum | Posts in the last 3 months ÷ the 3 months before, minus 1 | Current period versus the previous period of the same length using `period_start()`/`period_end()`; all-time view = last 90 days versus the 90 before, which matches Tom's 3-month rule | Direct |
| Earned share | Posts neither brand-owned nor disclosed paid ÷ all brand posts | Posts with `is_paid` false ÷ all. The dataset has no brand-owned flag; brand handles are not separated from creators | Approximation, labelled |
| Purchase intent | Buying-signal comments per 1,000 comments, against the category | `purchase_intent_type IS NOT NULL` per 1,000 comments, brand versus category | Direct |
| Praise and objections | Positive and negative comments per 1,000 by attribute (price, efficacy, ease, durability, safety, service) | Objections: `objection_category` per 1,000 (quality, price, availability, trust, comparison, ethics, ingredients, fit). Praise: positive comments by `topics` tag per 1,000. The attribute set is the dataset's, mapped to Tom's names where they coincide (price = price, quality ≈ efficacy and durability, safety ≈ safety complaints) | Close; attribute vocabulary differs |
| Content gap | A topic's share of comments minus its share of posts | Comments carry `topics`; posts do not. A post's theme = the dominant topic across its comments (a `post_themes` CTE), then comment share minus post share per topic | Approximation; a true post-theme classifier is a data-pipeline item (section 6) |
| Creator score | Engagement vs norm, theme fit, audience match, purchase intent on their posts | Per creator: engagement vs norm across 2+ posts, share of their posts in the theme, purchase-intent rate in their comments, and audience match from `influencers.audience_countries` and `audience_ages` where present (about 540 creators have audience data) | Close; audience match is partial |

Minimum samples (30 posts per theme, 200 comments behind any comment measure) are applied as `HAVING` clauses so small cells drop out rather than mislead.

**Themes.** Tom's unit is the theme. The dataset tags comments (`topics`), not posts, so the template's theme is the dominant comment topic on a post. That gives usable themes (praise, price, availability, skincare, routine, and so on) but they are consumer themes, not content themes like "tutorial" or "night routine". The plan treats this as the main data gap (section 6).

## 3. The sections and their elements

Element counts are in brackets. "Lens" says which of Tom's lenses the element serves.

### Headline: the eight numbers [2]

- KPI row, focal brand: share of voice, engagement vs norm, momentum, earned share, purchase intent per 1,000, praise per 1,000, objections per 1,000, biggest content gap. Each tile compares with the previous period (the existing KPI compare column).
- Table, the same eight for every brand, so the rival read is one glance. Lens: Me, Competitors.

### 1. Which conversations are winning? [6]

| Sub-question (Tom) | Element | Lens |
|---|---|---|
| Which themes are growing fastest and performing best? | Table: theme, posts, momentum, engagement vs norm, flag Winning (growing and above 1.2) | Me, Competitors |
| Which are early signals, which are peaking? | Table: themes with engagement above 1.5 and momentum under 20% (early), and fast growth with engagement under 1 (peaking) | Category |
| Which conversations sell, not just engage? | Bar: themes ranked by engagement vs norm × purchase intent per 1,000 | Me, Competitors |
| Where are we missing from winning themes? | Bar: our share in each winning theme minus our overall share, in points | Me vs competitors |
| Which formats and hooks win in each theme? | Stacked bar: engagement vs norm by platform × post type (video, image). Hooks (tutorial, review, unboxing) need video transcripts the dataset does not have | All (partial) |
| What spiked, and why? | Table: brand-months at 2× the 3-month average, the top post behind it, paid or organic | Competitors |
| Which markets lead? | Bar: momentum by creator country, top 8 | All |

Culture lens: out of scope (needs a culture query).

### 2. Where is the white space? [5]

| Sub-question | Element | Fidelity |
|---|---|---|
| What does the audience reward that no brand owns? | Table: themes with engagement vs norm ≥ 1.2, 30+ posts, and no brand above 25% share | Direct |
| What do consumers ask about that creators don't cover? | Bar: content gap by topic (comment share minus post share), top 12 | Approximation (post themes) |
| Which questions go unanswered? | Table: question comments with no reply, by topic, with the most-liked example | Direct (`faq_topic`, `reply_count`) |
| Which benefits does nobody claim? | Table: topic praise rate in comments against its share of posts; rarely claimed, often praised = lead with it | Approximation |
| Which audiences are under-served? | Bar: comments per creator by creator country (demand high, creators few). Age and gender need audience data that is sparse | Partial |
| Which platforms are under-served? | Stacked bar: theme share by platform, focal brand versus category | Direct |
| Which culture is open to us? | Out of scope | |

Output per Tom ("own it" list): the first table carries proof (engagement), who is absent (brand shares) and leaves the brief to the analyst.

### 3. What do people say about us, our rivals and our products? [7]

| Sub-question | Element |
|---|---|
| What do people love and hate? | Stacked bar: positive and negative comments per 1,000 by attribute, focal brand versus category |
| Which objections matter most? | Table: objection category, count × likes (weighted), the most-liked comment |
| Where are they weak and we strong? | Table: objection rate per 1,000, rival minus ours, attribute by attribute, one column per competitor |
| Who switches to whom? | Table: competitor mentions with `competitor_favored` and mention type (preference, comparison) as flows between brands; "switched from" language from `competitor_mention_type` |
| What stops people buying? | Table: buying comments with a condition (`purchase_blocker`), grouped, with examples |
| What should the copy say? | Table: the most-liked positive comment per attribute, verbatim |
| Are we saying what people value? | Table: benefits creators mention in captions (caption keyword match on the attribute vocabulary) against attributes consumers praise |

The paid-audience block in Tom's document (demographics, interest sets, lookalikes, partnership ads) is an output of the insight, not a dashboard element; the creator table in section 4 carries the audience columns that feed it.

### 4. Which creators win in each conversation? [6]

| Sub-question | Element |
|---|---|
| Who drives each theme? | Table: per theme, top creators by share of the theme's views and engagement vs norm over 2+ posts |
| Who drives buying? | Table: creators ranked by purchase-intent rate in their comments against the category |
| Who is credible on the topic? | Columns in the theme table: theme fit (share of their posts in it), months active, comment tone |
| Who works with competitors? | Table: creators by brand: exclusive, shared, and rivals' best performers |
| Who reaches our buyer? | Table: audience match from `influencers` (top audience country share, age band, gender split) where present |
| Does performance hold when paid? | Table: engagement vs norm on paid posts versus the creator's organic posts |
| Who is good value? | Table: modelled cost per 1,000 views and per 100 engagements from `budget_min`/`budget_max`, by tier |
| Who is rising? | Table: creators whose views grow period on period with engagement vs norm above 1.5 |
| Who leads a culture we want to enter? | Out of scope |

Output per Tom: a top 10 per theme, product and competitor, scored. The template delivers the per-theme and per-competitor tables; "per product" needs product tagging (section 6).

### 5. What should we build or fix? [7]

| Sub-question | Element |
|---|---|
| What do people wish existed? | Table: feature requests by type with the most-liked verbatims |
| What is breaking, and is it getting worse? | Line: objection categories by month with momentum flagged |
| How do people actually use it? | Table: use cases (`use_case`, `use_case_segment`) with counts and examples |
| What should we fix, protect or start talking about? | **Product priority grid**: a table of attributes placed by mentions per 1,000 and net sentiment into Tom's four boxes (fix first, protect, start talking about, ignore). Rendered as a sortable table with the box as a column; a true 2×2 scatter is a new chart type (section 6) |
| Where are competitor products weak? | The same grid per competitor, one table with a brand column |
| How do people judge price and value? | Table: price objections against "worth it" praise, with the comparisons they make |
| Which variants do people want? | Bar: feature requests of type variant, size, colour, format |
| How did a launch land? | Out of scope: no launch dates in the dataset |
| What should we make next? | Partial: emerging use-case segments across the category (from Eran's template) |

### Closing: the monthly read [1]

- Insight element: the precomputed strategy insight for the focal brand, plus a note pointing to the Reports page where the month-in-review and the eight measures per month live.

Total: about 34 elements in 7 sections, the same size as Eran's template.

## 4. Work plan

| Phase | Scope | Estimate |
|---|---|---|
| A. Measures | `src/lib/measures.ts`: the norms CTE, post-theme CTE, the eight measures as reusable SQL fragments, with a script that runs each against the seeded dataset and prints the focal-brand values for a sanity read (share of voice should match the dataset page; engagement vs norm should average about 1.0 across the category) | 1.5 days |
| B. Template | `TOM_SECTIONS` in `src/lib/templates.ts` using the fragments, registered as `tom` in `TEMPLATES`; every element verified to return rows in all-time and single-month modes, with and without comparison | 2 days |
| C. Grid and polish | Priority-grid table with box labels; a `segmented` or small-multiples option for the "love and hate" element if the stacked bar is too dense; subtitles that state each approximation in one line | 1 day |
| D. Analyst awareness | The dataset doc tells the analyst the eight measures exist as named fragments ("engagement vs norm" has a definition it should reuse, not reinvent); the wizard's step definitions can later reuse the same fragments | 0.5 day |

About five working days. Phases A and B are the substance; C and D are small.

## 5. Decisions to take before building

- **The category.** Tom's norms are category-wide. Here the category is the six tracked brands. Fine for a proof of concept; say so on the headline tiles.
- **Theme definition.** Dominant comment topic per post, or wait for a post-level theme classifier? Recommendation: build on comment topics now, with the subtitle stating it, and swap the CTE when post themes arrive.
- **Attribute vocabulary.** Keep the dataset's objection categories or remap to Tom's six attributes (price, efficacy, ease, durability, safety, service)? Recommendation: keep the dataset's, show Tom's name in brackets where they coincide; a remap table is a one-line change later.
- **Earned share.** Without a brand-owned flag it is "organic share". Label it that way until the brand handles are identified (a list of official accounts per brand would fix it in an hour).
- **Minimum samples.** Tom's 30 posts and 200 comments thresholds drop a lot of cells in a single month for the smaller brands. Recommendation: apply them in all-time and range views, relax to 10 and 50 in a single-month view, and say which applies in the subtitle.

## 6. Data gaps this exposes (for the pipeline, not the template)

- **Post-level themes and hooks** (tutorial, review, unboxing, routine): needs caption and transcript classification. Tom's document assumes transcripts and visual tagging; the dataset has captions only.
- **Product tagging** on posts and comments (which product the conversation is about): needed for "per product" everywhere in sections 3 to 5.
- **Brand-owned handles** per brand: needed for earned share as defined.
- **Audience demographics** on more creators (about 540 of 3,332 have them): needed for audience match and under-served audiences by age and gender.
- **Culture queries**: a separate dataset per culture; the Culture lens and its three sub-questions wait for it.
- **Launch dates**: a small table of launches per brand would unlock the launch read.
- **A 2×2 chart type** for the priority grid and the early/peaking map; not needed for the first version.
