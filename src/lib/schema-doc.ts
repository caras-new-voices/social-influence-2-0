import { BRANDS, CATEGORY, COMPANY, FOCAL_BRAND } from "./brands";

/** Dataset description given to the assistant. Keep stable: it is prompt-cached. */
export const DATASET_DOC = `
# Dataset: creator posts and audience comments about ${CATEGORY} brands

Company: ${COMPANY}. Focal brand: ${FOCAL_BRAND.name}. Tracked brands (column \`brand\`, exact strings):
${BRANDS.map((b) => `- '${b.name}' (${b.role}${b.name === "Mercadona" ? ", tiny sample of 24 posts: Spanish retailer's own-label razors" : ""})`).join("\n")}

Period: posts from 2025-10-01 to 2026-07-31 (a couple of stray August rows), comments to 2026-09-06. Platforms: 'tiktok', 'instagram', 'youtube'.
Row counts: posts 6,168 (Estrid 2,228, Philips OneBlade 1,715, Venus 1,597, Veet 331, Wilkinson Sword 273, Mercadona 24), comments 31,688, influencers 3,332 (one row per creator per brand), segments 6.

## Table posts (one row per creator post that mentions the brand)
post_id bigint, segment_id int, brand text, influencer_id bigint, username text, platform text, post_type text ('video'|'image'),
url text, title text (mostly null), text text (caption), published_at timestamptz,
likes, comments, shares, views, saves (double; views null for ~36 percent of rows),
engagement double (likes+comments+shares+saves), is_paid boolean (sponsored/ad disclosure, true for ~2.5 percent),
tier text ('nano'|'micro'|'mid'|'macro'|'mega' by follower count), country text (creator country, 'Unknown' when unknown; top: United Kingdom, Germany, Spain, France, Italy, Poland, Sweden),
language text (ISO code or 'unknown' for 64 percent), sentiment text ('positive'|'neutral'|'negative' of the post itself),
emv double (earned media value in USD), followers double (creator followers at the time), budget_min/budget_max double (estimated creator fee USD).
A post can appear under two brands when it mentions both (primary key is segment_id + post_id).

## Table comments (one row per audience comment on those posts, with an AI analysis of each comment)
comment_id bigint, segment_id int, brand text (brand of the post the comment is on), post_id bigint, username text, text text, likes, reply_count, published_at timestamptz,
sentiment text ('positive' 70 percent |'neutral'|'negative' 6 percent), sentiment_score double (0..1), emotion text ('happy'|'surprised'|'sad'|'angry'|'disgusted'|'fearful'|'other'),
language text (ISO code, 'und' unknown), topics text[] (free-form tags such as 'praise','price','availability','skincare'), keywords text[],
toxicity double, spam_rate double, moderation text (null or 'spam'|'sexual'|'hate'|'violence'|'other'), automated_response boolean,
authenticity_score double (0..1), authenticity_flag text (reason when low, e.g. 'emoji-only'),
purchase_intent_type text (null | 'explicit' | 'aspirational' | 'conditional'), purchase_intent_score double, purchase_blocker text (free text, e.g. 'price', 'out of stock', 'promo code not working'),
objection_category text (null | 'quality' | 'price' | 'shipping_availability' | 'trust_credibility' | 'comparison_based' | 'ethics' | 'ingredients_composition' | 'fit_sizing'), objection_context text, objection_phrase text (verbatim),
competitor_name text (another brand the commenter mentions, free text e.g. 'FFS','Wilkinson','Superdrug','Dove'), competitor_favored text ('competitor'|'focal_brand'|'neither'|'unclear'; focal_brand means the brand of the post), competitor_mention_type text ('preference'|'comparison'|'rhetorical_putdown'),
loyalty_type text (null | 'advocacy' | 'long_term_use' | 'repeat_buyer' | 'other'), loyalty_phrase text, repeat_buyer boolean,
faq_topic text (an unanswered question topic, e.g. 'price','where_to_buy','product_source','replacement_blades'), faq_phrase text (the question verbatim),
feature_request_type text ('variant'|'feature'|'color'|'format'|'size'|'modification'|'other'), feature_request text,
safety_complaint_type text (e.g. 'skin_irritation','cuts_nicks','rash','bumps_pimples','ingrowns'), safety_severity text ('low'|'med'|'high'),
crisis_risk_type text (e.g. 'ad_fatigue','creator_credibility_callout','misinformation_callout','product_harm_claim'), crisis_urgency text ('low'|'med'|'high'), crisis_phrase text,
partnership_perception text (how the ad/partnership is perceived: 'ad_callout','authenticity_trust','skepticism_inconsistent_recs','positive_ad_execution','ad_fatigue_platform'...), partnership_intensity text ('low'|'med'|'high'),
brand_affinity_name text (other brands the commenter likes, e.g. 'CeraVe'), brand_affinity_category text, use_case text (non-standard product use described), use_case_segment text, caption_relevance double.
Most analysis columns are null for most rows; always filter IS NOT NULL before grouping on them.

## Table influencers (creator profile per brand)
segment_id int, brand text, influencer_id bigint, username text, fullname text, network text ('tiktok'|'instagram'|'youtube'), url text, picture text,
followers, engagements, engagement_rate (fraction, e.g. 0.02), avg_views double, is_verified boolean, imai_score double (0..100 quality score, mostly null),
country text (creator country), language text, ai_summary text (short bio, when available), has_report boolean,
audience_female double, audience_male double (fractions, ~540 rows), audience_ages jsonb (e.g. {"18-24":0.64,"25-34":0.24}), audience_countries jsonb (array of {name, weight}),
audience_credibility double, brand_safety_score double (0..100), avg_comment_sentiment double.
Join to posts on (segment_id, influencer_id).

## Table segments (one row per brand with precomputed AI strategy insights)
id int, name text, brand text, role text ('focal'|'competitor'), brandwatch_query text,
insight_headline text, insight_framing text, insight_assess text, insight_act text, insight_anticipate text (HTML fragments with h3/ul/li/strong),
insights_by_platform jsonb ({tiktok:{headline,assess,act,anticipate}, instagram:{...}, youtube:{...}}),
comment_insights jsonb (per-platform payload with faq_gaps, objections, purchase_intent, loyalty_signals, crisis_backlash, safety_complaints, feature_requests, competitor_mentions, cross_brand_affinity, partnership_perception, use_case_discovery, engagement_quality, synthesis{summary, findings[]}),
total_emv, total_engagement, estimated_impressions, total_unique_influencers, invested_budget_min, invested_budget_max.
`.trim();
