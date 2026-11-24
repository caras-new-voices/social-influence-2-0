# Quality gate

Fill this in before any build goes to Tom. It is his three checks, written down. A build that fails a check either gets fixed or goes with the failure stated here in plain words.

## This build: "Tom's 8, Nov 8th", 18 November 2026

### 1. Does it answer the brief?

Full audit: `docs/brief-audit.md`.

- Of the brief's 39 sub-questions: 24 answered as specified, 9 answered with a stated approximation, 6 not possible on this data.
- All eight measures are there. Earned share is the brief's for the first time (neither brand-owned, nor paid, nor gifted). Creator score leaves audience match unscored.
- Each of the five sections ends in the output the brief names, as a written answer at the top.
- Not possible yet: the Culture lens (3 sub-questions), benefits nobody claims, "are we saying what people value", and launch reads. The dashboard says so in its closing note.

### 2. Does it make sense in the client's shoes?

Walked as a head of product on a Venus dashboard (hair removal) in a browser, section by section.

- New dashboard is two steps: pick the brands, name it. No questions to answer first.
- Every box names its measure and its base in the title or subtitle. Every chart has a line above it saying what its numbers measure. Tiles and table columns say whether they are a count, a share, a ratio or a rate.
- One vocabulary: engagements (a count), engagement rate (a percentage of reach), engagement vs norm (a ratio).
- Each section opens with "The answer", so the reader gets the conclusion before the tables.
- Changed after the walk: "Hooks we under-use" was twelve stacked colours and could not be read, so it is now a table sorted by the gap. "What the copy should say" showed jokes about adverts, so it now takes only comments about a product attribute. "What stops people buying" was one comment per row, so it is grouped by attribute. Creator scores bunched at 100, so the score now uses ranks and counts for less with few posts.
- Still weak: "Who people compare us with" lists names as commenters wrote them ("Laser", "Männerrasierer"), so it mixes brands and methods. "Rewarded, and no brand owns it" is often empty of open themes when few brands are tracked. Both are honest, neither is impressive.

### 3. Is the analysis accurate?

Reports: `docs/accuracy-report.md` (all ten industries) and `docs/accuracy-report-hair-removal.md` (the last hair removal run, after the final fixes), written by `npm run check:accuracy`. A stronger model (gpt-5.5) judges samples blind. The pass mark is 90%. This is agreement with a model, not a human check. I read the disagreements for hair removal by hand. The same check gives slightly different numbers each run (about 3 points either way), because the reviewer is not perfectly consistent.

Tom's own examples, on hair removal:

- **Paid versus organic.** Was: 3% of Venus posts flagged paid, against 18% disclosed in captions. Now: paid status agrees with the reviewer on 97% of a random sample, and 96% of posts we show as paid carry a disclosure.
- **"Creators we have never paid".** Was: 14 of the top 20 for Venus had a paid marker in a caption. Now: none of the top 20 has a paid or gifted marker. With the reviewer also asked to catch giveaways and undisclosed campaign posts, it questions 4 of Venus's 20 (80%), 2 of Philips OneBlade's (90%), 1 of Wilkinson Sword's (95%) and none for Estrid, Veet and Mercadona. The Venus four are campaign posts with no disclosure at all ("alongside Gillette Venus" at a store opening). **A partnership nobody discloses still looks earned.** That is a limit of reading captions.
- **"Questions nobody answered".** Was: mostly "where's your hat from". Now: 95% to 100% are about the brand or product, by brand.
- **Comment tags about the creator.** Now each comment is read for what it is about. 7,654 of 31,687 are about the brand or category, and only those feed the comment measures.

All checks, hair removal, last run:

- Paid, gifted or neither: 97%. Pass.
- Posts shown as paid: 96%. Pass.
- Posts kept are about the brand: 98%. Pass.
- Buying signals are buying signals: 92%. Pass.
- The right one of the six attributes: 87%. **Just under the mark** (90% on the run before, 58% before the stricter second reading). Most disagreements are judgement calls: is a question about hair growing back thicker "safety" or nothing? Treat attribute splits as indicative.
- Comment is about the brand or category: 89%. **Just under the mark.** The disagreements are mostly bare praise ("Love it", "top") that could be about the product or the creator. We count those as creator, so brand comment counts err on the low side.

Other industries (posts only):

- Paid status passes everywhere (94% to 100%).
- **Posts kept are about the brand: fails in three industries.** Enterprise technology 69%, spirits 82%, the Israel conversation 77%. Their captions are cut at 600 characters and often do not name the brand at all, so neither our classifier nor the reviewer can tell from the caption. Share of voice in those three should not be shown to a client until the captions are reloaded in full.
- Posts shown as paid are under the mark for Caribbean tourism (85%), NFL New York (89%) and the Israel conversation (4 of 5). The misses are mostly discount codes and betting promotions read as paid.

Theme accuracy was measured last week: 78% for hair removal, the lowest of the tuned lists. Tom has not yet reviewed that theme list.

### What ran

- `tom8` template check: all ten industries, 93 brands, no failing element.
- `npm run check:scope` and `npm run check:sessions`: pass.
- Migration tested on Postgres 16 from production's state: the views rebuilt, no post label redone, corrections applied in the first six requests. Every element of the default dashboard ran in under a second.
- Type check, lint and build.

### Further QA after the merge (18 November 2026)

- **The live site.** The upgrade ran on https://social-influence-2-0.vercel.app/ for all ten industries. A dashboard made through the new dialog loaded all 46 boxes with no errors; the slowest took 1.5 seconds.
- **The arithmetic.** `npm run check:numbers` recomputes 180 headline numbers from the raw files without the app's SQL: the eight measures, the per-brand table, the paid mix, the comment rates, the theme table with its status, and the attribute splits. All 180 match the live dashboard, with Venus as "us" and again with Estrid.
- **A person's read, of sorts.** I read 100 Venus posts and 200 Venus comments without seeing our labels first.
  - Posts (paid, gifted, brand-owned or earned): 94 agree, 3 are judgement calls, 3 are wrong. The wrong ones: a laser clinic's "Venus Viva" post kept as a Venus post; a plainly gifted post shown as paid because the platform flagged it; one shown as paid with no disclosure in the part I read.
  - Comments (about the brand or not): 184 agree, 14 are judgement calls, 2 are wrong.
  - Buying signals: all 12 in the sample are right. Attributes: 27 of 31 are right (87%).
- **Code review.** An independent review of the change found nine problems and none in the migration, the dialog or the label mappings. All nine are fixed. The two that mattered: an import that re-sends existing posts would have dropped the caption-based paid correction, and a comment the second reading had not reached would have counted as "no buying signal". Neither had affected the live numbers.
- **A question this raised, and what was done.** The supplied paid flag marks 1,293 of 3,000 hair care posts as paid, about four times what the captions disclose. Almost all are on TikTok and many carry TikTok Shop tags: creators selling the product for commission. The paid mix now has six groups, so nothing is guessed:
  - brand-owned;
  - paid, disclosed in the caption;
  - paid, platform label only (flagged, and the caption says nothing);
  - affiliate or shop (clear shop or commission markers in the caption);
  - gifted (also when the platform flagged it, if the caption says gifted);
  - earned.
  Hair care now reads 37% earned, 13% affiliate, 12% gifted, 10% paid and disclosed, 26% platform label only, 2% brand-owned. Posts shown as affiliate check out at 98 to 99% against the reviewer in hair care, sleep technology and premium fashion. **Still open:** what the 26% "platform label only" posts are. They are probably more shop posts without a tag, but the caption cannot say. And whether affiliate posts should count as earned is Tom's call; today they do not.

### Market filter, briefs, products and claimed benefits (18 November 2026)

- **Market filter.** Checked in the browser and on Postgres: the numbers change, the bar names the market, the choice survives a reload. Inside a small market the minimum samples hide what cannot be read.
- **Products and claimed benefits** (hair removal only). A model drafted each brand's product lines, then read 6,137 posts and 7,609 brand comments. A stronger model read a sample of 240 of each blind (`docs/accuracy-report-products.md`):
  - Post product line: where a line was named, the judge names the same one 94% of the time. Comments: 93%.
  - Claimed benefits: the judge confirms 88 to 90% for price, ease and safety. **Below the mark:** efficacy 72%, durability 75% (8 posts), service 63% (11 posts). Read the two claims tables as a direction, not to the point.
  - 43% of posts name no product line, so the product boxes cover the rest.
- **The arithmetic.** `npm run check:numbers` now recomputes 291 numbers, including the product and claims boxes. All match.

### Paid audience, creator score, monthly read and method page (19 November 2026)

- **Creator score** now counts cost and availability. Fees are the supplier's model, so cost carries 10% only.
- **Paid audience** is an average over the creators whose audience is known, 539 of 3,332 profiles in hair removal. It is hidden under five creators.
- **Monthly read** uses the dashboard's own eight-measures query, so the two cannot disagree. A month with under 30 of our posts says so.

### QA loop on the market filter, products and monthly read (19 November 2026)

Three rounds, each one review plus the checks, until a round found nothing.

- **Round 1.** Two reviewers read the three merges. The number check learned `--market` and now recalculates inside a market. The AI analyst was asked six questions and each answer was compared with the database. Found and fixed:
  - the analyst's period tool dropped the market, and it reported all-time numbers as "July";
  - the analyst showed posts with no product line as a line called "Unknown";
  - a failed monthly read was shown as "too few posts" and never retried;
  - a notification link dropped the saved market, and a market that fell off the list could not be cleared;
  - "Show all time instead" did nothing when only a market was set;
  - comments imported on their own got no market, so the market filter would drop them;
  - the paid audience counted a creator twice when they post for two brands;
  - a brief could quote praise for a rival as "in their words", and recommend "listing or sale advert" as the way to tell a story;
  - share of creators was a share of the sum of each brand's creators, not of all creators;
  - the number check passed with nothing compared when a box failed.
- **Round 2.** A third reviewer read only the fixes. Found and fixed: "all markets" chosen on purpose was lost on a reload or on the way back from Reports; a failed volume query read as a month with nothing in it; the checking script's own crash paths.
- **Round 3.** Nothing found. The number check passes in eight combinations of brand and market (142 to 336 numbers each), on Postgres and on the embedded database. The template check passes for all ten industries and every brand.
- **Hand read.** 37 posts: the 10 product lines I read were right; of 27 claim tags, one was doubtful and several could not be judged from the cut caption.

- **On live after the merge.** The number check passes for three combinations and the template check for two brands. The browser walk showed the period and market save taking about 11 seconds while the boxes load, so leaving sooner could lose it. The save now survives leaving the page.

`npm run check:numbers` now covers 336 numbers, including share of voice four ways and the minimum-sample rules.

### Fixes after the QA loop (19 November 2026)

- **Claim tags read a second time.** A stronger model read every caption again with stricter rules: a claim needs words that say it, liking is not a claim, gentle is safety and not efficacy. A blind judge on 300 posts now confirms 96 to 100% of the claims we tag (it was 63 to 90%). We tag fewer than the judge does: we find 78 to 90% of its price, efficacy, ease and safety claims and 55% of its durability and service claims. Reading the misses, the judge counts a bare shop hashtag or a tagged retailer as a claim and we do not.
  - **The finding changed.** Before, "service" looked praised more than claimed. That came from the weak tags. Now efficacy is the open benefit (29.5% of praise against 23.4% of claims), and safety and ease are claimed more than they are praised.
- **Creators on two platforms** are scored once per platform, not merged under one.
- **The written monthly review follows the market.** A review written with a market selected is about that market and kept apart from the all-markets one.
- **"What moved most"** ranks each measure on its own scale (5 points of a share, 0.2 of a ratio, a fifth of a rate), so a tiny share no longer outranks a real move.
- **An older fault found on the way:** on Postgres a written review did not come back in the month list after a reload. Fixed.
- **Import tested.** Two comments imported without their post got the post's market and showed under it, and not under another market.

### Small fixes sweep (19 November 2026)

- With a market selected, the dates, totals and month picker on the period bar are that market's.
- The market is named once on the period bar.
- A brief says its share figures are for the same period, and names an objection only when 5 or more brand comments raise it.
- The accuracy figures on the Method page come from `data/seed/accuracy.json`, which `check_accuracy.py` and `classify_products.py` write, with the day each was measured. The page's coverage counts are kept for ten minutes.
- The analyst's period tool keeps the market as it is at that moment, even if it was changed while the answer was being written.

### Closing the gaps to the brief (19 November 2026)

Built after a line-by-line rating of the product against Tom's brief (6.5 out of 10 for hair removal).

- **Per product:** amplify, answer and attack by product, the priority grid by product, and objections by product over time. Only five product lines have the 200 brand comments a comment measure needs.
- **Top 10 lists** per theme, per product and per rival.
- **Every answer is a brief:** the white space and the amplify, answer and attack list now get a creator and a paid audience too. Each theme brief adds keywords from the conversation and how to activate the creators in paid.
- **Per theme and per market:** the hook and format that win in each theme, the top themes of the five largest markets side by side, and where each theme grew first.
- **Switching** read from the comments by a model: the judge sees the same direction in 91% of the comments we count, and agrees on 95% of the ones we do not.
- **The loop:** a theme can be marked as acted on, and each month's read says whether our posts, our share and our engagement on it moved.
- **Audience match** is in the creator score, against a target audience set under Brands.
- A bug caught in testing: with no target set, audience match read 100% for creators with audience data. Fixed before merge.

### White space (19 November 2026)

The white-space list was empty because the brief's "no brand above 25%" cannot pass with six brands. Rebuilt per `docs/white-space-plan.md`.

- **Result on hair removal:** two open themes (shaving routine and how-to; method comparison) and two unclaimed (hauls, gift sets and empties; men's and unisex grooming).
- **Two changes made while testing, beyond the plan:**
  - A brand with more than half of a theme's posts owns it whatever its size. Without this, a brand that is most of one market read as owning nothing there.
  - A rewarded theme that is under a third unprompted is "brand-seeded", not white space. The hand read found "testing panels and gifted products" passing as open while 88% of it is gifted or paid.
- **Hand read:** 30 posts across the five themes first listed. All five are real conversations. One was removed by the rule above.
- **The arithmetic:** the number check grades every theme again from the raw files: 502 numbers, and 312 inside the United Kingdom.
- **Monthly report:** shows the open and unclaimed themes of the month, what is new, what closed and who took it, and which ones the team acted on.

### Second rating against the brief (19 November 2026)

Rated again line by line after the white-space build, with the live dashboard run box by box: 63 data boxes for hair removal, none empty and none under its minimum sample; 29 for an industry without comments.

- Hair removal: about 8 out of 10 (6.5 on the first rating). The other nine industries: about 5 (4 before).
- Sub-questions: 29 answered, 6 approximations, 4 not possible.
- Lowest parts: the Culture lens (not built), what the data lead is promised (coverage, an API, three readings under 90%), breadth beyond hair removal, and the length of the dashboard for a senior reader.
- The ratings are the builder's own. Nobody outside the build has rated it.

### One-page summary and the accuracy lift (23 November 2026)

**Summary view.** A dashboard now opens on one page: the eight measures and the box that answers each question, each with a button to the boxes behind it. "Everything" shows the full grid. It loads 7 queries where the full dashboard loads 63, in about two seconds on the test copy. It works on dashboards saved before it existed.

**Accuracy, hair removal.** Three readings were below the 90% mark. Each was read again by a stronger model.

- **Themes: 82% to 90%.** Judged on 300 posts by a blind reviewer (the first figure, 78%, was on 150 of them). The instructions were tuned on 150 posts and scored 94% on the other 150 and 85% on the tuned half in the final run. The second reading changed the theme of about one post in three.
- **The right attribute on a brand comment: 87% to 95%.** A third reading now has to name the same attribute, or the comment carries none. 975 of 3,586 attributes were dropped, so fewer comments carry an attribute (2,611) and the ones that do are more often right.
- **A comment is about the brand or not: 89% to 90 or 91%** (three runs: 91, 91, 90). A stronger model now reads every worded comment the first pass called "about the creator" or "other". It brought in 645 brand comments the first pass had missed. This one sits on the mark, not clear of it.
- **Buying signals: 100% of 150.** A third reading dropped 248 of 1,644. **A fault in the check was found on the way:** it had been sampling the supplier's old buying tag, not the corrected flag the dashboard uses. The earlier 91 to 92% figures measured the wrong thing. Fixed.

**What moved on the dashboard because of it.** Brand comments are 8,299 (7,654 before). Buying signals are 1,396. With better themes the white-space list is two themes, not four: "method comparison" fell under 30 posts and "men's and unisex grooming" is no longer above 1.2 times the norm.

**Checks.** The number check matches in four combinations of brand and market (485 numbers, 293 to 305 inside a market). The template check passes for three brands.

### Testing against the brief (23 November 2026)

A round built on the brief itself: does each answer follow the method the brief states, does it read sensibly, and does the AI analyst give the same answer.

- **The brief's rules, recalculated.** The number check now works out nine more of the brief's rules a second time from the raw files: missing from winning themes (share in the theme minus overall share), conversations that sell (engagement vs norm times purchase intent), spikes (a month at twice the three before, the post behind it and whether it was paid), objections that matter (frequency and likes), where rivals are weak (their objection rate minus ours), who drives buying, rising creators (views up and 1.5 times the norm), buying signals per brand, and content gap. 637 numbers in all, matching in six combinations of brand and market.
- **One difference from the brief's wording, fixed.** "Who drives buying" compared a creator with our own average. The brief says against the category. It now compares with the rate across all tracked brands.
- **The five answers read as a client.** Each carries what the brief names as its output. Nothing was changed.
- **The AI analyst, asked the brief's five questions word for word.** On the first run it disagreed with the dashboard on four of five: different winning themes, "no white space" where the dashboard shows two, the old creator score weights, and a different answer to "what should we fix". The cause: it worked each answer out again its own way. It now has a tool to read any element of the dashboard and is told to read the dashboard's answer first and give it as it stands. After the fix, all five answers match the dashboard item for item.

### Third rating against the brief, tested on live (23 November 2026)

Rated again line by line, with every test run on the live site.

- **Live tests, all passing:** every one of the 63 boxes returns data, none empty or under its minimum sample; the number check matches (637 of 637, and 398 of 398 for another brand inside one market); the dashboard builds for three brands; a browser walk of the summary, the full dashboard, the market filter, the Reports page and the Method page; and two of the brief's questions asked of the analyst, both answered with the dashboard's own answer.
- **Rating:** hair removal about 8.5 out of 10 (8 at the second rating, 6.5 at the first). The other nine industries about 5.5.
- **What moved it:** the one-page summary, the readings now at or past 90%, and the analyst giving the same answer as the page.
- **What still holds it back:** the Culture lens; samples, not full coverage; no API for a client's tools; only hair removal has comments and second readings; the summary took 18 seconds to load on live from cold; the thresholds and draft lists are not confirmed by Tom.
- The ratings are the builder's own.

### Closing the last gaps, stage 1 (24 November 2026)

From `docs/brief-match-plan.md`: the things the brief promises that the earlier reviews had not counted.

- **The three outcomes lead.** A box above the eight measures states salience, purchase intent (ours against all tracked brands) and better products, each with its direction.
- **A summary for each leader.** The summary can be read as the brand lead, the growth lead or the data lead: the boxes that answer what the brief says each asks first. Which boxes go under which question is my choice (`LEADER_VIEWS` in `src/lib/tom8.ts`).
- **The measures market by market**, in one table, with the norm taken across all markets so they compare like for like.
- **Top 10 creator lists ranked by the creator score**, per theme, per product and per rival, with the score's parts beside it. They were ranked by views or engagement.
- The number check covers the markets table: 673 numbers.

### Closing the last gaps, stage 2 (24 November 2026)

- **The worked example.** The brief's own next step: "run the full set end to end on one live dataset as the worked example". `/dashboard/<id>/example` is one document that follows the brief's headings in order, each with the boxes that carry its answer, for the dashboard's brands, period and market. It runs the dashboard's own queries, so it cannot disagree with it, and prints as a PDF. Which boxes go under which heading is set in `WORKED_EXAMPLE` in `src/lib/tom8.ts`.
- **Export** now works: the worked example, print or PDF of the current view, and every table as one spreadsheet file.
- **Share** copies a read-only link to the current view: same period, market and summary, with the chat and every editing control hidden. The proof of concept has no sign-in, so "read-only" hides the controls. It does not lock the dashboard.
- Checked in a browser on the test copy: the document for Venus in Germany has 8 chapters and 21 boxes with no errors; the spreadsheet has 37 tables; the shared link opens with nothing to edit.

### Closing the last gaps, stage 3 (24 November 2026)

- **The paid loop.** On the Reports page, a theme marked as acted on can now carry the creators briefed and whether paid ran. Each month's read then says what those creators posted about us on the theme (posts, engagement vs norm, buying signals under them) and how our paid posts on it did against the unpaid ones.
- **Half-answered questions closed.** New boxes: platforms each theme under-uses; audiences by age and gender (share of comments against share of creators); what people wish existed by product; variants people ask for. The creator score table shows months active and the positive share of comments. "Objections by product" says whether each line is getting worse (latest 90 days against the 90 before, 50+ comments each).
- **The audience's own words in each brief**, beside the hashtags: the comment keywords said at least one and a half times as often under the theme as elsewhere. The supplier's keywords are in the commenter's language and some are plain ("razor", "best"), so the line is short for some themes.
- Sub-questions now: 33 answered, 2 approximations, 4 not possible (`docs/brief-audit.md`).
- The number check covers the new boxes: 841 of 841 for Venus, 842 of 842 for Philips OneBlade, 495 of 495 for Estrid in Germany, on the test copy.
- The paid loop was checked through the page in a browser on the test copy: mark, add creators and paid, read the month.

### Closing the last gaps, stage 4 (24 November 2026)

- **Speed.** Each box's answer is now stored under its query, brands, period and market, and reused until the data changes (an import, a seed pack, corrected labels or rebuilt views all clear it). On the test copy the 65 boxes of a dashboard took 2.7 seconds the first time and 0.1 seconds the second, with the same answers. The first person to open a view after the data changes still waits for the queries.
- **A second theme read for hair care: tried, not shipped.** The stricter read that lifted hair removal was run over hair care's 3,000 posts. Against the 150 posts the judge had read, agreement went from 82% to 85%: 14 posts fixed, 9 broken. That is inside the noise for 150 posts and under the 90% mark, and it would have changed a third of the labels. The labels are left as they were. Lifting another industry needs what hair removal had: a second judged sample to tune the instructions on.
- The embedded database was run again: number check 841 of 841, stored answers and the paid loop both work on it.

### Not verified
- The analyst was tested on five questions on a test copy. Other phrasings, and questions the dashboard only half answers, were not tested.
- The new product-line and switching reads for the 645 added brand comments were not judged again; the earlier figures (93% and 91%) are assumed to hold.
- The white-space thresholds (1.5 times usual share, half the posts, 15% brand-led, a third unprompted) are mine. Tom has not confirmed them.
- The switching flows are small (391 comments in all). Most pairs rest on 3 to 20 comments.
- The product lines are a model's draft with one edit of mine (`docs/product-lines-draft.md`). Nobody who knows the brands has confirmed them.

- No person outside this build has checked a sample. The model checks and my own read are above; Tom or the team has not looked.
- The list of brand-owned accounts is a draft (`docs/brand-accounts-draft.md`). Earned share depends on it.
- Gifted posts are left out of earned share. Tom to confirm.
- The live site's own upgrade has not been watched.
