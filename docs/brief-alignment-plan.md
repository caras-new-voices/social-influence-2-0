# Plan: closing the gaps to Tom's brief

Written 18 November 2026, after the default dashboard ("Tom's 8, Nov 8th") went live. It lists what the brief asks for that the dashboard did not yet do, in the order we are doing it.

## Phase 1: built

**1. Every answer per market.** The brief's first output is "3 to 5 themes per market".

- A market filter sits on the period bar. A market is the creator's country. A comment takes the market of its post.
- It works like the period: a setting in the database that the `posts_all` and `comments_all` views read, so no saved query changes. Every box, the comparison, the briefs and the AI analyst follow it.
- It is kept in the address (`?market=Germany`) and saved with the dashboard.
- Markets with fewer than 30 posts for the chosen brands are not offered.
- Inside a market the engagement norm is that market's norm. Small markets have thin cells, and the minimum samples (30 posts, 200 brand comments) hide what cannot be read.

**2. Each answer becomes a brief.** The brief says we "turn each answer into a brief, a creator and a paid audience".

- A new box in section 1, "Content briefs for the top three themes". For each theme: why now, our gap, how to tell it (hook and format), who should tell it (three creators above the norm in that theme), where (the markets), the audience's own words, and the objection to answer.
- It is composed in SQL from numbers already on the page, so it costs no tokens and cannot say anything the tables do not.
- With a market set, the briefs are for that market.
- Ask AI has a suggested question to turn one into a full creative brief.
- Not in it yet: the paid audience (phase 3).

**6. Share of voice four ways.** The brief: "Brand posts ÷ category posts. Also by views, creators and engagements."

- A new table in the opening section with each brand's share of posts, views, creators and engagements.

## Phase 2: built (hair removal)

One new read of the captions and comments (`scripts/classify_products.py`) added two things the data lacked. Measured accuracy is in `docs/accuracy-report-products.md`. The product lines are a draft for a person to confirm: `docs/product-lines-draft.md`.

**4. Products.** The brief's matrix has four rows: my brand, competitor brands, my products, competitor products. We only have brands.

- Tag each post and each brand comment with the product line it is about (for example a brand's intimate range against its standard razors), from a list per brand drawn from the captions and confirmed by a person.
- Built: "What people say, by product", "Objections by product, ours and rivals'" and "Who drives each product".
- Not built: the priority grid per product. Only four product lines have the 200 brand comments a comment measure needs.

**5. The benefit a post claims.** Two sub-questions are "not possible yet" only because posts are not tagged this way.

- Tag each post with which of the six attributes it claims (price, efficacy, ease, durability, safety, service).
- Built: "Benefits nobody claims" (rarely claimed, often praised) and "Are we saying what people value?" (what creators claim against what the audience praises).

Cost: one classifier run over 6,137 hair removal posts and 7,609 brand comments, a few dollars. The other nine industries have not been read: their product and claim boxes stay hidden.

## Phase 3: built

- **3. Paid audience.** Each content brief has a "Paid audience" line: the average audience of the creators behind the theme whose audience is known (gender, the two largest age bands, the three largest countries). Shown when five or more such creators stand behind the theme. Interest targeting is not in the data.
- **7. Creator score.** Now 45% engagement vs norm, 25% buying signals, 15% theme fit, 10% value (modelled fee per engagement, cheapest best) and 5% availability (lost when a rival has paid the creator). The table shows the estimated fee per post and the availability. Audience match is still shown and not scored: there is no target audience to match against.
- **8. The monthly read.** The Reports page opens each month with the eight measures against the month before and a line on what moved most. A market select gives the same read for one market.
- **10. A method page** in the left menu: every definition, the fixed lines and minimum samples, coverage per industry, the measured accuracy of each reading, and the limits. The accuracy figures live in `src/lib/method.ts`.

## Open question for Tom

- **9. Themes on earned posts only.** Should "which conversations are winning" count the brand's own posts and adverts? Not built either way until he answers.

## Needs data we do not have

The Culture lens, comments and full captions for the nine other industries, transcripts, launch dates, and what the supplier's paid flag means.
