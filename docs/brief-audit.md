# Does the default dashboard answer the brief?

The first of Tom's three checks. It holds "Tom's 8, Nov 8th" (`src/lib/tom8.ts`) against his brief of 7 November 2026, sub-question by sub-question. Update it whenever the template or the data changes.

Each line has one of three results:

- **Answered:** built as the brief specifies.
- **Approximation:** built, with a stated difference.
- **Not possible yet:** the data does not hold what it needs. Nothing is faked.

Totals for the 39 sub-questions: 26 answered, 9 approximations, 4 not possible yet.

## The eight measures

- **Share of voice. Answered.** Brand posts divided by all tracked brands' posts, and "Share of voice, four ways" gives it by views, creators and engagements too. The "category" is the tracked brands, not the whole market.
- **Engagement vs norm. Answered.** Engagements divided by expected, where expected is reach (views, or followers for Instagram image posts) times the tracked brands' engagement rate for the platform and creator size. 1.2 and above is outperforming.
- **Momentum. Answered.** Posts in the period against the period before, minus 1. Viewing all time, it is the last 90 days against the 90 before, the brief's 3 months.
- **Earned share. Answered,** for the first time. Posts that are neither brand-owned, nor paid, nor sold for commission (affiliate), nor gifted, divided by all brand posts. Paid comes from the caption and the platform flag. Brand-owned comes from a drafted list of accounts (`docs/brand-accounts-draft.md`) that needs confirming. Gifted and affiliate posts are left out of earned: Tom to confirm.
- **Purchase intent. Answered.** Buying-signal comments per 1,000 brand comments, against rivals.
- **Praise and objections. Answered.** Positive and negative comments per 1,000 brand comments, by the brief's six attributes.
- **Content gap. Answered.** A theme's share of comments minus its share of posts.
- **Creator score. Approximation.** Engagement vs norm, theme fit and purchase intent are scored. Audience match is shown, not scored, because few creators have audience data.

Minimum samples are the brief's: 30 posts per theme and 200 comments behind a comment measure.

## Markets

The brief reads everything per market. A market filter on the period bar (the creator's country) applies to every box, the comparison and the AI analyst.

## Three lenses

- **Me. Answered.** Every element shows the brand.
- **Competitors. Answered.** Every element compares with the named rivals, like for like.
- **Culture. Not possible yet.** It needs a culture query beyond brand mentions. The dashboard says so in its closing note.

## 1. Which conversations are winning?

Output in the brief: 3 to 5 themes per market to build content around, with the format that works and our gap in each. **Built:** "The answer: themes to build content around" and "Content briefs for the top three themes". Set a market on the period bar and both, like every other box, are for that market.

1. **Which themes are growing fastest and performing best? Answered.** "Themes: momentum and engagement vs norm". Winning is growing and at 1.2 or more.
2. **Which are early signals, and which are peaking? Answered.** The status column of the same table. Early is 1.5 or more with momentum under 20%. Peaking is "fast growth" below the norm: we set fast at 50% or more, the brief gives no number.
3. **Which conversations sell, not just engage? Answered.** "Conversations that sell, not just engage".
4. **Where are we missing from winning themes? Answered.** "Where we are missing from winning themes", in points.
5. **Which formats and hooks win in each theme? Approximation.** "Formats that win" and "Hooks that win" are across themes. Per theme, the answer names the best hook only. Hooks are read from captions, not transcripts.
6. **What spiked, and why? Answered.** "What spiked, and why". Needs four months of history, so it shows for hair removal only.
7. **Which markets lead? Approximation.** "Markets that lead" gives momentum by creator country, and the market filter shows any theme inside one market. Where a theme grew first is not shown as one view.

## 2. Where is the white space?

Output in the brief: an "own it" list with the theme, proof, who is absent and the first brief. **Built:** "The answer: the 'own it' list".

1. **What does the audience reward that no brand owns? Answered,** with one stated change. The brief's "no brand above 25%" cannot be met when fewer than six brands are tracked, so the line is 25% or one and a half times an even split, whichever is higher.
2. **What do consumers ask about that creators don't cover? Answered.** "Content gap, in points".
3. **Which questions go unanswered? Answered.** "Questions about the brand that nobody answered", grouped by what they ask about. Questions about the creator are now left out.
4. **Which benefits does nobody claim? Answered.** "Benefits nobody claims": each attribute's share of the benefits claimed in captions against its share of the praise in brand comments. Captions are read by a model for the benefit they claim (hair removal only so far).
5. **Which audiences are under-served? Approximation.** By creator country only. The data has no audience age or gender per post.
6. **Which platforms are under-served? Approximation.** Share of posts by platform against rivals, not theme by platform.
7. **Which culture is open to us? Not possible yet.** Culture lens.

## 3. What do people say about us, our rivals and our products?

Output in the brief: for each brand and product, 3 things to amplify, 3 to answer and 3 to attack. **Built** at brand level: "The answer: what to amplify, answer and attack". Per product, "What people say, by product" gives praise, objections and buying signals for each product line, ours and rivals', from a drafted list of lines (`docs/product-lines-draft.md`) that needs confirming. The three-by-three answer itself is still per brand: the data has no product field.

1. **What do people love and hate? Answered.** "What people love and hate, by attribute".
2. **Which objections matter most? Answered.** "Objections that matter most": frequency plus likes.
3. **Where are they weak and we strong? Answered.** "Where rivals are weak and we are strong".
4. **Who switches to whom? Approximation.** "Who people compare us with" counts other brands named and who was favoured. It is not a flow between brands.
5. **What stops people buying? Answered.** "What stops people buying", grouped by attribute.
6. **What should the copy say? Answered.** "What the copy should say": the most-liked product comments per attribute.
7. **Are we saying what people value? Answered.** "Are we saying what people value?": what posts about us claim against what our audience praises.

Putting paid behind it: "Who reaches our buyer" shows the audience of our creators where known. Paid audience profiles are not built.

## 4. Which creators win in each conversation?

Output in the brief: a top 10 per theme, product and competitor. **Built** as a top 15 by creator score across the tracked brands, the top 3 per theme, and the top 3 per product line ("Who drives each product").

1. **Who drives each theme? Answered.** "Who drives each theme".
2. **Who drives buying? Answered.** "Who drives buying".
3. **Who is credible on the topic? Approximation.** Theme fit is in the creator score. Months active and comment tone are not.
4. **Who works with competitors? Answered.** "Who works with competitors", with whether a rival paid them.
5. **Who reaches our buyer? Approximation.** "Who reaches our buyer" for creators with audience data. There is no target audience to match against yet.
6. **Does performance hold when paid? Answered.** Now on corrected paid, gifted and earned posts.
7. **Who is good value? Answered.** "Who is good value", where fees are modelled.
8. **Who is rising? Answered.** "Rising creators", at 1.5 times the norm.
9. **Who leads a culture we want to enter? Not possible yet.** Culture lens.

Also added, because Tom called it out: "Earned creators: posting about us, never paid", which now leaves out paid, gifted and brand-owned posts.

## 5. What should we build or fix?

Output in the brief: the product priority grid. **Built:** "The answer: fix, protect, start talking about" and "Product priority grid".

1. **What do people wish existed? Answered.** "What people wish existed". Requests to the creator are left out.
2. **What is breaking, and is it getting worse? Answered.** By attribute over time. "Objections by product, ours and rivals'" says which product line an objection belongs to, without the trend.
3. **How do people actually use it? Answered.** "How people actually use it".
4. **What should we fix, protect or start talking about? Answered.** The grid.
5. **Where are competitor products weak? Answered.** "Where competitor products are weak: their 'fix first' box".
6. **How do people judge price and value? Approximation.** Price praise against price objections per brand. The prices people compare against are not extracted.
7. **Which variants do people want? Approximation.** Inside "What people wish existed" as the "variant" kind, not its own element.
8. **How did a launch land? Not possible yet.** The data has no launch dates.
9. **What should we make next? Not possible yet.** It needs what is growing in culture, which is the culture lens.

## What only one industry can show

Sections 3 and 5 and every comment measure need comments. Only hair removal has them. The other nine industries get the eight measures (without the three comment ones) and sections 1, 2 and 4.
