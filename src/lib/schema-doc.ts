import { focalName, getWorkspace } from "./brands";

/**
 * Dataset description given to the assistant. Built from the workspace (tracked brands, focal
 * brand, company, category), so it names nothing itself. Stable for a workspace: it is prompt-cached.
 */
export function datasetDoc(): string {
  const ws = getWorkspace();
  const focal = focalName();
  return `
# Dataset: creator posts and audience comments about ${ws.category ? `${ws.category} ` : ""}brands

${ws.company ? `Company: ${ws.company}. ` : ""}Focal brand: ${focal}. Tracked brands (column \`brand\`, exact strings):
${ws.brands.map((b) => `- '${b.name}' (${b.role})`).join("\n")}

"Us", "we" and "our brand" mean ${focal}. In SQL, focal_brand() returns the focal brand's name and is_competitor(brand) is true for every other tracked brand; is_self_mention(text) is true when a free-text brand name is the focal brand or one of its aliases. Prefer these functions to hardcoded brand names in dashboard elements, and write element titles in the first person ("our", "us"), so elements stay correct if the tracked brands change. Some tracked brands may have very few posts: check volumes before comparing rates.

${ws.hasComments === false ? "These brands have creator posts but NO audience comments: the comments table is empty for them. Do not propose elements built on comments (sentiment, purchase intent, objections, questions, requests); answer from posts, and say so when asked for something only comments could show.\n\n" : ""}${ws.industry && !ws.industry.live ? "The data for these brands is a fixed snapshot (a random sample of each brand's posts for the months listed in the context), so month-over-month comparisons are only possible inside those months.\n\n" : ""}Coverage, row counts and the period currently selected on the dashboard are given in the dashboard context of each message. Platforms: 'tiktok', 'instagram', 'youtube'.

Time periods: the dashboard has a global period. posts and comments are views that are already filtered to that period when a query runs (by the post's or the comment's own published_at). To look outside the period (previous-period benchmarks, lifetime totals, first-seen dates) query posts_all and comments_all, which are never filtered. period_start() and period_end() return the current window bounds as timestamptz (NULL when all time); use them with posts_all to build a previous-period benchmark, e.g. WHERE published_at >= period_start() - (period_end() - period_start()) AND published_at < period_start(). A widget whose SQL uses only posts/comments follows the period bar automatically; one that must ignore it can be proposed with period 'all'.

Standard measures. When asked for one of these, use this definition so numbers match the dashboards:
- Share of voice: a brand's posts divided by all tracked brands' posts.
- Engagement versus norm: sum(engagement) divided by sum(expected engagement), where a post's expected engagement is its reach (views; followers for Instagram image posts and posts without views) times the tracked brands' all-time engagement rate (sum(engagement) / sum(reach) over posts_all) for the same platform, creator tier and reach basis. 1.0 is the norm; 1.2 and above is outperforming.
- Momentum: posts in the period divided by posts in the period before, minus 1.
- Organic share: posts with is_paid false divided by all the brand's posts.
- Purchase intent, praise, objections: comments with purchase_intent_type set, with sentiment 'positive', or with objection_category set, per 1,000 comments.
- Theme: a hashtag in the post caption (regexp_matches(lower(text), '#([[:alnum:]_]{3,30})', 'g')), leaving out platform filler such as fyp and viral and hashtags that contain a tracked brand's name.
- Content gap: a theme's share of audience comments (sum of posts.comments) minus its share of posts, in points.

Classified posts: two more tables give every post the themes and hooks found in the words of its caption. post_themes(segment_id, post_id, brand, theme, is_primary) holds what a post is about, from a fixed list for the industry (count on is_primary so a post counts once; 'Other' and 'Unknown' are possible values); post_about(segment_id, post_id, brand, about) says whether the post is really about the brand ('yes', 'passing', 'no'), where that has been judged; post_hooks(segment_id, post_id, brand, hook) holds how it is told ('Tutorial or how-to', 'Review or first impressions', 'Routine or day in the life', 'Haul or unboxing', 'Comparison', 'Deal or promotion', 'News or announcement', 'Event coverage', 'Humour or entertainment', 'Opinion or commentary', 'Listing or sale advert', 'Giveaway or competition'). A post can have several of each, or none. Join to posts on (segment_id, post_id). Prefer these to hashtags when asked about themes or formats; list the themes with SELECT theme, count(*) FROM post_themes GROUP BY 1.

## Table posts (one row per creator post that mentions the brand)
post_id bigint, segment_id int, brand text, influencer_id bigint, username text, platform text, post_type text ('video'|'image'),
url text, title text (mostly null), text text (caption), published_at timestamptz,
likes, comments, shares, views, saves (double; views null for ~36 percent of rows),
engagement double (likes+comments+shares+saves), is_paid boolean (sponsored/ad disclosure, true for ~2.5 percent),
tier text ('nano'|'micro'|'mid'|'macro'|'mega' by follower count), country text (creator country, 'Unknown' when unknown),
language text (ISO code or 'unknown' for 64 percent), sentiment text ('positive'|'neutral'|'negative' of the post itself),
emv double (earned media value in USD), followers double (creator followers at the time), budget_min/budget_max double (estimated creator fee USD).
A post can appear under two brands when it mentions both (primary key is segment_id + post_id).

## Table comments (one row per audience comment on those posts, with an AI analysis of each comment)
comment_id bigint, segment_id int, brand text (brand of the post the comment is on), post_id bigint, username text, text text, likes, reply_count, published_at timestamptz,
sentiment text ('positive' 70 percent |'neutral'|'negative' 6 percent), sentiment_score double (0..1), emotion text ('happy'|'surprised'|'sad'|'angry'|'disgusted'|'fearful'|'other'),
language text (ISO code, 'und' unknown), topics text[] (free-form tags, thousands of distinct values, mostly reactions such as 'praise'; never chart them raw), keywords text[],
toxicity double, spam_rate double, moderation text (null or 'spam'|'sexual'|'hate'|'violence'|'other'), automated_response boolean,
authenticity_score double (0..1), authenticity_flag text (reason when low, e.g. 'emoji-only'),
purchase_intent_type text (null | 'explicit' | 'aspirational' | 'conditional'), purchase_intent_score double, purchase_blocker text (free text, e.g. 'price', 'out of stock', 'promo code not working'),
objection_category text (null | 'quality' | 'price' | 'shipping_availability' | 'trust_credibility' | 'comparison_based' | 'ethics' | 'ingredients_composition' | 'fit_sizing'), objection_context text, objection_phrase text (verbatim),
competitor_name text (another brand the commenter mentions, free text; may include the focal brand itself, filter with NOT is_self_mention(competitor_name)), competitor_favored text ('competitor'|'focal_brand'|'neither'|'unclear'; focal_brand means the brand of the post), competitor_mention_type text ('preference'|'comparison'|'rhetorical_putdown'),
loyalty_type text (null | 'advocacy' | 'long_term_use' | 'repeat_buyer' | 'other'), loyalty_phrase text, repeat_buyer boolean,
faq_topic text (the topic of a question, free text e.g. 'price','where_to_buy'; category-specific values, not normalised), faq_phrase text (the question verbatim),
feature_request_type text ('variant'|'feature'|'color'|'format'|'size'|'modification'|'other'), feature_request text,
safety_complaint_type text (free text, category-specific; null for most brands and categories), safety_severity text ('low'|'med'|'high'),
crisis_risk_type text (e.g. 'ad_fatigue','creator_credibility_callout','misinformation_callout','product_harm_claim'), crisis_urgency text ('low'|'med'|'high'), crisis_phrase text,
partnership_perception text (how the ad/partnership is perceived: 'ad_callout','authenticity_trust','skepticism_inconsistent_recs','positive_ad_execution','ad_fatigue_platform'...), partnership_intensity text ('low'|'med'|'high'),
brand_affinity_name text (other brands the commenter likes, free text), brand_affinity_category text, use_case text (non-standard product use described), use_case_segment text, caption_relevance double.
Most analysis columns are null for most rows; always filter IS NOT NULL before grouping on them.

## Table influencers (creator profile per brand)
segment_id int, brand text, influencer_id bigint, username text, fullname text, network text ('tiktok'|'instagram'|'youtube'), url text, picture text,
followers, engagements, engagement_rate (fraction, e.g. 0.02), avg_views double, is_verified boolean, imai_score double (0..100 quality score, mostly null),
country text (creator country), language text, ai_summary text (short bio, when available), has_report boolean,
audience_female double, audience_male double (fractions, present for a minority of creators), audience_ages jsonb (e.g. {"18-24":0.64,"25-34":0.24}), audience_countries jsonb (array of {name, weight}),
audience_credibility double, brand_safety_score double (0..100), avg_comment_sentiment double.
Join to posts on (segment_id, influencer_id).

## Table segments (one row per brand with precomputed AI strategy insights)
id int, name text, brand text, role text ('focal'|'competitor'),
insight_headline text, insight_framing text, insight_assess text, insight_act text, insight_anticipate text (HTML fragments with h3/ul/li/strong),
insights_by_platform jsonb ({tiktok:{headline,assess,act,anticipate}, instagram:{...}, youtube:{...}}),
comment_insights jsonb (per-platform payload with faq_gaps, objections, purchase_intent, loyalty_signals, crisis_backlash, safety_complaints, feature_requests, competitor_mentions, cross_brand_affinity, partnership_perception, use_case_discovery, engagement_quality, synthesis{summary, findings[]}),
total_emv, total_engagement, estimated_impressions, total_unique_influencers, invested_budget_min, invested_budget_max.
`.trim();
}
