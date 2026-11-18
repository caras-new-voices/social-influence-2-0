# Plan: answering Tom's feedback

Status: built on 18 November 2026 as the template "Tom's 8, Nov 8th". Section 7 says what was built and where it differs from this plan.

Source: Tom's message on the latest build, and his brief "Social intelligence: from conversation to content, creators and product" (7 November 2026).

## 1. What Tom said, and whether he is right

I checked each point against the code and the data. He is right on all of them.

**"It is built around customising from the start."** Right. The New dashboard dialog opens on guided setup, a wizard of questions. A template is the second choice, and the template it preselects is the Starter, not his.

**"I'm not seeing much of the brief. No theme analysis or white space."** Right for what he saw. The elements he names ("Creators we have never paid", "Questions nobody answered") are in the Starter template. His five questions, eight measures, themes and white space exist, but in the third and fourth templates in the list ("Tom's Default Template" and "Toms No Hash"). A client would not find them. He almost certainly never opened them.

**"Engagement jumps between volume and rate."** Right. The Starter shows total engagement, engagement per 1,000 followers and engagement over time in neighbouring boxes with no shared vocabulary. Last week's change added Count and Rate tags to tiles and tables, but chart axes and titles still do not say which one they show.

**"Paid versus organic is badly off."** Right, and worse than he says. Checked on all 6,168 hair removal posts:

- The data's paid flag marks 47 Venus posts as paid (3%).
- 290 Venus captions carry a paid marker such as #ad, Anzeige, Werbung, #publi or #publicidad (18%). The flag misses 287 of them.
- Of the top 20 Venus creators in "Creators we have never paid", 14 have a paid marker in a caption about Venus.
- The same holds for every brand: Estrid 1% flagged against 4% disclosed, Philips OneBlade 3% against 7%, Wilkinson Sword 4% against 18%.

Every number built on the flag is wrong today: organic share, earned share, paid versus organic, "does performance hold when paid", and both creator shortlists.

**"A lot of the comment tagging is about the creator, not the brand."** Right. The comment analysis tags what a comment is (a question, praise, a buying signal) but not what it is about. In a sample of Venus comments:

- "Buying signals" include "Name of the hotel pls" and "woher die Kette?" (where is the necklace from).
- "Product requests" include "Please do a grwm, love your makeup".
- Positive comments are mostly praise for the creator ("So pretty", "Face card queen"). That is why praise reads 772 per 1,000.
- The data has a field for how relevant a comment is to the post, but it is empty (zero on every comment).

**"Most of the questions nobody answered are things like where's your hat from."** Right. The top unanswered Venus questions are about a hat, a jumper, a snowsuit and whether a video was edited on a Mac.

**One more that Tom did not list.** Some posts are not about the brand at all. A Paris Match post is filed under Venus because "venus" is French for "came". The post classifier from last week already marks these, but only "Toms No Hash" uses it.

## 2. What we change, in one paragraph

One default dashboard, built to Tom's brief, that a client gets by picking their brands and nothing else. Its numbers are fixed first: paid and organic, which comments are about the brand, and which posts are about the brand. Every box says what it measures and in what unit. Customising stays, but out of the way. Nothing goes back to Tom until it passes his three checks, run as a written gate.

## 3. Work, in order

### Step 1. Fix the three accuracy problems (data first, because every measure depends on them)

**1a. Paid, organic and brand-owned posts.**

- Mark a post as paid when any of these is true: the data's flag, a paid marker in the caption (a list covering English, German, French, Spanish, Italian, Portuguese, Dutch, Polish and the Nordic languages), or the classifier reads it as a paid partnership.
- Add "gifted" as its own value (#gifted, PR sample, Influenster). It is not paid and not unprompted.
- Mark brand-owned posts: posts from the brand's own accounts. Tom's earned share needs this and the data has no such field. Brand handles go in the catalog per brand.
- Earned share then follows his definition: posts that are neither brand-owned nor paid, divided by all brand posts.
- Check: hand-read 150 posts per brand against the new field. Target: at least 95% right. Report the number.

**1b. What each comment is about.**

- Classify all 31,688 comments once with a model into: about the brand or its product, about the category (the problem, not the brand), about the creator, about something else in the post, or noise (emoji only, tags of friends, giveaway entries).
- At the same time map each brand or product comment to Tom's six attributes (price, efficacy, ease, durability, safety, service). Today's attribute list is the data supplier's, not his.
- Every comment measure then counts brand, product and category comments only: purchase intent, praise and objections, content gap, unanswered questions, requests, switching.
- Cost: about 32,000 short comments, roughly $5 to $10 with the small model. To be confirmed on a pilot of 500 before the full run.
- Check: a stronger model and a hand-read of 200 comments per brand. Target: at least 90% right on "about the brand or not".

**1c. Posts not about the brand.** Apply the existing "about the brand" label in every measure, including share of voice, not only in theme elements.

**1d. Theme accuracy.** Hair removal themes agree with the reviewer 78% of the time, the lowest of the three industries not yet tuned. Tom reviews that theme list (it is in `docs/theme-lists-draft.md`), we relabel, and re-measure. Target: 85%.

### Step 2. One default dashboard, built to the brief

- Start from "Toms No Hash", which already has the eight measures, the five questions in his order and themes from captions. Rename it to the product's default (working name: "Social intelligence"). It becomes what a new dashboard is.
- Audit it against the brief, sub-question by sub-question. The brief has 39 sub-questions. For each one, record: answered as specified, answered with a stated approximation, or not possible on this data and why. The audit is a table in this folder and is the first of Tom's three checks.
- Close the gaps the audit finds. Known ones today:
  - Each section must end in the output Tom names: 3 to 5 themes to build around, the "own it" list, 3 to amplify / 3 to answer / 3 to attack, the top 10 creators per theme, the priority grid. Today sections end in charts, not answers.
  - Unanswered questions grouped by topic, not a list of single comments.
  - Thresholds from the brief applied exactly: winning is growing and above 1.2, early is above 1.5 with momentum under 20%, white space is 1.2 or more with 30+ posts and no brand above 25%, minimum 30 posts per theme and 200 comments per comment measure.
- State the limits on the dashboard itself, in one line where they apply:
  - The Culture lens needs a culture query we do not have.
  - Hooks come from captions, not transcripts.
  - Audience match covers the creators with audience data.
  - Only hair removal has comments, so the nine other industries show questions 1, 2 and 4 only.
- Add a short written answer at the top of each section, generated monthly from that section's numbers: "The three themes to build on this month are ...". This is where "we ask the smart questions" shows. It uses only numbers on the page.

### Step 3. Make every box readable without Ask AI

- One vocabulary, used everywhere: **Engagements** (a count), **Engagement rate** (engagements per view, a percentage), **Engagement vs norm** (a ratio, 1.0 is the norm). No other wording for engagement.
- Every title or subtitle names the measure and its base: "Engagement vs norm, by theme", "Buying signals per 1,000 brand comments".
- Chart axes carry the unit (%, ×, per 1,000). This was left out of last week's change.
- A fixed key under the eight measures: one line per measure in plain English, from Tom's "In plain English" column.
- Ask AI stays, positioned for depth. Its suggested questions become the interesting ones ("Tell me more about the razor bump conversation in Germany"), not "Explain what this shows".

### Step 4. Move customising out of the way

- New dashboard becomes: name it, pick the industry and brands, done. The default dashboard opens.
- Guided setup, the other templates and Blank move behind "More ways to start".
- Starter, Eran's and the hashtag version of Tom's template leave the picker. Their accuracy problems are the ones in section 1 and fixing three more templates is not worth it. Existing dashboards built from them keep working.
- Editing boxes, adding elements and the chat stay as they are, for the 10% who want them.

### Step 5. The gate before anything goes to Tom

A written checklist, `docs/quality-gate.md`, filled in for every build that goes to him. It has his three checks:

1. **Does it answer the brief?** The sub-question audit from step 2, with a status per row and no row left blank.
2. **Does it make sense in the client's shoes?** A walk through the default dashboard as a head of product, for one brand per industry: for each box, can I say what question it answers, what the number means and what I would do about it, without clicking anything? Boxes that fail are fixed or removed.
3. **Is it accurate?** A script, `npm run check:accuracy`, that for every element pulls the rows behind its top results and judges them: is this post paid or organic as shown, is this comment about the brand, is this creator really unpaid, is this theme right. A stronger model judges 50 rows per element and I read 10 of each by hand. The gate records the pass rate per element. Anything under 90% does not ship.

The first run of the gate goes to Tom with the build, so he sees what was checked and what the limits are.

## 4. Order and size

1. Step 1a, 1b, 1c (accuracy). The largest part. Two model runs and their checks.
2. Step 2 (default dashboard and the audit).
3. Step 3 (units and wording).
4. Step 4 (new dashboard flow).
5. Step 5 (gate, run on the result).
6. Step 1d (hair removal themes) whenever Tom has reviewed the list. It does not block the rest.

Model cost for the whole plan: under $40 (comments, paid classification, accuracy judging).

## 5. Decisions, with my recommendation

- **Which template becomes the default?** "Toms No Hash", renamed. It is the only one with real themes.
- **Remove the other templates from the picker?** Yes. Keep them in the code so old dashboards work.
- **Guided setup?** Keep it, under "More ways to start". It is the customisation Tom says 10% will use.
- **Gifted posts: paid or earned?** Neither. Show them as their own group and leave them out of earned share. Tom should confirm.
- **Brand-owned accounts:** we need the handle list per brand. I can draft it from the data (accounts whose name contains the brand) for Tom or the team to confirm.
- **Written section answers:** generate monthly, not on every page load, so they cost tokens once.

## 6. What this plan does not fix

- The Culture lens. It needs a culture query from the data source.
- Comments for the nine snapshot industries. Their exports had posts only.
- Transcripts and visual tagging. Hooks stay caption-based.
- Purchase intent as a predictor of sales. The brief itself says that needs a client's sales data.

## 7. As built

Built as planned, with these differences:

- **Name.** The default template is "Tom's 8, Nov 8th" (`src/lib/tom8.ts`), written fresh against the brief and not as a rename of "Toms No Hash".
- **Written section answers are composed in SQL** from the section's own numbers, not written by a model. They are always current, cost no tokens and cannot say anything the tables do not.
- **Comments were read twice.** The first pass (small model) gave product attributes too freely: 58% agreement with the reviewer. A stricter second pass by a stronger model over the 8,732 brand and category comments took attributes to 87 to 90% and added `buying`, our own reading of a buying signal, which replaces the supplier's looser tag.
- **Giveaway posts count as gifted,** so they are not earned.
- **"No brand above 25%" cannot hold with fewer than six brands,** so the ownership line is 25% or one and a half times an even split.
- **The other templates are hidden, not removed.** Their numbers benefit from the corrected paid flag and the "about the brand" filter, because both are applied in the data and the views.
- **Step 1d (hair removal theme list) is not done.** It waits for Tom's review.
- **Model cost:** about $30 in all (posts 10 million input tokens, comments 2 million, second reading 0.7 million on the larger model, and four accuracy runs).

Results and what is still weak: `docs/quality-gate.md`.
