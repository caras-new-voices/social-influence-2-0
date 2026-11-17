# Plan: Tom's Default Template without hashtags

Status: built as the template "Toms No Hash". The model classifier has run on every post (section 12). Section 11 says what was built and what is still to do.

## 1. What we are solving

Tom's unit of analysis is the theme: the conversation a post belongs to. Today a theme is a hashtag in the caption (see `docs/toms-template-plan.md`, section 7). That was the only definition available for every industry, and it has four weaknesses:

- **Coverage.** Only posts with a hashtag have a theme: 84% of posts in hair removal, 51% in electric vehicles, 36% in spirits, 22% in enterprise technology. Theme tables describe a minority of the conversation in most industries.
- **It is the creator's label, not the content.** A tutorial with no hashtag is invisible; a post tagged #travel may be about something else.
- **Languages split themes.** #shaving, #rasieren and #rasage are three themes.
- **Noise.** Platform filler, ad disclosures and campaign tags need stoplists that are never complete.

The goal is a theme for every post, defined by what the post is about, the same in every language, in a vocabulary Tom recognises. Six elements and one headline tile of the template depend on it. Everything else in the template (the eight measures, questions 3 and 5, the creator tables) does not use themes and stays as it is.

## 2. Options considered

**A. Classify each post with a language model, against a fixed list of themes per industry.** A model reads the caption and assigns one of 15 to 25 themes agreed in advance for that industry, plus a hook (tutorial, review, routine and so on). Runs once when data is loaded, not when a dashboard is opened. Covers every post with a caption, works across languages, and produces Tom's hooks as well. Costs tokens and needs a model key at load time.

**B. Keyword extraction with no model.** Find the distinctive words and phrases in captions per industry and group posts by them. Free and repeatable, but it splits by language exactly as hashtags do, and the groups are word lists, not conversations.

**C. Embeddings and clustering.** Turn each caption into a vector, cluster, and have a model name the clusters. Finds themes nobody thought of, but the clusters move every time data is added, so a theme's numbers are not comparable month to month. That breaks the template's first promise.

**D. Ask IMAI for post-level theme tags.** IMAI's pipeline already analyses every comment. If it can tag posts the same way, the template only needs to read the tag. Best long-term answer, but outside our control and timeline.

**Recommendation: A, built so that D can replace it.** A fixed list per industry keeps months comparable, which C cannot, and it reads meaning, which B cannot. The template reads themes from one table, so tags from IMAI can later fill that table instead of our classifier with no change to the template. Hashtags stay as the fallback where no classification exists, and as one of the signals the classifier reads.

## 3. How it works

### Step 1: agree the themes for each industry

A script takes a balanced sample of about 400 captions per industry (across brands, platforms and languages) and asks a model to propose 15 to 25 themes, each with a name, a one-line definition and three example captions. The result is written to a file per industry that a person edits and approves. Tom owns this list. Nothing is classified until the list is approved.

The list is versioned. A theme can be renamed freely. Adding, merging or splitting themes creates a new version and a reclassification, so numbers from different versions are never mixed.

### Step 2: classify every post

For each post the model returns:

- **primary theme**: one from the industry's list, or "other";
- **secondary themes**: up to two more, when the post clearly covers them;
- **hook**: one of a fixed list that is the same for every industry: tutorial or how-to, review, routine or day-in-the-life, haul or unboxing, comparison, humour or entertainment, news or announcement, deal or promotion, event, other;
- **about the brand**: yes, in passing, or no. This also answers the finding from testing that some tracked posts are off-topic (a car post filed under a tourism destination);
- **confidence**: high, medium or low.

The model sees the caption, the hashtags, the platform, the format and the brand the post is filed under. It does not see engagement, so performance cannot leak into the label.

The job runs as a batch with the instructions and the theme list cached, is resumable, and writes one row per post to a new table `post_themes` (post, theme, role primary or secondary, hook, about_brand, confidence, list version, model). For the nine snapshot industries the result ships inside the industry packs, so production needs no model key to have themes. For the live industry, new posts are classified when an import lands.

### Step 3: the template reads the table

The template's theme fragment changes from "extract hashtags" to "join `post_themes`". The six theme elements keep their shape and their definitions of winning, early signal and peaking. Shares are counted on the primary theme, so a theme table adds up to 100%; secondary themes are used only where a post may appear in more than one conversation (who drives each theme).

Where an industry has no classification yet, the fragment falls back to hashtags and the subtitle says so. No dashboard loses its theme section.

## 4. What changes in the template

**Better versions of what exists**

- Themes: growth and performance; where we are missing; conversations that sell; rewarded and nobody owns it; content gap; who drives each theme. All now cover every post with a caption, in one vocabulary across languages.

**New elements this unlocks** (all in Tom's document, all listed as gaps in the first plan)

- **Formats and hooks that win in each theme.** Engagement versus norm by hook, and by theme and hook. Today the template can only split by platform and post type.
- **Hooks we under-use.** Our mix of hooks against competitors'.
- **Themes by market.** Which theme leads in which country, now that languages no longer split a theme.

**A new filter**

- Posts marked "not about the brand" are left out of the theme elements by default. A line under the section says how many were left out.

**Kept from hashtags**

- One element, "Campaign hashtags", for the thing hashtags are good at: tracking a brand's own campaign tags and their reach.

## 5. Data work it needs first

- **Full captions.** The nine new industries were loaded with captions cut at 600 characters. Reload with captions up to 2,000 characters, so the classifier reads what the creator wrote.
- **Titles where the export has them.** YouTube descriptions without the title are weak evidence. The current exports have no title column; ask IMAI whether it can be added.
- **Posts with no caption** (3% to 6% in most industries) get the theme "unknown" and are counted separately, never guessed.

## 6. Cost and where it runs

Classification is a one-time cost per post, paid at load time. A rough size: about 300 input tokens and 40 output tokens per post, with the instructions cached. For the 77,000 posts loaded today that is in the order of 25 million input tokens and 3 million output tokens. A small model is enough for this task, and the batch route is cheaper than live calls. The exact cost depends on the model chosen; it should be confirmed against current prices before the run, not assumed.

Two consequences:

- The run needs a model key. The build environment has none, so the pipeline can be built and tested on a small sample in demo mode, but the real run needs a key supplied for it.
- If the full exports are loaded later (538,000 posts instead of the 71,000 sample), the cost scales with them.

## 7. How we will know it is good

- **Coverage:** at least 95% of posts with a caption get a theme other than "other" or "unknown". An industry where "other" is above 15% means the list is missing a theme.
- **Agreement:** a person labels 150 posts per industry blind. The classifier's primary theme should match in at least 80% of them, and Tom reviews the disagreements. This is the number to show him.
- **Stability:** classifying the same 500 posts twice gives the same primary theme at least 95% of the time.
- **Comparison with hashtags:** for posts that have both, how often the hashtag theme and the classified theme tell the same story. Large differences are reviewed, not assumed to be errors.
- **The rotation test** already in the project runs the template for all 93 brands and must still pass.

## 8. Work plan

| Phase | Scope | Estimate |
|---|---|---|
| A. Data | Reload the nine industries with full captions; `post_themes` table; packs carry classifications | 0.5 day |
| B. Theme lists | Discovery script; one editable file per industry; versioning | 1 day |
| C. Classifier | Batch job with cached instructions, resumable, with the "about the brand" flag and hooks; small-sample test | 1.5 days |
| D. Template | Fragment reads `post_themes` with the hashtag fallback; the new hook elements; relevance filter; rotation test | 1.5 days |
| E. Quality | The agreement and stability checks; a short report per industry for Tom | 1 day |
| F. Live data | Classify new posts on import for the live industry; log the tokens as a platform cost | 1 day |

About six and a half working days, plus Tom's time to approve the theme lists. Phases A to D give a working template on a test sample; the real run waits on the key and the approved lists.

## 9. Decisions to take before building

- **Who approves the theme lists.** Recommendation: Tom, per industry, with a first draft from the discovery script. Without an owner the lists drift.
- **One theme per post, or several.** Recommendation: one primary theme and up to two secondary, with shares counted on the primary so they add up.
- **Which model, and the budget for the first run.** Recommendation: a small model through the batch route, on the 71,000 loaded posts first.
- **Is classification charged to the client's token balance?** Recommendation: no. It is a cost of preparing the data, logged separately from the analyst's usage.
- **What happens to hashtags.** Recommendation: keep them as the fallback and for the campaign element; stop using them to define themes once an industry is classified.
- **Should "not about the brand" posts leave the whole dashboard, or only the theme elements?** Recommendation: only the theme elements for now, with the count shown. Removing them everywhere changes share of voice, which is a bigger conversation with IMAI about how posts are matched to brands.

## 10. Risks

- **Captions do not always describe the video.** A caption that says "link in bio" tells the classifier nothing. Transcripts would fix this; the exports do not have them. Posts like this land in "other" and are counted, so the size of the problem is visible.
- **New conversations appear.** A fixed list cannot name a theme that did not exist when it was written. Each month the "other" posts are re-run through discovery, and themes that would capture a meaningful share are proposed to the list owner.
- **A changed list changes history.** Reclassifying under a new version rewrites past months. The version is stored and shown, and a version change is a deliberate event, not a side effect.
- **Sampling.** Themes computed on a 1,000-post sample per brand are less stable for small themes. The minimum-sample rules in the template already hide small cells.

## 11. As built: "Toms No Hash", first version

The template exists as `tomnohash` ("Toms No Hash" in the New dashboard dialog). It is Tom's Default Template with themes that do not depend on hashtags, plus two hook elements. Tom's Default Template itself is unchanged and still uses hashtags, so the two can be compared side by side.

What was built from this plan:

- **The table and the views.** `post_labels_raw` holds one row per post and label; the views `post_themes` and `post_hooks` read it and keep to the dashboard's brands like every other dataset view. The template's theme fragment joins `post_themes` instead of extracting hashtags (`src/lib/tom.ts`, one factory for both templates).
- **Theme lists.** One list per industry, 15 or 16 themes each, and one list of 12 hooks for all industries, in `data/seed/themes.json`. They are the lists in `docs/theme-lists-draft.md`.
- **Hook elements.** "Hooks that win" (engagement versus norm by hook, us against competitors) and "Hooks we under-use" (our mix of hooks against theirs).
- **The analyst** is told about `post_themes` and `post_hooks`.

What is different from the plan, and why:

- **Word rules, not a model.** The build environment has no model key, so each theme and hook is assigned by a regular expression on the words of the caption (`src/lib/themes.ts`). The rules run inside the database when data is loaded or imported, cost nothing, and give the same answer every time. They are cruder than a model: they match words, not meaning, and they are strongest in English.
- **Several themes per post, no primary theme.** A rule either matches or not, so a post has every theme whose rule matches. Theme shares therefore add up to more than 100%.
- **No "about the brand" flag from the rules.** Rules cannot judge that, so off-topic posts are still counted until the model has run.
- **Captions were not reloaded.** The nine new industries still have captions cut at 600 characters.

Coverage, as the share of posts that get at least one theme, against the share that have a hashtag:

| Industry | With a theme | With a hashtag |
|---|---|---|
| Hair removal | 78% | 84% |
| Electric vehicles | 53% | 51% |
| Tourism | 62% | 56% |
| Fashion | 63% | 53% |
| Enterprise technology | 81% | 22% |
| Sleep technology | 66% | 44% |
| Hair care | 80% | 82% |
| Spirits | 80% | 36% |
| NFL | 73% | 43% |
| Israel | 63% | 43% |

(Measured before three over-broad rules were tightened; the figures for tourism, sleep technology and NFL are a few points lower now.)

The gain is not mainly coverage. It is that a theme is now a readable conversation shared across languages ("Range, battery and charging") and not a tag ("#elektroauto"), and that there are 15 of them per industry and not thousands.

The model classifier has run (section 12). Every post in all ten industries now has a model label, and the app uses those labels instead of the word rules.

- `scripts/classify_posts.py` sends batches of 20 captions with the industry's theme list and gets back, per post, a primary theme, up to two secondary themes, a hook and whether the post is about the brand. It is resumable and writes `data/seed/labels/<industry>.json.gz`.
- When that file exists for an industry, the app loads it in place of the word rules (`src/lib/themes.ts`). The rules then only cover posts the model has not seen, such as posts from a later import.
- With model labels, theme shares are counted on the primary theme, posts judged "not about the brand" leave the theme elements, and a new element shows, per brand, how much of its tracked conversation is really about it.

Still to do, in the order that matters:

1. **Tom reviews the theme lists.** They are a draft from reading samples. Changing a list means running the classifier again for that industry.
2. **A person checks a sample.** Accuracy so far is measured against a stronger model, not a person (section 12).
3. **Label new posts on import.** Posts from a later import fall back to the word rules until the classifier runs on them.
4. **Reload full captions** for the nine new industries.

## 12. As built: the model run (November 2026)

- **Run:** all 77,546 posts, model gpt-5.4-mini, 20 posts per request. About 10.9 million input and 4.4 million output tokens, roughly $25 at the price we assumed for that model (not checked against a bill). It took about 75 minutes. Ten requests failed when the connection dropped; a second pass labelled those posts. The script now retries a dropped connection.
- **Output:** `data/seed/labels/`, 828 KB for all ten industries.

**How right it is.** `scripts/review_labels.py` takes 150 random posts with a caption per industry (1,500 in all). A stronger model (gpt-5.5) reads each one without seeing either answer and names the best theme, any other themes it would also accept, and whether the post is about the brand. "Other" and "Unknown" count as the same answer. Results:

- Model, primary theme accepted: 80% overall (1,198 of 1,500). By industry: spirits 87, Caribbean tourism 83, electric vehicles 83, hair care 82, Israel conversation 82, premium fashion 79, hair removal 78, enterprise technology 76, sleep technology 76, NFL New York 73.
- Model, "about the brand" agrees (counting "yes" and "passing" as one side): 93% overall. Lowest are the Israel conversation (88) and spirits (89).
- Word rules, for comparison: they give 70% of posts any theme, and only 48% of the themes they attach are accepted. Rules attach every theme whose words match, so one post often gets several.

**Sleep technology list, second version.** The first run left 17% of on-topic sleep technology posts in Other, far more than any other industry (2% to 10%). Reading them showed three missing themes: the device tagged in vlogs and outfit posts, company news (funding, the stock market, lawsuits, founder interviews) and personal opinions about wearing a tracker. These were added, and the two small price themes were merged into "Price, subscription and deals". After labelling sleep technology again, Other among on-topic posts fell to 5%, and "Tagged in daily life and outfits" became the largest theme (14% of on-topic posts). Theme accuracy on the same 150 posts stayed level (75%, against 76%). "About the brand" agreement moved from 90% to 85%, within the reviewer's own noise: it changed its answer on 13 of the 150 posts between two runs.

**Caribbean tourism and enterprise technology lists, second version.** Caribbean tourism gained "Trip moments and memories", "Vacation outfits and looks" and "Conferences and business events"; Other among on-topic posts fell from 10% to 3%, and theme accuracy on the same 150 posts rose from 83% to 88%. Enterprise technology's list already covered on-topic posts well (4% in Other); most of its Other was posts not about the brand (about half its posts). It gained one theme, "Owners, politics and controversy", for the conversation about owners and executives in politics, boycotts and censorship claims. Other among on-topic posts is now 3%, and theme accuracy rose from 76% to 81%.

Note that most of what remains in Other for sleep technology is posts not about the brand at all (40% of the industry's posts), which the theme elements already leave out.

This is agreement with a stronger model, not a human check. Most disagreements are about posts that fit two themes, or captions too thin to judge. The review answers are kept in the work folder, not the repository; rerun the script to reproduce them.
