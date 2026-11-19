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

`npm run check:numbers` now covers 336 numbers, including share of voice four ways and the minimum-sample rules.

### Not verified
- The product lines are a model's draft with one edit of mine (`docs/product-lines-draft.md`). Nobody who knows the brands has confirmed them.

- No person outside this build has checked a sample. The model checks and my own read are above; Tom or the team has not looked.
- The list of brand-owned accounts is a draft (`docs/brand-accounts-draft.md`). Earned share depends on it.
- Gifted posts are left out of earned share. Tom to confirm.
- The live site's own upgrade has not been watched.
