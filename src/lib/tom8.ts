import type { StarterCondition, StarterSection } from "./starter";
import { BOUNDS, HASH_OK, LABEL_TAGS, N_AUDIENCE, N_COMPETITORS, N_FEES, N_HISTORY, N_HOOKS, N_LONG_HISTORY, N_THEMED, NOT_SELF, REACH, SCORED, VERSUS, WINDOW_POSTS, r0, r1, r2, vs } from "./tom";

/**
 * "Tom's 8, Nov 8th": the default dashboard, built to Tom's brief of 7 November 2026 ("Social
 * intelligence: from conversation to content, creators and product"). Eight measures calculated
 * the same way every month, then his five questions in his order. Each section opens with a
 * written answer composed from the numbers below it, and ends in the output the brief names.
 * See docs/toms-feedback-plan.md and docs/brief-audit.md.
 *
 * What makes it different from the earlier templates:
 *  - Themes come from the post classifier (a fixed list per industry), not hashtags.
 *  - Posts not about the brand are already out of the posts views.
 *  - Paid, affiliate, gifted and brand-owned posts are told apart (is_paid from the caption or
 *    the supplied flag, is_affiliate, is_gifted, is_owned), so earned share is Tom's: unprompted.
 *  - Comment measures count comments about the brand or its category only (brand_comments), and
 *    attributes are Tom's six: price, efficacy, ease, durability, safety, service.
 *  - The brief's thresholds: winning = growing and 1.2 times the norm; early = 1.5 with momentum
 *    under 20%; peaking = fast growth below the norm; 30 posts per theme; 200 comments behind a
 *    comment measure.
 *  - One vocabulary: engagements (a count), engagement rate (a percentage of reach), engagement
 *    vs norm (a ratio, 1.0 is the norm). Every title or subtitle names the measure and its base.
 *
 * Like the other templates it names no brand or category.
 */

const THEME_MIN = 30;
const COMMENT_MIN = 200;

/** A post that is neither paid, affiliate, gifted nor from the brand's own account. */
const EARNED = "NOT is_paid AND NOT is_owned AND NOT is_gifted AND NOT is_affiliate";
/** What kind of post it is, for charts: one label per post. */
const KIND = (a = "") => `CASE WHEN ${a}is_owned THEN 'Brand-owned' WHEN ${a}is_paid AND ${a}paid_basis = 'flag' THEN 'Paid: platform label only' WHEN ${a}is_paid THEN 'Paid: disclosed in the caption' WHEN ${a}is_affiliate THEN 'Affiliate or shop' WHEN ${a}is_gifted THEN 'Gifted' ELSE 'Earned' END`;
const NEGATIVE = "(sentiment = 'negative' OR objection_category IS NOT NULL)";
const POSITIVE = "sentiment = 'positive'";
/** A buying signal: the classifier's reading where there is one, else the supplied tag. */
const INTENT = "coalesce(buying, purchase_intent_type IS NOT NULL)";
const ATTR = (col = "attribute") => `CASE ${col} WHEN 'price' THEN 'Price and value' WHEN 'efficacy' THEN 'Efficacy: does it work' WHEN 'ease' THEN 'Ease of use' WHEN 'durability' THEN 'Durability' WHEN 'safety' THEN 'Safety and comfort' WHEN 'service' THEN 'Service and availability' END`;

const ER_NOTE = "Engagement rate is engagements divided by reach (views; followers for Instagram image posts)";
const VS_NOTE = "Engagement vs norm compares engagements with what the platform and creator size normally earn across the tracked brands: 1.0 is the norm, 1.2 and above is outperforming";
const BC_NOTE = "Brand comments are comments about the brand, its product or the category. Comments about the creator, other things in the post, and empty ones are left out";
const THEME_NOTE = "A theme is what a post is about, from a fixed list for the industry";

/** Posts whose caption has been read for a product line or a claimed benefit. */
const N_PRODUCTS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM posts_all WHERE product IS NOT NULL`, min: 50, what: "posts filed under a product line" };
const N_CLAIMS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM posts_all WHERE claims IS NOT NULL`, min: 50, what: "posts that claim a benefit" };
const N_OUR_CLAIMS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM posts_all WHERE claims IS NOT NULL AND brand = focal_brand()`, min: 30, what: "of our posts that claim a benefit" };
const PRODUCT_NOTE = "A product line is read from the caption (posts) or from the comment next to its caption (brand comments), from a drafted list per brand. Posts and comments that name no line are left out";
/**
 * What creators claim against what the audience praises, per attribute. j(attribute, claims, praise, cs, ps):
 * counts, and each attribute's share of all claims and of all attribute praise, in percent.
 */
const CLAIM_GAP = (who: string) => `cl AS (SELECT a AS attribute, count(*)::float AS n FROM posts, unnest(claims) AS a WHERE ${who} GROUP BY 1),
pr AS (SELECT attribute, count(*)::float AS n FROM brand_comments WHERE attribute IS NOT NULL AND ${POSITIVE} AND ${who} GROUP BY 1),
att AS (SELECT unnest(ARRAY['price', 'efficacy', 'ease', 'durability', 'safety', 'service']) AS attribute),
j AS (
  SELECT att.attribute, coalesce(cl.n, 0) AS claims, coalesce(pr.n, 0) AS praise,
         100.0 * coalesce(cl.n, 0) / NULLIF((SELECT sum(n) FROM cl), 0) AS cs, 100.0 * coalesce(pr.n, 0) / NULLIF((SELECT sum(n) FROM pr), 0) AS ps
  FROM att LEFT JOIN cl USING (attribute) LEFT JOIN pr USING (attribute)
)`;

/**
 * Per product line with enough brand comments for a rate: ptot(brand, product, n) and
 * par(brand, product, attribute, n, pos, neg, total). The product twin of ATTR_RATES.
 */
const PRODUCT_RATES = `ptot AS MATERIALIZED (SELECT brand, product, count(*)::float AS n FROM brand_comments WHERE product IS NOT NULL GROUP BY 1, 2 HAVING count(*) >= ${COMMENT_MIN}),
par AS MATERIALIZED (
  SELECT c.brand, c.product, c.attribute, count(*)::float AS n, count(*) FILTER (WHERE ${POSITIVE})::float AS pos, count(*) FILTER (WHERE ${NEGATIVE})::float AS neg, ptot.n AS total
  FROM brand_comments c JOIN ptot USING (brand, product) WHERE c.attribute IS NOT NULL GROUP BY 1, 2, 3, ptot.n
)`;
const N_PRODUCT_COMMENTS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM (SELECT 1 FROM brand_comments_all WHERE product IS NOT NULL GROUP BY brand, product HAVING count(*) >= ${COMMENT_MIN}) x`, min: 1, what: `product line with ${COMMENT_MIN} or more brand comments` };
const N_SWITCHES: StarterCondition = { sql: `SELECT count(*)::int AS n FROM brand_comments_all WHERE switch_kind IS NOT NULL`, min: 20, what: "brand comments that compare two brands or methods" };
const PRODUCT_RATE_NOTE = `Only product lines with ${COMMENT_MIN}+ brand comments are shown, the minimum behind a comment measure`;

/**
 * The words a conversation uses, for paid keyword targeting: kw(theme, tags), the six hashtags most
 * posts of the theme carry (3+ posts), without brand names and platform filler. Needs tp(theme, post columns).
 */
const THEME_KEYWORDS = `kw AS (
  SELECT theme, string_agg('#' || tag, ' ' ORDER BY n DESC, tag) AS tags FROM (
    SELECT theme, tag, n, row_number() OVER (PARTITION BY theme ORDER BY n DESC, tag) AS rk FROM (
      SELECT tp.theme, m[1] AS tag, count(DISTINCT tp.post_id) AS n
      FROM tp, LATERAL regexp_matches(lower(tp.text), '#([[:alnum:]_]{3,30})', 'g') AS m WHERE tp.text LIKE '%#%' GROUP BY 1, 2 HAVING count(DISTINCT tp.post_id) >= 3
    ) a WHERE ${HASH_OK("tag")}
  ) b WHERE rk <= 6 GROUP BY 1
)`;

/** Brand comments on our content in the period: the sample behind comment elements. */
const OUR_BC = { sql: `SELECT count(*)::int AS n FROM brand_comments WHERE brand = focal_brand()`, min: COMMENT_MIN, unit: "brand comments on our content" };
const N_BC: StarterCondition = { sql: `SELECT count(*)::int AS n FROM brand_comments_all WHERE brand = focal_brand()`, min: COMMENT_MIN, what: "comments about the brand on our content" };
const N_PAID: StarterCondition = { sql: `SELECT count(*)::int AS n FROM posts_all WHERE brand = focal_brand() AND is_paid`, min: 20, what: "posts with a paid disclosure" };
const N_REQUESTS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM brand_comments_all WHERE brand = focal_brand() AND feature_request_type IS NOT NULL`, min: 15, what: "brand comments asking for a product change" };
const N_USE_CASES: StarterCondition = { sql: `SELECT count(*)::int AS n FROM brand_comments_all WHERE brand = focal_brand() AND use_case_segment IS NOT NULL`, min: 15, what: "brand comments describing how the product is used" };
const N_RIVAL_MENTIONS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM brand_comments_all WHERE brand = focal_brand() AND competitor_name IS NOT NULL AND ${NOT_SELF("competitor_name")}`, min: 15, what: "brand comments naming another brand" };
const N_BLOCKERS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM brand_comments_all WHERE brand = focal_brand() AND (purchase_blocker IS NOT NULL OR purchase_intent_type = 'conditional')`, min: 10, what: "brand comments naming what stops a purchase" };
const N_QUESTIONS: StarterCondition = { sql: `SELECT count(*)::int AS n FROM brand_comments_all WHERE brand = focal_brand() AND faq_topic IS NOT NULL`, min: 15, what: "questions about the brand in our comments" };

/**
 * Themes in the current window against the one before, with the brief's status. Columns of `c`:
 * theme, posts, before, mom (momentum as a fraction, null without history), vs, er, ours, share
 * (our overall share of posts), status. Needs nothing before it.
 */
const THEMES = `${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")}, ${LABEL_TAGS("sp")},
t AS (
  SELECT theme, count(*) FILTER (WHERE cur)::float AS posts, count(*) FILTER (WHERE NOT cur)::float AS before, ${vs("cur")} AS vs,
         sum(engagement) FILTER (WHERE cur) / NULLIF(sum(${REACH("tags")}) FILTER (WHERE cur), 0) AS er,
         count(*) FILTER (WHERE cur AND brand = focal_brand())::float AS ours, count(DISTINCT brand) FILTER (WHERE cur)::int AS brands
  FROM tags GROUP BY 1
), o AS MATERIALIZED (SELECT count(*) FILTER (WHERE cur AND brand = focal_brand())::float / NULLIF(count(*) FILTER (WHERE cur), 0) AS share FROM w),
c0 AS MATERIALIZED (SELECT t.*, o.share, CASE WHEN t.before >= 3 THEN t.posts / t.before - 1 END AS mom FROM t, o WHERE t.posts >= ${THEME_MIN}),
c AS MATERIALIZED (
  SELECT c0.*, CASE WHEN vs >= 1.5 AND mom IS NOT NULL AND mom < 0.2 THEN 'early signal'
                    WHEN vs >= 1.2 AND mom > 0 THEN 'winning'
                    WHEN mom >= 0.5 AND vs < 1 THEN 'peaking'
                    WHEN vs >= 1.2 THEN 'above norm' WHEN vs < 0.8 THEN 'below norm' ELSE 'steady' END AS status
  FROM c0
)`;
const STATUS_NOTE = "Winning: growing, and engagement at 1.2 times the norm or more. Early signal: 1.5 times the norm while momentum is under 20%. Peaking: growing 50% or more with engagement below the norm";

/**
 * The hook with the best engagement vs norm in each theme (5+ posts, at the norm or above): bh(theme, hook, hvs). Needs `sp`.
 * A shop listing or a giveaway is not a way to tell a story, so neither is recommended.
 */
const BEST_HOOK = (where = "TRUE") => `bh AS MATERIALIZED (
  SELECT DISTINCT ON (theme) theme, hook, hvs FROM (
    SELECT pt.theme, ph.hook, sum(sp.eng_s) / NULLIF(sum(sp.expected), 0) AS hvs, count(*) AS n
    FROM sp JOIN post_themes pt ON pt.segment_id = sp.segment_id AND pt.post_id = sp.post_id AND pt.is_primary
            JOIN post_hooks ph ON ph.segment_id = sp.segment_id AND ph.post_id = sp.post_id
    WHERE ${where} AND ph.hook NOT IN ('Listing or sale advert', 'Giveaway or competition')
    GROUP BY 1, 2 HAVING count(*) >= 5
  ) x WHERE hvs >= 1 ORDER BY theme, hvs DESC
)`;

/** Per brand and attribute: brand comments, praise and objections per 1,000 of the brand's brand comments. ar(brand, attribute, n, pos, neg, total). */
const ATTR_RATES = `tot AS MATERIALIZED (SELECT brand, count(*)::float AS n FROM brand_comments GROUP BY 1 HAVING count(*) >= ${COMMENT_MIN} OR brand = focal_brand()),
ar AS MATERIALIZED (
  SELECT c.brand, c.attribute, count(*)::float AS n, count(*) FILTER (WHERE ${POSITIVE})::float AS pos, count(*) FILTER (WHERE ${NEGATIVE})::float AS neg, tot.n AS total
  FROM brand_comments c JOIN tot USING (brand) WHERE c.attribute IS NOT NULL GROUP BY 1, 2, tot.n
)`;

/** The priority grid: each attribute of `who` placed by how often it comes up and how people feel. Needs ATTR_RATES. */
const GRID = (who: string) => `g AS (
  SELECT brand, attribute, n AS mentions, 1000.0 * n / total AS per_k, (pos - neg) / n AS net, neg
  FROM ar WHERE ${who} AND n >= 5
), gb AS MATERIALIZED (
  SELECT brand, percentile_cont(0.5) WITHIN GROUP (ORDER BY mentions) AS med, sum(net * mentions) / NULLIF(sum(mentions), 0) AS avg_net FROM g GROUP BY 1
), grid AS (
  SELECT g.*, gb.avg_net, CASE WHEN g.mentions >= gb.med AND g.net < gb.avg_net THEN 'Fix first' WHEN g.mentions >= gb.med THEN 'Protect'
                               WHEN g.net >= gb.avg_net THEN 'Start talking about' ELSE 'Watch' END AS box
  FROM g JOIN gb USING (brand)
)`;

/**
 * Creator score, the eighth measure. Per creator across the tracked brands (brand-owned accounts
 * left out, 2+ posts): engagement vs norm, theme fit (share of their posts in their main theme),
 * and buying signals in the brand comments under their posts. Performance and buying signals are
 * taken as the creator's rank among all scored creators (0 to 1), so one viral post cannot max the
 * score. Score out of 100 = 40% performance + 20% buying signals (performance again when they
 * have under 20 brand comments) + 15% theme fit + 10% audience match + 10% value (how their
 * modelled fee per engagement ranks, cheapest best) + 5% availability (nothing unless a rival has
 * paid them), scaled down for creators with few posts (60% at 2 posts, full at 5). Audience match
 * is the share of the creator's audience inside the dashboard's target audience (gender, ages,
 * markets: the average of the parts that are set). It counts as a neutral half when the dashboard
 * has no target or the creator's audience is not known, so nobody is punished for missing data.
 * (The CASE around least() matters: least() skips NULLs, so without it "no target" would read as a full match.)
 * cs(creator, platform, posts, ours, theirs, brands, vs, theme, fit, intent_k, rel, fee, avail, match, score).
 */
const CREATOR_SCORE = `${SCORED("posts")},
cp AS (
  SELECT DISTINCT ON (sp.segment_id, sp.post_id) sp.*, pt.theme
  FROM sp LEFT JOIN post_themes pt ON pt.segment_id = sp.segment_id AND pt.post_id = sp.post_id AND pt.is_primary
  WHERE sp.username IS NOT NULL AND NOT sp.is_owned ORDER BY sp.segment_id, sp.post_id, pt.theme
),
pc AS MATERIALIZED (SELECT segment_id, post_id, count(*)::float AS n, count(*) FILTER (WHERE ${INTENT})::float AS intent FROM brand_comments GROUP BY 1, 2),
au AS MATERIALIZED (
  SELECT DISTINCT ON (i.username, i.network) i.username, i.network, i.audience_female, i.audience_ages, i.audience_countries
  FROM influencers i WHERE i.audience_female IS NOT NULL AND i.username IS NOT NULL ORDER BY i.username, i.network, i.segment_id
), am0 AS (
  SELECT au.username, au.network,
         CASE target_gender() WHEN 'women' THEN au.audience_female WHEN 'men' THEN 1 - au.audience_female END AS g,
         CASE WHEN target_ages() IS NOT NULL AND jsonb_typeof(au.audience_ages) = 'object' THEN (SELECT coalesce(sum(e.value::float), 0) FROM jsonb_each_text(au.audience_ages) e WHERE e.key = ANY(target_ages())) END AS a,
         CASE WHEN target_markets() IS NOT NULL AND jsonb_typeof(au.audience_countries) = 'array' THEN (SELECT coalesce(sum((c.value ->> 'weight')::float), 0) FROM jsonb_array_elements(au.audience_countries) c WHERE c.value ->> 'name' = ANY(target_markets())) END AS m
  FROM au
), am AS MATERIALIZED (
  SELECT username, network, CASE WHEN g IS NOT NULL OR a IS NOT NULL OR m IS NOT NULL
         THEN least(1.0, (coalesce(g, 0) + coalesce(a, 0) + coalesce(m, 0)) / ((g IS NOT NULL)::int + (a IS NOT NULL)::int + (m IS NOT NULL)::int)) END AS match FROM am0
),
ct AS (SELECT username, platform, theme, count(*) AS n, row_number() OVER (PARTITION BY username, platform ORDER BY count(*) DESC, theme) AS rk FROM cp WHERE theme IS NOT NULL AND theme NOT IN ('Other', 'Unknown') GROUP BY 1, 2, 3),
ca AS (
  SELECT cp.username AS creator, cp.platform AS platform, count(*)::int AS posts,
         count(*) FILTER (WHERE cp.brand = focal_brand())::int AS ours, count(*) FILTER (WHERE cp.brand <> focal_brand())::int AS theirs,
         string_agg(DISTINCT cp.brand, ', ') AS brands, sum(cp.eng_s) / NULLIF(sum(cp.expected), 0) AS vs,
         bool_or(cp.is_paid AND cp.brand = focal_brand()) AS paid_by_us, bool_or(cp.is_gifted AND cp.brand = focal_brand()) AS gifted_by_us,
         bool_or(cp.is_affiliate AND cp.brand = focal_brand()) AS affiliate_of_ours,
         bool_or(cp.is_paid AND cp.brand <> focal_brand()) AS paid_by_rival,
         avg((cp.budget_min + cp.budget_max) / 2.0) AS fee,
         sum((cp.budget_min + cp.budget_max) / 2.0) / NULLIF(sum(cp.engagement) FILTER (WHERE cp.budget_min IS NOT NULL AND cp.budget_max IS NOT NULL), 0) AS fee_per_eng,
         sum(pc.n) AS c_n, sum(pc.intent) AS c_intent
  FROM cp LEFT JOIN pc ON pc.segment_id = cp.segment_id AND pc.post_id = cp.post_id GROUP BY 1, 2 HAVING count(*) >= 2
), cr AS (
  SELECT ca.*, percent_rank() OVER (ORDER BY ca.vs) AS p_vs,
         CASE WHEN ca.fee_per_eng IS NOT NULL THEN 1 - percent_rank() OVER (PARTITION BY (ca.fee_per_eng IS NOT NULL) ORDER BY ca.fee_per_eng) END AS p_value,
         CASE WHEN ca.c_n >= 20 THEN percent_rank() OVER (PARTITION BY (ca.c_n >= 20) ORDER BY ca.c_intent / NULLIF(ca.c_n, 0)) END AS p_intent
  FROM ca WHERE ca.vs IS NOT NULL
), cs AS MATERIALIZED (
  SELECT cr.creator, cr.platform, cr.posts, cr.ours, cr.theirs, cr.brands, cr.vs, ct.theme, ct.n::float / cr.posts AS fit,
         CASE WHEN cr.c_n >= 20 THEN 1000.0 * cr.c_intent / cr.c_n END AS intent_k,
         CASE WHEN cr.ours = 0 THEN 'rivals only' WHEN cr.paid_by_us THEN 'paid by us' WHEN cr.affiliate_of_ours THEN 'sells us for commission' WHEN cr.gifted_by_us THEN 'gifted by us' ELSE 'unpaid' END AS rel,
         cr.fee, CASE WHEN cr.paid_by_rival THEN 'paid by a rival' WHEN cr.theirs > 0 THEN 'posts about a rival, unpaid' ELSE 'no rival ties' END AS avail, am.match,
         100 * (0.40 * cr.p_vs + 0.20 * coalesce(cr.p_intent, cr.p_vs) + 0.15 * coalesce(ct.n::float / cr.posts, 0) + 0.10 * coalesce(am.match, 0.5) + 0.10 * coalesce(cr.p_value, 0.5) + 0.05 * CASE WHEN cr.paid_by_rival THEN 0 ELSE 1 END)
           * (0.6 + 0.4 * least(cr.posts - 2, 3) / 3.0) AS score
  FROM cr LEFT JOIN ct ON ct.username = cr.creator AND ct.platform IS NOT DISTINCT FROM cr.platform AND ct.rk = 1
          LEFT JOIN am ON am.username = cr.creator AND am.network = cr.platform
)`;
const SCORE_NOTE = "Creator score, out of 100: 40% is how their engagement vs norm ranks among all creators, 20% how the buying signals under their posts rank (where they have 20+ brand comments), 15% theme fit, 10% audience match (the share of their audience inside the target audience set under Brands; a neutral half when no target is set or their audience is not known), 10% value (their modelled fee per engagement, cheapest best) and 5% availability (lost when a rival has paid them). It counts for less when a creator has few posts. Creators with 2+ posts on one platform, and a creator on two platforms is scored for each; brand-owned accounts are left out";

const li = (parts: string) => `'<li>' || ${parts} || '</li>'`;
const pct = (expr: string) => `round((100.0 * (${expr}))::numeric, 0)`;
const x2 = (expr: string) => `to_char(round((${expr})::numeric, 2), 'FM990.00') || '×'`;

/**
 * A brief per picked theme: why now, our gap, how to tell it, who should tell it, where, the paid
 * audience and targeting, the audience's words and the objection to answer. `pick` is a CTE named
 * pick over c (see THEMES) with a rank rk; the first three are briefed.
 */
const BRIEFS = (pick: string, none: string, noneBody: string, noun: string) => `WITH ${THEMES}, ${BEST_HOOK("sp.cur")},
${pick},
top AS MATERIALIZED (SELECT * FROM pick WHERE rk <= 3),
tp AS MATERIALIZED (SELECT tags.* FROM tags JOIN top USING (theme) WHERE tags.cur),
fmt AS (
  SELECT DISTINCT ON (theme) theme, format, fvs FROM (
    SELECT theme, platform || ' ' || post_type AS format, sum(eng_s) / NULLIF(sum(expected), 0) AS fvs FROM tp
    WHERE platform IS NOT NULL AND post_type IS NOT NULL GROUP BY 1, 2 HAVING count(*) >= 5
  ) x WHERE fvs IS NOT NULL ORDER BY theme, fvs DESC
), cr AS (
  SELECT theme, username, sum(eng_s) / NULLIF(sum(expected), 0) AS cvs FROM tp WHERE username IS NOT NULL AND NOT is_owned GROUP BY 1, 2 HAVING count(*) >= 2
), crr AS (
  SELECT theme, string_agg(username || ' (' || ${x2("cvs")} || ')', ', ' ORDER BY cvs DESC) AS names
  FROM (SELECT cr.*, row_number() OVER (PARTITION BY theme ORDER BY cvs DESC) AS k FROM cr WHERE cvs >= 1) y WHERE k <= 3 GROUP BY 1
), mk AS (
  SELECT theme, string_agg(country || ' (' || n || ' posts)', ', ' ORDER BY n DESC) AS markets
  FROM (SELECT theme, country, count(*) AS n, row_number() OVER (PARTITION BY theme ORDER BY count(*) DESC) AS k FROM tp WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY 1, 2) z WHERE k <= 3 GROUP BY 1
), bc AS MATERIALIZED (
  SELECT tp.theme, (tp.brand = focal_brand()) AS ours, c.text, coalesce(c.likes, 0) AS likes, c.sentiment, c.attribute, c.objection_category
  FROM brand_comments c JOIN tp ON tp.segment_id = c.segment_id AND tp.post_id = c.post_id
), quote AS (SELECT DISTINCT ON (theme) theme, left(text, 150) AS said FROM bc WHERE ours AND sentiment = 'positive' AND attribute IS NOT NULL AND length(text) >= 25 ORDER BY theme, likes DESC, text),
obj AS (SELECT DISTINCT ON (theme) theme, attribute, n FROM (SELECT theme, attribute, count(*) AS n FROM bc WHERE attribute IS NOT NULL AND ${NEGATIVE} GROUP BY 1, 2) q WHERE n >= 5 ORDER BY theme, n DESC, attribute),
ai AS MATERIALIZED (
  SELECT DISTINCT ON (tp.theme, i.influencer_id) tp.theme, i.influencer_id, i.audience_female, i.audience_ages, i.audience_countries
  FROM tp JOIN influencers i ON i.segment_id = tp.segment_id AND i.influencer_id = tp.influencer_id
  WHERE NOT tp.is_owned AND i.audience_female IS NOT NULL AND jsonb_typeof(i.audience_ages) = 'object'
  ORDER BY tp.theme, i.influencer_id, i.segment_id
), an AS (SELECT theme, count(*)::float AS k, avg(audience_female) AS female FROM ai GROUP BY 1 HAVING count(*) >= 5),
ages AS (
  SELECT theme, string_agg(band || ' (' || ${pct("w")} || '%)', ' and ' ORDER BY w DESC) AS bands
  FROM (SELECT ai.theme, e.key AS band, sum(e.value::float) / an.k AS w, row_number() OVER (PARTITION BY ai.theme ORDER BY sum(e.value::float) DESC) AS rk
        FROM ai JOIN an USING (theme), jsonb_each_text(ai.audience_ages) e GROUP BY ai.theme, e.key, an.k) y WHERE rk <= 2 GROUP BY 1
), geo AS (
  SELECT theme, string_agg(country || ' (' || ${pct("w")} || '%)', ', ' ORDER BY w DESC) AS places
  FROM (SELECT ai.theme, c.value ->> 'name' AS country, sum((c.value ->> 'weight')::float) / an.k AS w, row_number() OVER (PARTITION BY ai.theme ORDER BY sum((c.value ->> 'weight')::float) DESC) AS rk
        FROM ai JOIN an USING (theme), jsonb_array_elements(CASE WHEN jsonb_typeof(ai.audience_countries) = 'array' THEN ai.audience_countries ELSE '[]'::jsonb END) c
        WHERE c.value ->> 'name' IS NOT NULL GROUP BY ai.theme, c.value ->> 'name', an.k) z WHERE rk <= 3 GROUP BY 1
),
${THEME_KEYWORDS},
n AS (SELECT count(*) AS k FROM top)
SELECT CASE WHEN n.k = 0 THEN '${none}' ELSE n.k || CASE WHEN n.k = 1 THEN ' ${noun}' ELSE ' ${noun}s' END END AS headline,
       CASE WHEN n.k = 0 THEN '<p>${noneBody}</p>'
       ELSE (SELECT string_agg(
         '<h3>' || top.rk || '. ' || top.theme || '</h3><ul>'
         || ${li(`'<strong>Why now:</strong> engagement ' || ${x2("top.vs")} || ' the norm over ' || top.posts::int || ' posts' || CASE WHEN top.mom IS NOT NULL THEN ', posts ' || CASE WHEN top.mom >= 0 THEN 'up ' ELSE 'down ' END || ${pct("abs(top.mom)")} || '%' ELSE '' END || ' (' || top.status || ').'`)}
         || ${li(`'<strong>Our gap:</strong> we have ' || ${pct("top.ours / top.posts")} || '% of its posts against ' || ${pct("top.share")} || '% of all posts in the same period.'`)}
         || CASE WHEN bh.hook IS NOT NULL OR fmt.format IS NOT NULL THEN ${li(`'<strong>How to tell it:</strong> ' || CASE WHEN bh.hook IS NOT NULL THEN 'told as ' || lower(bh.hook) || ' (' || ${x2("bh.hvs")} || ' the norm)' ELSE '' END || CASE WHEN bh.hook IS NOT NULL AND fmt.format IS NOT NULL THEN ', ' ELSE '' END || CASE WHEN fmt.format IS NOT NULL THEN 'best on ' || fmt.format || ' (' || ${x2("fmt.fvs")} || ')' ELSE '' END || '.'`)} ELSE '' END
         || CASE WHEN crr.names IS NOT NULL THEN ${li(`'<strong>Who should tell it:</strong> ' || crr.names || '. The figure is engagement vs norm on their posts in this theme.'`)} ELSE '' END
         || CASE WHEN mk.markets IS NOT NULL THEN ${li(`'<strong>Where:</strong> ' || mk.markets || '.'`)} ELSE '' END
         || CASE WHEN an.k IS NOT NULL THEN ${li(`'<strong>Paid audience:</strong> ' || CASE WHEN an.female >= 0.5 THEN ${pct("an.female")} || '% women' ELSE ${pct("1 - an.female")} || '% men' END || coalesce(', mostly aged ' || ages.bands, '') || coalesce(', in ' || geo.places, '') || '. The average audience of the ' || an.k::int || ' creators behind this theme whose audience is known.'`)} ELSE '' END
         || CASE WHEN kw.tags IS NOT NULL OR crr.names IS NOT NULL THEN ${li(`'<strong>Paid targeting:</strong> ' || coalesce('keywords from the conversation: ' || kw.tags || '. ', '') || CASE WHEN crr.names IS NOT NULL THEN 'Run partnership ads from the handles of the creators above, and build lookalike audiences from their followers.' ELSE '' END`)} ELSE '' END
         || CASE WHEN quote.said IS NOT NULL THEN ${li(`'<strong>In their words:</strong> “' || quote.said || '”'`)} ELSE '' END
         || CASE WHEN obj.attribute IS NOT NULL THEN ${li(`'<strong>Objection to answer:</strong> ' || lower(coalesce(${ATTR("obj.attribute")}, obj.attribute)) || ' (' || obj.n || ' comments).'`)} ELSE '' END
         || '</ul>', '' ORDER BY top.rk)
         FROM top LEFT JOIN bh USING (theme) LEFT JOIN fmt USING (theme) LEFT JOIN crr USING (theme) LEFT JOIN mk USING (theme) LEFT JOIN quote USING (theme) LEFT JOIN obj USING (theme) LEFT JOIN an USING (theme) LEFT JOIN ages USING (theme) LEFT JOIN geo USING (theme) LEFT JOIN kw USING (theme)) END AS body
FROM n`;

/**
 * White space: where the audience rewards content and no brand has moved in. Needs `tags` (posts
 * with a theme, scored). Every theme with enough posts gets one state:
 *  - Open: rewarded (1.2 times the norm or more) and no brand owns it.
 *  - Unclaimed: rewarded, a brand's creators lead it, but under 15% of its posts are brand-owned or paid.
 *  - Contested: rewarded, and two or more brands own it.
 *  - Owned by X: one brand owns it.
 *  - Not rewarded: under 1.2 times the norm.
 *  - Brand-seeded: rewarded, but under a third of its posts are unprompted (the rest are paid,
 *    gifted, sold for commission or the brands' own): brands are already all over it.
 * A brand owns a theme when it has more than 25% of the theme's posts (the brief's line) and, when
 * fewer than ten brands are tracked, either at least one and a half times its usual share or more
 * than half of the theme's posts: with a handful of brands, a large one passes 25% of anything just
 * by being large, while a majority is ownership whatever the brand's size (inside one market a
 * single brand can be most of everything). "Lead" is the brand's share of the theme divided by its
 * share of all themed posts.
 * ws([by,] theme, posts, vs, brand_led, unprompted, ours, leader, lead_share, lead, owners, owner, state).
 * `where` filters the posts; `by` adds a grouping column (a market) and runs the rule inside each.
 */
const OWN_SHARE = 0.25, OWN_LEAD = 1.5, OWN_MAJORITY = 0.5, FEW_BRANDS = 10, BRAND_LED = 0.15, SEEDED = 0.33;
const WS = (where = "TRUE", by = "") => {
  const k = by ? `${by}, ` : "";
  return `wb AS (
  SELECT ${k}theme, brand, count(*)::float AS n, count(*) FILTER (WHERE is_owned OR is_paid)::float AS led, count(*) FILTER (WHERE ${EARNED})::float AS free, sum(eng_s) AS e, sum(expected) AS x
  FROM tags WHERE ${where} GROUP BY ${by ? "1, 2, 3" : "1, 2"}
), wsz AS (SELECT ${k}brand, sum(n) / sum(sum(n)) OVER (${by ? `PARTITION BY ${by}` : ""}) AS size FROM wb GROUP BY ${by ? "1, 2" : "1"}),
wnb AS MATERIALIZED (SELECT count(*) AS k FROM segments),
wl AS (
  SELECT wb.*, wb.n / sum(wb.n) OVER (PARTITION BY ${by ? `wb.${by}, ` : ""}wb.theme) AS share,
         (wb.n / sum(wb.n) OVER (PARTITION BY ${by ? `wb.${by}, ` : ""}wb.theme)) / NULLIF(wsz.size, 0) AS lead
  FROM wb JOIN wsz ON wsz.brand = wb.brand${by ? ` AND wsz.${by} = wb.${by}` : ""}
), wo AS (SELECT wl.*, (wl.share > ${OWN_SHARE} AND ((SELECT k FROM wnb) >= ${FEW_BRANDS} OR wl.lead >= ${OWN_LEAD} OR wl.share > ${OWN_MAJORITY})) AS owns FROM wl),
ws0 AS (
  SELECT ${k}theme, sum(n) AS posts, sum(e) / NULLIF(sum(x), 0) AS vs, sum(led) / sum(n) AS brand_led, sum(free) / sum(n) AS unprompted, coalesce(sum(n) FILTER (WHERE brand = focal_brand()), 0) AS ours,
         (array_agg(brand ORDER BY n DESC, brand))[1] AS leader, max(share) AS lead_share, (array_agg(lead ORDER BY n DESC, brand))[1] AS lead,
         count(*) FILTER (WHERE owns) AS owners, (array_agg(brand ORDER BY n DESC, brand) FILTER (WHERE owns))[1] AS owner
  FROM wo GROUP BY ${by ? "1, 2" : "1"}
), ws AS (
  SELECT ws0.*, CASE WHEN vs IS NULL OR vs < 1.2 THEN 'Not rewarded' WHEN unprompted < ${SEEDED} THEN 'Brand-seeded' WHEN owners = 0 THEN 'Open' WHEN brand_led < ${BRAND_LED} THEN 'Unclaimed' WHEN owners >= 2 THEN 'Contested'
                     WHEN owner = focal_brand() THEN 'Owned by us' ELSE 'Owned by ' || owner END AS state
  FROM ws0 WHERE posts >= ${THEME_MIN}
)`;
};
const WS_NOTE = `Open: engagement at 1.2 times the norm or more and no brand owns the theme. Unclaimed: rewarded, and under ${BRAND_LED * 100}% of its posts are brand-owned or paid, so no brand is behind it. A brand owns a theme when it has more than ${OWN_SHARE * 100}% of its posts and, with fewer than ${FEW_BRANDS} brands tracked, either at least ${OWN_LEAD} times its usual share (its "lead") or more than half of the posts. A rewarded theme in which under a third of the posts are unprompted is brand-seeded, not white space`;
/** Every theme's state in the period, for the monthly report: theme, state, posts, vs, owner, leader. */
export const WHITE_SPACE_SQL = `WITH ${SCORED("posts")}, ${LABEL_TAGS("sp")}, ${WS()}
SELECT theme, state, posts::int AS posts, vs, owner, leader FROM ws`;

/**
 * The brief names three buyers, each asking something different first. A leader's summary is the
 * boxes that answer their questions, by title; a box a dashboard does not have is left out.
 */
export interface LeaderView { id: string; label: string; asks: Array<{ question: string; titles: string[] }>; links: Array<{ label: string; href: "reports" | "/method" | "/data" }> }
export const LEADER_VIEWS: LeaderView[] = [
  {
    id: "brand", label: "Brand lead",
    asks: [
      { question: "Where are we losing share in the themes that matter?", titles: ["The three outcomes", "Where we are missing from winning themes"] },
      { question: "What do people love and hate about us against rivals?", titles: ["The answer: what to amplify, answer and attack"] },
      { question: "What white space can we own?", titles: ["The white-space map", "Content briefs for the top three themes"] },
    ],
    links: [{ label: "Monthly share and reaction tracking", href: "reports" }],
  },
  {
    id: "growth", label: "Growth lead",
    asks: [
      { question: "Which conversations and creators drive buying?", titles: ["Conversations that sell, not just engage", "Who drives buying"] },
      { question: "Where should paid go?", titles: ["The answer: creators to brief first", "Briefs to amplify, answer and attack"] },
      { question: "Which product fix unlocks growth?", titles: ["The answer: fix, protect, start talking about"] },
    ],
    links: [],
  },
  {
    id: "data", label: "Data lead",
    asks: [
      { question: "Is the data complete and comparable?", titles: ["The same measures for every tracked brand", "The measures, market by market", "Earned, gifted, affiliate, paid and brand-owned posts"] },
      { question: "Which measure tracks sales?", titles: ["Our eight measures", "What the eight measures mean"] },
    ],
    links: [{ label: "Coverage, accuracy and fixed norms", href: "/method" }, { label: "The data sheet", href: "/data" }],
  },
];

/**
 * The worked example: the brief run end to end on this dashboard's data, as one document. Each
 * chapter follows a heading of the brief and shows the boxes that carry its answer, by title; a
 * box a dashboard does not have is left out, and a chapter with none is skipped.
 */
export interface ExampleChapter { heading: string; text: string; titles: string[] }
export const WORKED_EXAMPLE: ExampleChapter[] = [
  {
    heading: "The idea in one page",
    text: "We use the whole social conversation to tell a brand what to say, who should say it and what to build next. Every piece of content is aimed at three outcomes: salience, purchase intent and better products. This is where the brand stands on each.",
    titles: ["The three outcomes"],
  },
  {
    heading: "How we measure: eight numbers",
    text: "The same eight measures sit under every answer. They are calculated the same way every month, so brands, markets and months compare like for like.",
    titles: ["Our eight measures", "The same measures for every tracked brand", "The measures, market by market"],
  },
  {
    heading: "1. Which conversations are winning?",
    text: "Content should ride what is already growing and performing. We find it by crossing momentum with engagement vs norm, theme by theme. The output: three to five themes to build content around, with the format that works and our gap in each, and a brief for the first three.",
    titles: ["The answer: themes to build content around", "Themes: momentum and engagement vs norm", "Content briefs for the top three themes"],
  },
  {
    heading: "2. Where is the white space?",
    text: "White space is where the audience rewards content but no brand has moved in. It is the cheapest place to build salience. The output: an \"own it\" list with the theme, proof the audience rewards it, who is absent and the first brief.",
    titles: ["The white-space map", "The answer: the \"own it\" list", "Every theme, graded: open, unclaimed, contested or owned"],
  },
  {
    heading: "3. What do people say about us, our rivals and our products?",
    text: "Comments are the consumer's own voice. Reading them tells a brand what to amplify, what to answer and what to attack, in words it can use, and who to put paid behind.",
    titles: ["The answer: what to amplify, answer and attack", "Briefs to amplify, answer and attack", "Amplify, answer and attack, by product", "Who switches to whom"],
  },
  {
    heading: "4. Which creators win in each conversation?",
    text: "The best creator for a brand is one who already wins its conversation, with the right audience. Every creator is scored the same way on performance, buying signals, theme fit, audience match, cost and availability.",
    titles: ["The answer: creators to brief first", "Creator score: the top creators across the tracked brands"],
  },
  {
    heading: "5. What should we build or fix?",
    text: "The comments that brief content also brief the product team: what people wish existed, what breaks, and what they would pay for. Every product attribute lands in one box of the grid.",
    titles: ["The answer: fix, protect, start talking about", "Product priority grid", "Where competitor products are weak: their \"fix first\" box", "What people wish existed"],
  },
  {
    heading: "Limits we state up front",
    text: "None of these block the approach, but each shapes what we promise.",
    titles: ["Reading it every month, and what it cannot show yet"],
  },
];

/** The measures for the focal brand in the period and the period before: rows of label, value, compare, fmt. */
export const EIGHT_MEASURES_SQL = `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")}, ${LABEL_TAGS("(SELECT * FROM w WHERE cur)")},
tot AS MATERIALIZED (SELECT count(*) FILTER (WHERE cur)::float AS cur, count(*) FILTER (WHERE NOT cur)::float AS prev, sum(coalesce(comments, 0)) FILTER (WHERE cur) AS comments FROM w),
us AS MATERIALIZED (
  SELECT count(*) FILTER (WHERE cur)::float AS cur, count(*) FILTER (WHERE NOT cur)::float AS prev,
         count(*) FILTER (WHERE cur AND ${EARNED})::float AS earned, count(*) FILTER (WHERE NOT cur AND ${EARNED})::float AS earned_prev,
         ${vs("cur")} AS vs_cur, ${vs("NOT cur")} AS vs_prev
  FROM sp WHERE brand = focal_brand()
), cm AS MATERIALIZED (
  SELECT count(*) FILTER (WHERE c.published_at >= b.s)::float AS n, count(*) FILTER (WHERE c.published_at < b.s)::float AS n_prev,
         count(*) FILTER (WHERE c.published_at >= b.s AND coalesce(c.buying, c.purchase_intent_type IS NOT NULL))::float AS intent, count(*) FILTER (WHERE c.published_at < b.s AND coalesce(c.buying, c.purchase_intent_type IS NOT NULL))::float AS intent_prev,
         count(*) FILTER (WHERE c.published_at >= b.s AND c.${POSITIVE})::float AS praise, count(*) FILTER (WHERE c.published_at < b.s AND c.${POSITIVE})::float AS praise_prev,
         count(*) FILTER (WHERE c.published_at >= b.s AND (c.sentiment = 'negative' OR c.objection_category IS NOT NULL))::float AS obj, count(*) FILTER (WHERE c.published_at < b.s AND (c.sentiment = 'negative' OR c.objection_category IS NOT NULL))::float AS obj_prev
  FROM brand_comments_all c, b WHERE c.brand = focal_brand() AND c.published_at >= b.ps AND c.published_at < b.e
), gap AS (SELECT theme, count(*)::float AS n, sum(coalesce(comments, 0)) AS comments FROM tags GROUP BY 1),
gt AS MATERIALIZED (SELECT sum(n) AS n, NULLIF(sum(comments), 0) AS comments FROM gap),
top_gap AS (SELECT 100.0 * gap.comments / gt.comments - 100.0 * gap.n / NULLIF(gt.n, 0) AS pts FROM gap, gt WHERE gap.n >= ${THEME_MIN} ORDER BY 1 DESC NULLS LAST LIMIT 1)
SELECT 'Share of voice' AS label, us.cur / NULLIF(tot.cur, 0) AS value, us.prev / NULLIF(tot.prev, 0) AS compare, 'percent' AS fmt FROM us, tot
UNION ALL SELECT 'Engagement vs norm', us.vs_cur, us.vs_prev, 'ratio' FROM us
UNION ALL SELECT 'Momentum', CASE WHEN us.prev >= 3 THEN us.cur / us.prev - 1 END, NULL, 'percent' FROM us
UNION ALL SELECT 'Earned share', us.earned / NULLIF(us.cur, 0), us.earned_prev / NULLIF(us.prev, 0), 'percent' FROM us
UNION ALL SELECT 'Purchase intent per 1K', 1000 * cm.intent / NULLIF(cm.n, 0), 1000 * cm.intent_prev / NULLIF(cm.n_prev, 0), 'decimal' FROM cm WHERE cm.n >= ${COMMENT_MIN}
UNION ALL SELECT 'Praise per 1K', 1000 * cm.praise / NULLIF(cm.n, 0), 1000 * cm.praise_prev / NULLIF(cm.n_prev, 0), 'decimal' FROM cm WHERE cm.n >= ${COMMENT_MIN}
UNION ALL SELECT 'Objections per 1K', 1000 * cm.obj / NULLIF(cm.n, 0), 1000 * cm.obj_prev / NULLIF(cm.n_prev, 0), 'decimal' FROM cm WHERE cm.n >= ${COMMENT_MIN}
UNION ALL SELECT 'Content gap', top_gap.pts, NULL, 'points' FROM top_gap WHERE top_gap.pts > 0.05`;

export const TOM8_SECTIONS: StarterSection[] = [
  {
    title: "The eight measures",
    widgets: [
      {
        type: "insight", w: 12, h: 4,
        title: "The three outcomes",
        subtitle: `What the work is for, in the brief's words: salience (talked about more, by more creators, in more of the conversations that matter), purchase intent (more comments that signal buying) and better products. ${VERSUS}. Purchase intent is per 1,000 brand comments, ours against all tracked brands.`,
        sql: `WITH ${THEMES}, ${ATTR_RATES}, ${GRID("brand = focal_brand()")},
sal AS MATERIALIZED (
  SELECT count(*) FILTER (WHERE cur AND brand = focal_brand())::float AS us, count(*) FILTER (WHERE NOT cur AND brand = focal_brand())::float AS us_prev,
         count(*) FILTER (WHERE cur)::float AS tot, count(*) FILTER (WHERE NOT cur)::float AS tot_prev,
         count(DISTINCT influencer_id) FILTER (WHERE cur AND brand = focal_brand()) AS cre, count(DISTINCT influencer_id) FILTER (WHERE NOT cur AND brand = focal_brand()) AS cre_prev,
         count(*) FILTER (WHERE cur AND brand = focal_brand() AND ${EARNED})::float AS earned
  FROM w
), held AS (SELECT count(*) AS n, count(*) FILTER (WHERE ours / posts >= share) AS k FROM c WHERE vs >= 1.2),
cm AS MATERIALIZED (
  SELECT count(*) FILTER (WHERE c.brand = focal_brand() AND c.published_at >= b.s)::float AS n, count(*) FILTER (WHERE c.brand = focal_brand() AND c.published_at >= b.s AND ${INTENT})::float AS i,
         count(*) FILTER (WHERE c.brand = focal_brand() AND c.published_at < b.s)::float AS n_prev, count(*) FILTER (WHERE c.brand = focal_brand() AND c.published_at < b.s AND ${INTENT})::float AS i_prev,
         count(*) FILTER (WHERE c.published_at >= b.s)::float AS cat_n, count(*) FILTER (WHERE c.published_at >= b.s AND ${INTENT})::float AS cat_i
  FROM brand_comments_all c, b WHERE c.published_at >= b.ps AND c.published_at < b.e
), fix AS (SELECT attribute, mentions, net FROM grid WHERE box = 'Fix first' ORDER BY mentions DESC, attribute LIMIT 1),
wish AS (SELECT feature_request_type AS kind, count(*) AS k FROM brand_comments WHERE brand = focal_brand() AND feature_request_type IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1)
SELECT 'Salience, purchase intent, better products' AS headline, '<ul>'
  || ${li(`'<strong>Salience.</strong> We have ' || coalesce(${r1("100.0 * sal.us / NULLIF(sal.tot, 0)")}::text || '% of the posts', 'no posts in the period')
       || CASE WHEN sal.tot_prev > 0 THEN ' (' || ${r1("100.0 * sal.us_prev / sal.tot_prev")} || '% the period before)' ELSE '' END
       || ', from ' || sal.cre || ' creators' || CASE WHEN sal.cre_prev > 0 THEN ' (' || sal.cre_prev || ' before)' ELSE '' END
       || coalesce(', and ' || ${pct("sal.earned / NULLIF(sal.us, 0)")} || '% of our posts are earned', '')
       || CASE WHEN held.n > 0 THEN '. We hold at least our share in ' || held.k || ' of the ' || held.n || ' themes above the norm.' ELSE '. No theme is above the norm in the period.' END`)}
  || ${li(`'<strong>Purchase intent.</strong> ' || CASE WHEN cm.n >= ${COMMENT_MIN} THEN ${r0("1000.0 * cm.i / cm.n")} || ' buying signals per 1,000 brand comments on our content, against ' || ${r0("1000.0 * cm.cat_i / NULLIF(cm.cat_n, 0)")} || ' across all tracked brands'
       || CASE WHEN cm.n_prev >= ${COMMENT_MIN} THEN ' (ours was ' || ${r0("1000.0 * cm.i_prev / cm.n_prev")} || ' the period before).' ELSE '.' END
       ELSE 'Not enough brand comments on our content in the period to say (' || cm.n::int || ', and it needs ${COMMENT_MIN}).' END`)}
  || ${li(`'<strong>Better products.</strong> ' || coalesce((SELECT 'Fix first: ' || lower(${ATTR("fix.attribute")}) || ' (' || fix.mentions::int || ' comments, net sentiment ' || round((100 * fix.net)::numeric, 0) || ').' FROM fix), 'Nothing lands in the fix-first box in the period.')
       || coalesce((SELECT ' Asked for most: a ' || lower(wish.kind) || ' (' || wish.k || ' requests).' FROM wish), '')`)}
  || '</ul>' AS body
FROM sal, held, cm`,
        rationale: "The brief opens with three outcomes. Everything below is a means to them, so they lead.",
      },
      {
        type: "kpi", w: 12, h: 3,
        title: "Our eight measures",
        subtitle: `${VERSUS}. Shares are percentages, vs norm is a ratio (1.0 is the norm), intent, praise and objections are per 1,000 brand comments, and content gap is in points. Creator score, the eighth measure, is per creator in section 4.`,
        sql: EIGHT_MEASURES_SQL,
        rationale: "The same numbers every month, calculated one way, so a change is a change and not a new definition.",
      },
      {
        type: "text", w: 12, h: 5,
        title: "What the eight measures mean",
        content: `- **Share of voice** (a share): how much of the conversation is ours. Our posts divided by all tracked brands' posts.
- **Engagement vs norm** (a ratio): does content do better than it should? Engagements divided by what the platform and creator size normally earn. 1.0 is the norm, 1.2 and above is outperforming.
- **Momentum** (a change): is it growing? Posts in this period against the period before.
- **Earned share** (a share): are people talking about us unprompted? Posts that are neither from our own accounts, nor paid, nor sold for commission, nor gifted, divided by all our posts.
- **Purchase intent** (a rate): is the conversation selling? Buying-signal comments per 1,000 brand comments.
- **Praise and objections** (rates): what people love and hate. Positive and negative comments per 1,000 brand comments, split by attribute in section 3.
- **Content gap** (a difference, in points): what people talk about more than creators post about. A theme's share of comments minus its share of posts.
- **Creator score** (out of 100): who is worth working with. Section 4.

A **brand comment** is a comment about the brand, its product or the category. Comments about the creator ("love your hair"), about other things in the post, and empty ones are left out of every comment measure. Posts judged not to be about the brand are left out of everything.`,
        rationale: "One vocabulary for the whole dashboard, so no number has to be explained twice.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "The same measures for every tracked brand",
        subtitle: `Posts and creators are counts. Share of voice and earned share are percentages of posts. ${ER_NOTE}. ${VERSUS}.`,
        sql: `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")},
a AS (
  SELECT brand, count(*) FILTER (WHERE cur)::float AS posts, count(*) FILTER (WHERE NOT cur)::float AS prev,
         count(DISTINCT influencer_id) FILTER (WHERE cur)::int AS creators, count(*) FILTER (WHERE cur AND ${EARNED})::float AS earned,
         sum(engagement) FILTER (WHERE cur) / NULLIF(sum(${REACH("sp")}) FILTER (WHERE cur), 0) AS er, ${vs("cur")} AS vs
  FROM sp GROUP BY 1
)
SELECT a.brand, CASE WHEN a.brand = focal_brand() THEN 'us' ELSE 'competitor' END AS role, a.posts::int AS posts, a.creators,
       ${r1("100.0 * a.posts / NULLIF((SELECT sum(posts) FROM a), 0)")} AS "share of voice %",
       ${r2("100.0 * a.er")} AS "engagement rate %", ${r2("a.vs")} AS "engagement vs norm",
       CASE WHEN a.prev >= 3 THEN ${r0("100.0 * (a.posts / a.prev - 1)")} END AS "momentum %",
       ${r0("100.0 * a.earned / NULLIF(a.posts, 0)")} AS "earned share %"
FROM a WHERE a.posts > 0 ORDER BY (a.brand = focal_brand()) DESC, a.posts DESC`,
        rationale: "The rival read in one glance, like for like.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "The measures, market by market",
        subtitle: `The five largest markets in the period, with the same measures for us in each, so markets compare like for like. The norm is the tracked brands' across all markets. Comment measures need ${COMMENT_MIN}+ of our brand comments in the market. Content gap and creator score are per theme and per creator, in sections 2 and 4.`,
        sql: `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")},
mk AS MATERIALIZED (SELECT country, count(*) AS n FROM sp WHERE cur AND country IS NOT NULL AND country <> 'Unknown' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5),
p AS (
  SELECT sp.country, count(*) FILTER (WHERE cur)::float AS tot, count(*) FILTER (WHERE cur AND brand = focal_brand())::float AS us, count(*) FILTER (WHERE NOT cur AND brand = focal_brand())::float AS us_prev,
         count(*) FILTER (WHERE cur AND brand = focal_brand() AND ${EARNED})::float AS earned, ${vs("cur AND brand = focal_brand()")} AS vs
  FROM sp JOIN mk USING (country) GROUP BY 1
), cm AS (
  SELECT c.country, count(*)::float AS n, count(*) FILTER (WHERE ${INTENT})::float AS i, count(*) FILTER (WHERE ${POSITIVE})::float AS pos, count(*) FILTER (WHERE ${NEGATIVE})::float AS neg
  FROM brand_comments_all c, b WHERE c.brand = focal_brand() AND c.published_at >= b.s AND c.published_at < b.e GROUP BY 1
)
SELECT p.country AS market, p.us::int AS "our posts", ${r1("100.0 * p.us / NULLIF(p.tot, 0)")} AS "share of voice %", ${r2("p.vs")} AS "engagement vs norm",
       CASE WHEN p.us_prev >= 3 THEN ${r0("100.0 * (p.us / p.us_prev - 1)")} END AS "momentum %", ${r0("100.0 * p.earned / NULLIF(p.us, 0)")} AS "earned share %",
       coalesce(cm.n, 0)::int AS "our brand comments", CASE WHEN cm.n >= ${COMMENT_MIN} THEN ${r1("1000.0 * cm.i / cm.n")} END AS "intent per 1K",
       CASE WHEN cm.n >= ${COMMENT_MIN} THEN ${r1("1000.0 * cm.pos / cm.n")} END AS "praise per 1K", CASE WHEN cm.n >= ${COMMENT_MIN} THEN ${r1("1000.0 * cm.neg / cm.n")} END AS "objections per 1K"
FROM p JOIN mk USING (country) LEFT JOIN cm USING (country) ORDER BY mk.n DESC, p.country`,
        rationale: "The brief says brands, markets and months compare like for like. Brands and months had a table each. This is the one for markets.",
      },
      {
        type: "table", w: 6, h: 5,
        title: "Share of voice, four ways",
        subtitle: "Each brand's share of the tracked brands' posts, views, creators and engagements, in percent. It covers the whole period shown, so when viewing all time it differs from the share of voice above, which is the last 90 days. Views are counted where the platform gives them. A creator who posts about two brands counts for both, so the creator shares can add up to more than 100. A brand with a small share of posts and a large share of views is being carried by a few big posts.",
        sql: `WITH t AS (
  SELECT brand, count(*)::float AS posts, sum(coalesce(views, 0)) AS views, count(DISTINCT influencer_id)::float AS creators, sum(coalesce(engagement, 0)) AS eng FROM posts GROUP BY 1
), tot AS MATERIALIZED (SELECT sum(posts) AS posts, sum(views) AS views, (SELECT count(DISTINCT influencer_id)::float FROM posts) AS creators, sum(eng) AS eng FROM t)
SELECT t.brand, ${r1("100.0 * t.posts / NULLIF(tot.posts, 0)")} AS "share of posts %", ${r1("100.0 * t.views / NULLIF(tot.views, 0)")} AS "share of views %",
       ${r1("100.0 * t.creators / NULLIF(tot.creators, 0)")} AS "share of creators %", ${r1("100.0 * t.eng / NULLIF(tot.eng, 0)")} AS "share of engagements %"
FROM t, tot ORDER BY (t.brand = focal_brand()) DESC, t.posts DESC`,
        rationale: "The brief's share of voice is by posts, and also by views, creators and engagements. The four rarely agree, and the difference says how a brand gets its voice.",
      },
      {
        type: "stacked_bar", w: 6, h: 5,
        title: "Earned, gifted, affiliate, paid and brand-owned posts",
        subtitle: "Share of each brand's posts. Paid, disclosed: the caption says advert or paid partnership. Paid, platform label only: the platform marks it commercial and the caption says nothing. Affiliate or shop: the creator sells it through the platform's shop or for commission. Gifted: a free product or a giveaway. Brand-owned: the brand's own account. Earned: none of these.",
        sql: `SELECT brand, ${KIND()} AS kind, count(*)::int AS value
FROM posts GROUP BY 1, 2 ORDER BY (brand = focal_brand()) DESC, 1, 2`,
        x: "brand", y: "value", series: "kind", normalize: true, horizontal: true, unit: "Share of each brand's posts, in percent",
        rationale: "How much of each brand's conversation is unprompted, and how much was bought, gifted or self-published.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "What the audience says, per tracked brand",
        subtitle: `Buying signals, praise and objections per 1,000 brand comments (brands with ${COMMENT_MIN}+ brand comments). ${BC_NOTE}.`,
        when: N_BC,
        sql: `SELECT brand, count(*)::int AS "brand comments",
       ${r1(`1000.0 * count(*) FILTER (WHERE ${INTENT}) / count(*)`)} AS "intent per 1K",
       ${r0(`1000.0 * count(*) FILTER (WHERE ${POSITIVE}) / count(*)`)} AS "praise per 1K",
       ${r0(`1000.0 * count(*) FILTER (WHERE ${NEGATIVE}) / count(*)`)} AS "objections per 1K"
FROM brand_comments GROUP BY brand HAVING count(*) >= ${COMMENT_MIN} OR brand = focal_brand() ORDER BY (brand = focal_brand()) DESC, count(*) DESC`,
        sample: OUR_BC,
        rationale: "Whether the conversation about us sells, pleases and objects more or less than about rivals.",
      },
    ],
  },
  {
    title: "1. Which conversations are winning?",
    widgets: [
      {
        type: "insight", w: 12, h: 5,
        title: "The answer: themes to build content around",
        subtitle: `Composed from the numbers in this section. ${STATUS_NOTE}.`,
        when: N_THEMED,
        sql: `WITH ${THEMES}, ${BEST_HOOK("sp.cur")},
pick AS (
  SELECT c.*, bh.hook, bh.hvs, row_number() OVER (ORDER BY (status = 'winning') DESC, (status = 'early signal') DESC, vs DESC NULLS LAST) AS rk
  FROM c LEFT JOIN bh USING (theme) WHERE status IN ('winning', 'early signal', 'above norm')
), top AS (SELECT * FROM pick WHERE rk <= 5),
n AS (SELECT count(*) AS k, count(*) FILTER (WHERE status = 'above norm') AS no_growth, (SELECT count(*) FROM c WHERE mom IS NOT NULL) AS with_history FROM top)
SELECT CASE WHEN n.k = 0 THEN 'No theme is above the norm in this period'
            WHEN n.with_history = 0 THEN n.k || ' themes above the norm to build content around'
            ELSE n.k || CASE WHEN n.k = 1 THEN ' theme' ELSE ' themes' END || ' to build content around' END AS headline,
       CASE WHEN n.k = 0 THEN '<p>No theme with ${THEME_MIN} or more posts earns 1.2 times the norm. Try a longer period.</p>'
            ELSE (SELECT '<ul>' || string_agg(${li(`'<strong>' || top.theme || '</strong> (' || top.status || '): ' || top.posts::int || ' posts, engagement ' || ${x2("top.vs")} || ' the norm'
              || CASE WHEN top.mom IS NOT NULL THEN ', posts ' || CASE WHEN top.mom >= 0 THEN 'up ' ELSE 'down ' END || ${pct("abs(top.mom)")} || '%' ELSE '' END
              || '. Our share of its posts is ' || ${pct("top.ours / top.posts")} || '% against ' || ${pct("top.share")} || '% overall'
              || CASE WHEN top.hook IS NOT NULL THEN '. Works best told as: ' || lower(top.hook) || ' (' || ${x2("top.hvs")} || ')' ELSE '' END || '.'`)}, '' ORDER BY top.rk) || '</ul>' FROM top)
              || CASE WHEN n.with_history = 0 THEN '<p>There is one period of data here, so growth is not known yet. These themes are ranked on engagement vs norm alone.</p>' ELSE '' END
       END AS body
FROM n`,
        rationale: "The brief's output for this question: 3 to 5 themes to build content around, the format that works, and our gap in each.",
      },
      {
        type: "insight", w: 12, h: 10,
        title: "Content briefs for the top three themes",
        subtitle: "One brief per theme, composed from the numbers on this dashboard: why now, our gap, how to tell it, who should tell it, where, the audience to put paid behind it with its keywords, the words of people under our own posts and the objection to answer (one raised in 5 or more brand comments). Set a market on the period bar to get the briefs for that market. Ask AI can turn any of them into a full creative brief.",
        when: N_THEMED,
        sql: BRIEFS(
          "pick AS (SELECT c.*, row_number() OVER (ORDER BY (status = 'winning') DESC, (status = 'early signal') DESC, vs DESC NULLS LAST) AS rk FROM c WHERE status IN ('winning', 'early signal', 'above norm'))",
          "No theme is above the norm in this period", `No theme with ${THEME_MIN} or more posts earns 1.2 times the norm, so there is nothing to brief yet. Try a longer period or all markets.`, "content brief",
        ),
        rationale: "The brief says every answer becomes a brief, a creator and an audience. This is the first draft of each.",
      },
      {
        type: "table", w: 12, h: 7,
        title: "Themes: momentum and engagement vs norm",
        subtitle: `${THEME_NOTE} (themes with ${THEME_MIN}+ posts). Posts is a count, momentum a percent change, engagement rate a percentage of reach, vs norm a ratio. ${STATUS_NOTE}. ${VERSUS}.`,
        when: N_THEMED,
        sql: `WITH ${THEMES}
SELECT theme, posts::int AS posts, CASE WHEN mom IS NOT NULL THEN ${r0("100.0 * mom")} END AS "momentum %", ${r2("100.0 * er")} AS "engagement rate %", ${r2("vs")} AS "engagement vs norm",
       ${r0("100.0 * ours / NULLIF(posts, 0)")} AS "our share of posts %", status
FROM c ORDER BY posts DESC LIMIT 25`,
        rationale: "Which conversations are growing and rewarded, which are just starting, and which are fading.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Where we are missing from winning themes",
        subtitle: `Themes at 1.2 times the norm or more where our share of the posts is below our overall share of voice. The gap is in percentage points (themes with ${THEME_MIN}+ posts).`,
        when: N_COMPETITORS,
        sql: `WITH ${THEMES}
SELECT theme, posts::int AS posts, ${r2("vs")} AS "engagement vs norm", ${r0("100.0 * ours / posts")} AS "our share of posts %", ${r0("100.0 * share")} AS "our overall share %", ${r1("100.0 * (ours / posts - share)")} AS "gap pts"
FROM c WHERE vs >= 1.2 AND ours / posts < share ORDER BY ours / posts - share ASC, posts DESC LIMIT 12`,
        rationale: "The rewarded conversations we are absent from are the cheapest ones to enter.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Conversations that sell, not just engage",
        subtitle: `Themes across the tracked brands ranked by engagement vs norm multiplied by buying signals per 1,000 brand comments (themes with ${THEME_MIN}+ posts and ${COMMENT_MIN}+ brand comments).`,
        when: N_BC,
        sql: `WITH ${SCORED("posts")}, ${LABEL_TAGS("sp")},
pc AS MATERIALIZED (SELECT segment_id, post_id, count(*)::float AS n, count(*) FILTER (WHERE ${INTENT})::float AS intent FROM brand_comments GROUP BY 1, 2),
t AS (
  SELECT tags.theme, count(*)::int AS posts, sum(pc.n) AS comments, sum(pc.intent) AS intent, ${vs()} AS vs
  FROM tags LEFT JOIN pc ON pc.segment_id = tags.segment_id AND pc.post_id = tags.post_id GROUP BY 1
)
SELECT theme, posts, comments::int AS "brand comments", ${r1("1000.0 * intent / comments")} AS "intent per 1K", ${r2("vs")} AS "engagement vs norm", ${r0("1000.0 * intent / comments * coalesce(vs, 1)")} AS "sell score"
FROM t WHERE posts >= ${THEME_MIN} AND comments >= ${COMMENT_MIN} AND intent > 0 ORDER BY 1000.0 * intent / comments * coalesce(vs, 1) DESC LIMIT 12`,
        sample: OUR_BC,
        rationale: "Reach without intent is entertainment. These themes bring both.",
      },
      {
        type: "bar", w: 6, h: 6,
        title: "Formats that win: engagement vs norm",
        subtitle: `By platform and format, us against the tracked competitors (cells with 5+ posts). ${VS_NOTE}.`,
        sql: `WITH ${SCORED("posts")},
f AS (
  SELECT platform || ' ' || post_type AS format, ${vs("brand = focal_brand()")} AS us, ${vs("brand <> focal_brand()")} AS competitors,
         count(*) FILTER (WHERE brand = focal_brand() AND expected IS NOT NULL) AS n_us, count(*) FILTER (WHERE expected IS NOT NULL) AS n
  FROM sp WHERE platform IS NOT NULL AND post_type IS NOT NULL GROUP BY 1
)
SELECT format, CASE WHEN n_us >= 5 THEN ${r2("us")} END AS us, ${r2("competitors")} AS competitors FROM f WHERE n >= 5 ORDER BY n DESC LIMIT 8`,
        x: "format", format: "ratio", unit: "Engagement vs norm: 1.0× is the norm",
        rationale: "Where our content beats the norm, and where a rival's format works better.",
      },
      {
        type: "bar", w: 6, h: 6,
        title: "Hooks that win: engagement vs norm",
        subtitle: "By how the post is told (tutorial, review, routine and so on, read from the caption), us against the tracked competitors (hooks with 5+ posts). 1.0 is the norm.",
        when: N_HOOKS,
        sql: `WITH ${SCORED("posts")},
h AS (SELECT sp.*, ph.hook FROM sp JOIN post_hooks ph ON ph.segment_id = sp.segment_id AND ph.post_id = sp.post_id),
f AS (
  SELECT hook, ${vs("brand = focal_brand()")} AS us, ${vs("brand <> focal_brand()")} AS competitors,
         count(*) FILTER (WHERE brand = focal_brand() AND expected IS NOT NULL) AS n_us, count(*) FILTER (WHERE expected IS NOT NULL) AS n
  FROM h GROUP BY 1
)
SELECT hook, CASE WHEN n_us >= 5 THEN ${r2("us")} END AS us, ${r2("competitors")} AS competitors FROM f WHERE n >= 5 ORDER BY n DESC LIMIT 10`,
        x: "hook", format: "ratio", horizontal: true, unit: "Engagement vs norm: 1.0× is the norm",
        rationale: "Whether a tutorial, a review or a routine earns more than its platform normally does.",
      },
      {
        type: "table", w: 12, h: 6,
        title: "The hook and format that win in each theme",
        subtitle: `For each theme with ${THEME_MIN}+ posts: the way of telling it and the platform and format with the best engagement vs norm (cells with 5+ posts). Hooks are read from the caption. Shop listings and giveaways are left out as hooks.`,
        when: N_THEMED,
        sql: `WITH ${SCORED("posts")}, ${LABEL_TAGS("sp")},
big AS (SELECT theme, count(*)::int AS n FROM tags GROUP BY 1 HAVING count(*) >= ${THEME_MIN}),
h AS (SELECT DISTINCT ON (theme) theme, hook, hvs, k FROM (
  SELECT t.theme, ph.hook, sum(t.eng_s) / NULLIF(sum(t.expected), 0) AS hvs, count(*)::int AS k
  FROM tags t JOIN post_hooks ph ON ph.segment_id = t.segment_id AND ph.post_id = t.post_id
  WHERE ph.hook NOT IN ('Listing or sale advert', 'Giveaway or competition') GROUP BY 1, 2 HAVING count(*) >= 5) x WHERE hvs IS NOT NULL ORDER BY theme, hvs DESC, hook),
f AS (SELECT DISTINCT ON (theme) theme, format, fvs, k FROM (
  SELECT theme, platform || ' ' || post_type AS format, sum(eng_s) / NULLIF(sum(expected), 0) AS fvs, count(*)::int AS k
  FROM tags WHERE platform IS NOT NULL AND post_type IS NOT NULL GROUP BY 1, 2 HAVING count(*) >= 5) y WHERE fvs IS NOT NULL ORDER BY theme, fvs DESC, format)
SELECT big.theme, big.n AS posts, h.hook AS "best hook", ${r2("h.hvs")} AS "hook vs norm", h.k AS "posts told that way", f.format AS "best format", ${r2("f.fvs")} AS "format vs norm", f.k AS "posts in that format"
FROM big LEFT JOIN h USING (theme) LEFT JOIN f USING (theme) ORDER BY big.n DESC`,
        rationale: "The brief asks which formats and hooks win in each theme, not only overall.",
      },
      {
        type: "table", w: 6, h: 5,
        title: "Markets that lead",
        subtitle: `Creator countries across the tracked brands: posts (a count), momentum (a percent change) and engagement vs norm (countries with 10+ posts). ${VERSUS}.`,
        sql: `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")},
c AS (
  SELECT country, count(*) FILTER (WHERE cur)::float AS posts, count(*) FILTER (WHERE NOT cur)::float AS before,
         count(*) FILTER (WHERE cur AND brand = focal_brand())::int AS ours, ${vs("cur")} AS vs
  FROM sp WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY 1
)
SELECT c.country, c.posts::int AS posts, c.ours AS "our posts", CASE WHEN c.before >= 3 THEN ${r0("100.0 * (c.posts / c.before - 1)")} END AS "momentum %", ${r2("c.vs")} AS "engagement vs norm"
FROM c WHERE c.posts >= 10 ORDER BY c.posts DESC LIMIT 10`,
        rationale: "A market that grows and outperforms before the others is where a theme starts.",
      },
      {
        type: "table", w: 12, h: 7,
        title: "Top themes in each market, side by side",
        subtitle: `For each of the five largest markets in the period, its themes with ${THEME_MIN}+ posts there, best first: growing and at 1.2 times the norm, then by engagement vs norm. Posts is a count, momentum a percent change, our share a percentage of the theme's posts in that market. Up to five per market. ${STATUS_NOTE}.`,
        when: N_THEMED,
        sql: `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")}, ${LABEL_TAGS("sp")},
mk AS (SELECT country, count(*) AS n FROM tags WHERE cur AND country IS NOT NULL AND country <> 'Unknown' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5),
t AS (
  SELECT tags.country, tags.theme, count(*) FILTER (WHERE cur)::float AS posts, count(*) FILTER (WHERE NOT cur)::float AS before, ${vs("cur")} AS vs,
         count(*) FILTER (WHERE cur AND brand = focal_brand())::float AS ours
  FROM tags JOIN mk USING (country) GROUP BY 1, 2
), c AS (
  SELECT t.*, CASE WHEN before >= 3 THEN posts / before - 1 END AS mom FROM t WHERE posts >= ${THEME_MIN}
), r AS (
  SELECT c.*, CASE WHEN vs >= 1.5 AND mom IS NOT NULL AND mom < 0.2 THEN 'early signal' WHEN vs >= 1.2 AND mom > 0 THEN 'winning' WHEN mom >= 0.5 AND vs < 1 THEN 'peaking'
                   WHEN vs >= 1.2 THEN 'above norm' WHEN vs < 0.8 THEN 'below norm' ELSE 'steady' END AS status,
         row_number() OVER (PARTITION BY country ORDER BY (vs >= 1.2 AND coalesce(mom, 0) > 0) DESC, vs DESC NULLS LAST, theme) AS rk
  FROM c
)
SELECT r.country AS market, r.theme, r.posts::int AS posts, ${r0("100 * r.mom")} AS "momentum %", ${r2("r.vs")} AS "engagement vs norm", ${r0("100.0 * r.ours / r.posts")} AS "our share of posts %", r.status
FROM r JOIN mk USING (country) WHERE r.rk <= 5 ORDER BY mk.n DESC, r.country, r.rk`,
        rationale: "The brief's first output is 3 to 5 themes per market. This shows the markets next to each other; the market filter gives the full dashboard for one.",
      },
      {
        type: "table", w: 12, h: 6,
        title: "Where each theme grew first",
        subtitle: `For each theme with ${THEME_MIN}+ posts: the first market and month in which it reached 5 posts in a month, and its three largest markets now. A theme already at 5 a month when the data starts is marked so. Ignores the period.`,
        period: "all",
        when: N_LONG_HISTORY,
        sql: `WITH ${LABEL_TAGS("posts_all")},
m AS (SELECT theme, country, date_trunc('month', published_at) AS mo, count(*) AS n FROM tags WHERE country IS NOT NULL AND country <> 'Unknown' AND published_at IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) >= 5),
d0 AS MATERIALIZED (SELECT date_trunc('month', min(published_at)) AS mo FROM tags WHERE published_at IS NOT NULL),
fst AS (SELECT DISTINCT ON (theme) theme, country, mo FROM m ORDER BY theme, mo, n DESC, country),
tot AS (SELECT theme, count(*)::int AS posts FROM tags GROUP BY 1 HAVING count(*) >= ${THEME_MIN}),
nowm AS (SELECT theme, string_agg(country || ' (' || k || ')', ', ' ORDER BY k DESC, country) AS markets FROM (
  SELECT theme, country, count(*) AS k, row_number() OVER (PARTITION BY theme ORDER BY count(*) DESC, country) AS rk FROM tags WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY 1, 2) z WHERE rk <= 3 GROUP BY 1)
SELECT tot.theme, tot.posts, fst.country AS "grew first in", CASE WHEN fst.mo = d0.mo THEN 'already there when the data starts' ELSE to_char(fst.mo, 'Mon YYYY') END AS "from", nowm.markets AS "largest markets now (posts)"
FROM tot CROSS JOIN d0 LEFT JOIN fst USING (theme) LEFT JOIN nowm USING (theme) ORDER BY fst.mo NULLS LAST, tot.posts DESC`,
        rationale: "The brief asks where a theme grew first, so a market that leads can brief the ones that follow.",
      },
      {
        type: "table", w: 6, h: 5,
        title: "What spiked, and why",
        subtitle: "Brand months with at least twice the engagements of the three months before, the post behind it, and whether that post was paid. Ignores the period.",
        when: N_LONG_HISTORY,
        period: "all",
        sql: `WITH m AS (
  SELECT brand, date_trunc('month', published_at) AS mo, sum(engagement) AS eng, count(*)::int AS posts FROM posts_all WHERE published_at IS NOT NULL GROUP BY 1, 2
), r AS (
  SELECT *, avg(eng) OVER (PARTITION BY brand ORDER BY mo ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS base,
            count(*) OVER (PARTITION BY brand ORDER BY mo ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS months_before FROM m
), s AS (SELECT * FROM r WHERE months_before = 3 AND base > 0 AND eng >= 2 * base AND posts >= 5),
top AS (
  SELECT DISTINCT ON (s.brand, s.mo) s.brand, s.mo, p.username, p.is_paid, p.is_gifted, p.is_owned, p.is_affiliate, p.engagement, p.url
  FROM s JOIN posts_all p ON p.brand = s.brand AND date_trunc('month', p.published_at) = s.mo ORDER BY s.brand, s.mo, p.engagement DESC NULLS LAST
)
SELECT to_char(s.mo, 'YYYY-MM') AS month, s.brand, ${r1("s.eng / s.base")} AS "times the usual", top.username AS creator,
       CASE WHEN top.is_owned THEN 'brand-owned' WHEN top.is_paid THEN 'paid' WHEN top.is_affiliate THEN 'affiliate' WHEN top.is_gifted THEN 'gifted' ELSE 'earned' END AS kind, ${r0("100.0 * top.engagement / NULLIF(s.eng, 0)")} AS "top post share %", top.url AS post
FROM s JOIN top USING (brand, mo) ORDER BY s.mo DESC, s.eng / s.base DESC LIMIT 12`,
        rationale: "A spike made by one paid post is a purchase. A spike made by many earned posts is a conversation.",
      },
    ],
  },
  {
    title: "2. Where is the white space?",
    widgets: [
      {
        type: "insight", w: 12, h: 6,
        title: "The white-space map",
        subtitle: "The best opening of each kind this section looks for, with its proof. Each line is the top row of one of the boxes below. Culture, the seventh kind in the brief, needs a culture query we do not have yet.",
        when: N_THEMED,
        sql: `WITH ${SCORED("posts")}, ${LABEL_TAGS("sp")}, ${WS()}, ${CLAIM_GAP("true")},
m_theme AS (SELECT theme, state, vs, posts FROM ws WHERE state IN ('Open', 'Unclaimed') ORDER BY (state = 'Open') DESC, vs DESC, theme LIMIT 1),
gt AS MATERIALIZED (SELECT count(*)::float AS posts, NULLIF(sum(coalesce(comments, 0)), 0) AS comments FROM tags),
m_gap AS (SELECT tags.theme, 100.0 * sum(coalesce(tags.comments, 0)) / max(gt.comments) - 100.0 * count(*) / max(gt.posts) AS pts FROM tags, gt GROUP BY 1 HAVING count(*) >= ${THEME_MIN} ORDER BY 2 DESC NULLS LAST, 1 LIMIT 1),
m_q AS (SELECT coalesce(lower(${ATTR()}), 'other things about the product') AS topic, count(*) FILTER (WHERE coalesce(reply_count, 0) = 0) AS k FROM brand_comments WHERE brand = focal_brand() AND faq_topic IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1),
m_ben AS (SELECT attribute, ps, cs FROM j WHERE ps - cs >= 5 ORDER BY ps - cs DESC, attribute LIMIT 1),
m_mkt AS (SELECT country, sum(coalesce(comments, 0))::float / NULLIF(count(DISTINCT influencer_id), 0) AS per_creator, count(DISTINCT influencer_id) AS creators FROM sp WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY 1 HAVING count(*) >= ${THEME_MIN} ORDER BY 2 DESC NULLS LAST, 1 LIMIT 1),
pn AS MATERIALIZED (SELECT count(*) FILTER (WHERE brand = focal_brand())::float AS ours, count(*) FILTER (WHERE brand <> focal_brand())::float AS theirs FROM posts WHERE platform IS NOT NULL),
m_pl AS (SELECT platform, 100.0 * count(*) FILTER (WHERE brand <> focal_brand()) / NULLIF(max(pn.theirs), 0) AS theirs, 100.0 * count(*) FILTER (WHERE brand = focal_brand()) / NULLIF(max(pn.ours), 0) AS ours
         FROM posts, pn WHERE platform IS NOT NULL GROUP BY 1 HAVING 100.0 * count(*) FILTER (WHERE brand <> focal_brand()) / NULLIF(max(pn.theirs), 0) - 100.0 * count(*) FILTER (WHERE brand = focal_brand()) / NULLIF(max(pn.ours), 0) >= 3 ORDER BY 2 - 3 DESC, 1 LIMIT 1)
SELECT 'Where the openings are' AS headline, '<ul>'
  || ${li(`'<strong>A theme nobody has claimed:</strong> ' || coalesce((SELECT theme || ' (' || lower(state) || '), at ' || ${x2("vs")} || ' the norm over ' || posts::int || ' posts.' FROM m_theme), 'none in this period. Every rewarded theme has a brand behind it.')`)}
  || ${li(`'<strong>A topic people talk about more than creators cover:</strong> ' || coalesce((SELECT theme || ', with ' || round(pts::numeric, 1) || ' points more of the comments than of the posts.' FROM m_gap WHERE pts > 0.05), 'none stands out.')`)}
  || ${li(`'<strong>A question nobody answers:</strong> ' || coalesce((SELECT 'about ' || topic || ': ' || k || ' questions under our posts got no reply.' FROM m_q WHERE k > 0), 'no unanswered questions about the brand in the comments we have.')`)}
  || ${li(`'<strong>A benefit nobody claims:</strong> ' || coalesce((SELECT lower(${ATTR("attribute")}) || ', ' || round(ps::numeric, 0) || '% of the praise against ' || round(cs::numeric, 0) || '% of the claims.' FROM m_ben), 'no benefit is praised 5 points more than it is claimed, or the captions here have not been read for claims.')`)}
  || ${li(`'<strong>A market with demand and few creators:</strong> ' || coalesce((SELECT country || ', with ' || round(per_creator::numeric, 0) || ' comments per creator across ' || creators || ' creators.' FROM m_mkt), 'no market has enough posts to say.')`)}
  || ${li(`'<strong>A platform we under-use:</strong> ' || coalesce((SELECT platform || ': ' || round(theirs::numeric, 0) || '% of rivals'' posts against ' || round(coalesce(ours, 0)::numeric, 0) || '% of ours.' FROM m_pl), 'none: our mix of platforms is within 3 points of rivals''.')`)}
  || '</ul>' AS body`,
        rationale: "The brief promises the brand lead a white-space map. This is it on one card: six kinds of opening, each with its proof.",
      },
      {
        type: "insight", w: 12, h: 5,
        title: "The answer: the \"own it\" list",
        subtitle: `Composed from the graded themes below: the theme, proof the audience rewards it, who is absent, and the first brief. ${WS_NOTE}.`,
        when: N_THEMED,
        sql: `WITH ${SCORED("posts")}, ${LABEL_TAGS("sp")}, ${BEST_HOOK()}, ${WS()},
pick AS (SELECT ws.*, bh.hook, row_number() OVER (ORDER BY (ws.state = 'Open') DESC, ws.vs DESC, ws.theme) AS rk FROM ws LEFT JOIN bh USING (theme) WHERE ws.state IN ('Open', 'Unclaimed')),
near AS (SELECT ws.*, row_number() OVER (ORDER BY ws.lead, ws.vs DESC, ws.theme) AS rk FROM ws WHERE ws.state NOT IN ('Open', 'Unclaimed', 'Not rewarded', 'Brand-seeded')),
n AS (SELECT count(*) AS k FROM pick)
SELECT CASE WHEN n.k = 0 THEN 'No theme is open in this period' ELSE n.k || CASE WHEN n.k = 1 THEN ' theme' ELSE ' themes' END || ' the audience rewards and no brand has claimed' END AS headline,
       CASE WHEN n.k = 0 THEN '<p>Every theme at 1.2 times the norm or more has a brand that leads it beyond its size and puts its own or paid content behind it. The closest to open:</p>'
              || coalesce((SELECT '<ul>' || string_agg(${li(`'<strong>' || near.theme || '</strong>: ' || near.state || '. ' || near.leader || ' has ' || ${pct("near.lead_share")} || '% of its posts, ' || ${x2("near.lead")} || ' its usual share, and ' || ${pct("near.brand_led")} || '% of the posts are brand-owned or paid.'`)}, '' ORDER BY near.rk) || '</ul>' FROM near WHERE near.rk <= 3), '<p>No theme reaches 1.2 times the norm.</p>')
            ELSE (SELECT '<ul>' || string_agg(${li(`'<strong>' || pick.theme || '</strong> (' || lower(pick.state) || '). Proof: engagement ' || ${x2("pick.vs")} || ' the norm over ' || pick.posts::int || ' posts. Who is absent: '
              || CASE WHEN pick.state = 'Open' THEN 'no brand owns it. The largest, ' || pick.leader || ', has ' || ${pct("pick.lead_share")} || '% of the posts, ' || ${x2("pick.lead")} || ' its usual share'
                      ELSE 'the brands themselves. ' || pick.leader || ' has ' || ${pct("pick.lead_share")} || '% of the posts, but only ' || ${pct("pick.brand_led")} || '% of the theme is brand-owned or paid: the rest is unprompted' END
              || '. We have ' || ${pct("pick.ours / pick.posts")} || '%'
              || CASE WHEN pick.hook IS NOT NULL THEN '. First brief: tell it as ' || lower(pick.hook) ELSE '' END || '.'`)}, '' ORDER BY pick.rk) || '</ul>' FROM pick WHERE pick.rk <= 5) END AS body
FROM n`,
        rationale: "The brief's output for this question: the theme, proof the audience rewards it, who is absent, and the first brief.",
      },
      {
        type: "insight", w: 12, h: 9,
        title: "Briefs for the white space",
        subtitle: `One brief for each of the top three open or unclaimed themes, open first. The same parts as the content briefs: how to tell it, who should tell it, where, the paid audience and its keywords. Viewing all time, the briefs read the last 90 days, so a theme can be open here and owned over the whole period.`,
        when: N_THEMED,
        sql: BRIEFS(
          `${WS("cur")},
pick AS (SELECT c.*, row_number() OVER (ORDER BY (ws.state = 'Open') DESC, c.vs DESC, c.theme) AS rk FROM c JOIN ws USING (theme) WHERE ws.state IN ('Open', 'Unclaimed'))`,
          "No open theme to brief in this period", "Every theme at 1.2 times the norm or more has a brand that leads it beyond its size and puts content behind it, so there is no white space to brief. The graded table below shows who.", "white-space brief",
        ),
        rationale: "The brief says each answer becomes a brief, a creator and a paid audience. This does it for the white space.",
      },
      {
        type: "table", w: 12, h: 7,
        title: "Every theme, graded: open, unclaimed, contested or owned",
        subtitle: `Themes with ${THEME_MIN}+ posts, open ones first. Posts is a count, engagement vs norm a ratio, shares are percentages of the theme's posts, and lead is the largest brand's share of the theme divided by its share of all posts (1.0 is its usual share). ${WS_NOTE}.`,
        when: N_THEMED,
        sql: `WITH ${SCORED("posts")}, ${LABEL_TAGS("sp")}, ${WS()}
SELECT theme, posts::int AS posts, ${r2("vs")} AS "engagement vs norm", leader AS "largest brand", ${r0("100.0 * lead_share")} AS "largest brand share %", ${r2("lead")} AS "its lead",
       ${r0("100.0 * brand_led")} AS "brand-owned or paid %", ${r0("100.0 * unprompted")} AS "unprompted %", ${r0("100.0 * ours / posts")} AS "our share of posts %", state
FROM ws ORDER BY CASE state WHEN 'Open' THEN 0 WHEN 'Unclaimed' THEN 1 WHEN 'Contested' THEN 2 WHEN 'Not rewarded' THEN 5 WHEN 'Brand-seeded' THEN 4 ELSE 3 END, vs DESC NULLS LAST, theme`,
        rationale: "Where each conversation stands: free to take, running without a brand, fought over, or somebody's already.",
      },
      {
        type: "table", w: 12, h: 6,
        title: "White space by market",
        subtitle: `The same grading run inside each of the five largest markets: the themes that are open or unclaimed there, with ${THEME_MIN}+ posts in that market. A theme owned overall can be open in one market. Shares are percentages of the theme's posts in the market.`,
        when: N_THEMED,
        sql: `WITH ${SCORED("posts")}, ${LABEL_TAGS("sp")},
mk AS MATERIALIZED (SELECT country, count(*) AS n FROM tags WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5),
${WS("country IN (SELECT country FROM mk)", "country")}
SELECT ws.country AS market, ws.theme, ws.state, ws.posts::int AS posts, ${r2("ws.vs")} AS "engagement vs norm", ws.leader AS "largest brand", ${r0("100.0 * ws.lead_share")} AS "largest brand share %",
       ${r0("100.0 * ws.brand_led")} AS "brand-owned or paid %", ${r0("100.0 * ws.ours / ws.posts")} AS "our share of posts %"
FROM ws JOIN mk USING (country) WHERE ws.state IN ('Open', 'Unclaimed') ORDER BY mk.n DESC, ws.country, (ws.state = 'Open') DESC, ws.vs DESC, ws.theme`,
        rationale: "White space is local. A market where nobody has claimed a rewarded theme is where to brief first.",
      },
      {
        type: "bar", w: 12, h: 6,
        title: "Content gap, in points",
        subtitle: `A theme's share of all comments minus its share of posts (themes with ${THEME_MIN}+ posts). Above zero: people talk about it more than creators post about it.`,
        when: N_THEMED,
        sql: `WITH ${LABEL_TAGS("posts")},
tot AS MATERIALIZED (SELECT count(*)::float AS posts, NULLIF(sum(coalesce(comments, 0)), 0) AS comments FROM tags),
t AS (SELECT theme, count(*)::float AS posts, sum(coalesce(comments, 0)) AS comments FROM tags GROUP BY 1)
SELECT t.theme, ${r1("100.0 * t.comments / tot.comments - 100.0 * t.posts / tot.posts")} AS value
FROM t, tot WHERE t.posts >= ${THEME_MIN} AND tot.comments IS NOT NULL AND 100.0 * t.comments / tot.comments - 100.0 * t.posts / tot.posts > 0.05 ORDER BY 2 DESC LIMIT 12`,
        x: "theme", y: "value", horizontal: true, format: "points", unit: "Percentage points: share of comments minus share of posts",
        rationale: "Demand the creators are not meeting yet.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "Questions about the brand that nobody answered",
        subtitle: "Questions in the brand comments on our content, grouped by what they ask about: how many were asked, how many got no reply, and the most-liked unanswered one. Questions about the creator (\"where is your hat from?\") are left out.",
        when: N_QUESTIONS,
        sql: `WITH q AS (
  SELECT coalesce(${ATTR()}, 'Other questions about the product') AS topic, coalesce(faq_phrase, text) AS question, coalesce(likes, 0) AS likes, coalesce(reply_count, 0) AS replies
  FROM brand_comments WHERE brand = focal_brand() AND faq_topic IS NOT NULL
), top AS (SELECT DISTINCT ON (topic) topic, left(question, 160) AS example FROM q WHERE replies = 0 ORDER BY topic, likes DESC)
SELECT q.topic AS "asks about", count(*)::int AS questions, count(*) FILTER (WHERE q.replies = 0)::int AS unanswered, coalesce(sum(q.likes) FILTER (WHERE q.replies = 0), 0)::int AS "likes on unanswered", top.example AS "most-liked unanswered"
FROM q LEFT JOIN top USING (topic) GROUP BY q.topic, top.example ORDER BY 3 DESC, 4 DESC`,
        sample: OUR_BC,
        rationale: "Every unanswered question about the product is a piece of content somebody already asked for.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "Benefits nobody claims",
        subtitle: "For each product attribute across the tracked brands: its share of the benefits claimed in captions (every post, adverts and the brands' own included), against its share of the praise in brand comments. Open: the audience praises it at least 5 points more than creators claim it. Crowded: claimed at least 5 points more than praised. Counts are posts and comments; shares are percentages.",
        when: N_CLAIMS,
        sql: `WITH ${CLAIM_GAP("true")}
SELECT ${ATTR("j.attribute")} AS attribute, j.claims::int AS "posts claiming it", ${r1("j.cs")} AS "share of claims %", j.praise::int AS "comments praising it", ${r1("j.ps")} AS "share of praise %", ${r1("j.ps - j.cs")} AS "gap, points",
       CASE WHEN j.ps - j.cs >= 5 THEN 'Open' WHEN j.ps - j.cs <= -5 THEN 'Crowded' WHEN j.ps IS NULL OR j.cs IS NULL THEN 'Too little to say' ELSE 'In line' END AS read
FROM j ORDER BY j.ps - j.cs DESC NULLS LAST`,
        sample: { sql: `SELECT count(*)::int AS n FROM brand_comments WHERE attribute IS NOT NULL AND ${POSITIVE}`, min: COMMENT_MIN, unit: "comments praising an attribute" },
        rationale: "The brief asks which benefits nobody claims. A benefit the audience praises unprompted and creators rarely claim is white space for the message.",
      },
      {
        type: "stacked_bar", w: 5, h: 6,
        title: "Platforms we under-use",
        subtitle: "Share of posts by platform: us against the tracked competitors",
        when: N_COMPETITORS,
        sql: `SELECT CASE WHEN brand = focal_brand() THEN 'Us' ELSE 'Competitors' END AS who, platform, count(*)::int AS value
FROM posts WHERE platform IS NOT NULL GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC`,
        x: "who", y: "value", series: "platform", colorBy: "platform", normalize: true, unit: "Share of posts, in percent",
        rationale: "A platform where rivals post and we do not is either a gap or a decision.",
      },
      {
        type: "table", w: 7, h: 5,
        title: "Audiences with more demand than creators",
        subtitle: "Creator countries across the tracked brands, ranked by comments per post, an average (countries with 10+ posts). The data has the creator's country, not the audience's age or gender.",
        sql: `WITH ${SCORED("posts")},
c AS (
  SELECT country, count(*)::int AS posts, count(DISTINCT influencer_id)::int AS creators, sum(coalesce(comments, 0)) AS comments,
         count(*) FILTER (WHERE brand = focal_brand())::int AS ours, ${vs()} AS vs
  FROM sp WHERE country IS NOT NULL AND country <> 'Unknown' GROUP BY 1
)
SELECT c.country, c.creators, c.posts, c.ours AS "our posts", ${r1("c.comments::float / c.posts")} AS "comments per post", ${r2("c.vs")} AS "engagement vs norm"
FROM c WHERE c.posts >= 10 ORDER BY c.comments::float / c.posts DESC LIMIT 10`,
        rationale: "Where few creators serve an audience that talks back a lot, the next creator gets heard.",
      },
      {
        type: "table", w: 5, h: 5,
        title: "Hooks we under-use",
        subtitle: "Share of posts told each way (tutorial, review, routine and so on): ours, the tracked competitors', and the gap in percentage points. Most under-used first. A post can use more than one hook.",
        when: N_HOOKS,
        sql: `WITH n AS MATERIALIZED (SELECT count(*) FILTER (WHERE brand = focal_brand())::float AS us, count(*) FILTER (WHERE brand <> focal_brand())::float AS them FROM posts),
h AS (
  SELECT ph.hook, count(*) FILTER (WHERE p.brand = focal_brand())::float AS us, count(*) FILTER (WHERE p.brand <> focal_brand())::float AS them
  FROM post_hooks ph JOIN posts p ON p.segment_id = ph.segment_id AND p.post_id = ph.post_id GROUP BY 1
)
SELECT h.hook, ${r1("100.0 * h.us / NULLIF(n.us, 0)")} AS "our share of posts %", ${r1("100.0 * h.them / NULLIF(n.them, 0)")} AS "competitors share %", ${r1("100.0 * h.us / NULLIF(n.us, 0) - 100.0 * h.them / NULLIF(n.them, 0)")} AS "gap pts"
FROM h, n ORDER BY 4 ASC NULLS LAST`,
        rationale: "A way of telling the story that works for rivals and that we rarely use.",
      },
    ],
  },
  {
    title: "3. What do people say about us, our rivals and our products?",
    when: N_BC,
    widgets: [
      {
        type: "insight", w: 12, h: 7,
        title: "The answer: what to amplify, answer and attack",
        subtitle: `Composed from the brand comments in this section, by product attribute. Rates are per 1,000 brand comments. ${BC_NOTE}.`,
        sql: `WITH ${ATTR_RATES},
us AS (SELECT attribute, n, 1000.0 * pos / total AS praise, 1000.0 * neg / total AS obj FROM ar WHERE brand = focal_brand() AND n >= 5),
them AS (SELECT attribute, avg(1000.0 * pos / total) AS praise, avg(1000.0 * neg / total) AS obj FROM ar WHERE brand <> focal_brand() GROUP BY 1),
worst AS (SELECT DISTINCT ON (attribute) attribute, brand, 1000.0 * neg / total AS obj FROM ar WHERE brand <> focal_brand() AND n >= 5 ORDER BY attribute, neg / total DESC),
amp AS (SELECT us.*, them.praise AS t_praise, row_number() OVER (ORDER BY us.praise DESC) AS rk FROM us LEFT JOIN them USING (attribute) WHERE us.praise > 0),
ans AS (SELECT us.*, them.obj AS t_obj, row_number() OVER (ORDER BY us.obj DESC) AS rk FROM us LEFT JOIN them USING (attribute) WHERE us.obj > 0),
att AS (SELECT worst.attribute, worst.brand, worst.obj AS t_obj, coalesce(us.obj, 0) AS obj, row_number() OVER (ORDER BY worst.obj - coalesce(us.obj, 0) DESC) AS rk FROM worst LEFT JOIN us USING (attribute) WHERE worst.obj - coalesce(us.obj, 0) > 0)
SELECT 'Three to amplify, three to answer, three to attack' AS headline,
  '<h3>Amplify: what people praise us for</h3>' || coalesce((SELECT '<ul>' || string_agg(${li(`'<strong>' || ${ATTR("amp.attribute")} || '</strong>: ' || round(amp.praise::numeric, 1) || ' praise comments per 1,000' || CASE WHEN amp.t_praise IS NOT NULL THEN ' (rivals average ' || round(amp.t_praise::numeric, 1) || ')' ELSE '' END || '.'`)}, '' ORDER BY amp.rk) || '</ul>' FROM amp WHERE rk <= 3), '<p>Not enough praise by attribute yet.</p>')
  || '<h3>Answer: what people object to</h3>' || coalesce((SELECT '<ul>' || string_agg(${li(`'<strong>' || ${ATTR("ans.attribute")} || '</strong>: ' || round(ans.obj::numeric, 1) || ' objections per 1,000' || CASE WHEN ans.t_obj IS NOT NULL THEN ' (rivals average ' || round(ans.t_obj::numeric, 1) || ')' ELSE '' END || '.'`)}, '' ORDER BY ans.rk) || '</ul>' FROM ans WHERE rk <= 3), '<p>No objections by attribute in this period.</p>')
  || '<h3>Attack: where a rival is weaker than us</h3>' || coalesce((SELECT '<ul>' || string_agg(${li(`'<strong>' || ${ATTR("att.attribute")} || '</strong>: ' || att.brand || ' draws ' || round(att.t_obj::numeric, 1) || ' objections per 1,000 against our ' || round(att.obj::numeric, 1) || '.'`)}, '' ORDER BY att.rk) || '</ul>' FROM att WHERE rk <= 3), '<p>No rival with ${COMMENT_MIN} or more brand comments is weaker than us on an attribute.</p>') AS body`,
        sample: OUR_BC,
        rationale: "The brief's output for this question: 3 things to amplify, 3 to answer and 3 to attack.",
      },
      {
        type: "insight", w: 12, h: 7,
        title: "Briefs to amplify, answer and attack",
        subtitle: `The first thing to amplify, to answer and to attack from the list above, each with the words to use, who should say it and the audience to put paid behind it. The creators are the ones under whose posts our audience already praises that attribute (2+ praise comments). ${BC_NOTE}.`,
        sql: `WITH ${ATTR_RATES},
us AS (SELECT attribute, n, 1000.0 * pos / total AS praise, 1000.0 * neg / total AS obj FROM ar WHERE brand = focal_brand() AND n >= 5),
worst AS (SELECT DISTINCT ON (attribute) attribute, brand, 1000.0 * neg / total AS obj FROM ar WHERE brand <> focal_brand() AND n >= 5 ORDER BY attribute, neg / total DESC),
picks AS (
  (SELECT 1 AS ord, 'Amplify' AS kind, attribute, NULL::text AS rival FROM us WHERE praise > 0 ORDER BY praise DESC, attribute LIMIT 1)
  UNION ALL (SELECT 2, 'Answer', attribute, NULL FROM us WHERE obj > 0 ORDER BY obj DESC, attribute LIMIT 1)
  UNION ALL (SELECT 3, 'Attack', worst.attribute, worst.brand FROM worst LEFT JOIN us USING (attribute) WHERE worst.obj - coalesce(us.obj, 0) > 0 ORDER BY worst.obj - coalesce(us.obj, 0) DESC, worst.attribute LIMIT 1)
),
oc AS MATERIALIZED (
  SELECT p.username, p.segment_id, p.influencer_id, c.attribute, c.text, coalesce(c.likes, 0) AS likes, (c.${POSITIVE}) AS pos, (c.sentiment = 'negative' OR c.objection_category IS NOT NULL) AS neg
  FROM brand_comments c JOIN posts p ON p.segment_id = c.segment_id AND p.post_id = c.post_id
  WHERE c.brand = focal_brand() AND c.attribute IS NOT NULL AND p.username IS NOT NULL AND NOT p.is_owned
),
cr AS (SELECT attribute, username, count(*) FILTER (WHERE pos) AS k, row_number() OVER (PARTITION BY attribute ORDER BY count(*) FILTER (WHERE pos) DESC, username) AS rk FROM oc GROUP BY 1, 2 HAVING count(*) FILTER (WHERE pos) >= 2),
crn AS (SELECT attribute, string_agg(username || ' (' || k || ')', ', ' ORDER BY rk) AS names FROM cr WHERE rk <= 3 GROUP BY 1),
qp AS (SELECT DISTINCT ON (attribute) attribute, left(text, 150) AS said FROM oc WHERE pos AND length(text) >= 25 ORDER BY attribute, likes DESC, text),
qn AS (SELECT DISTINCT ON (attribute) attribute, left(text, 150) AS said FROM oc WHERE neg AND length(text) >= 20 ORDER BY attribute, likes DESC, text),
ai AS MATERIALIZED (
  SELECT DISTINCT ON (i.influencer_id) i.influencer_id, i.audience_female, i.audience_ages, i.audience_countries
  FROM (SELECT DISTINCT segment_id, influencer_id FROM oc) o JOIN influencers i ON i.segment_id = o.segment_id AND i.influencer_id = o.influencer_id
  WHERE i.audience_female IS NOT NULL AND jsonb_typeof(i.audience_ages) = 'object' ORDER BY i.influencer_id, i.segment_id
), an AS (SELECT count(*)::float AS k, avg(audience_female) AS female FROM ai HAVING count(*) >= 5),
ages AS (SELECT string_agg(band || ' (' || ${pct("w")} || '%)', ' and ' ORDER BY w DESC) AS bands FROM (SELECT e.key AS band, sum(e.value::float) / max(an.k) AS w FROM ai, an, jsonb_each_text(ai.audience_ages) e GROUP BY 1 ORDER BY 2 DESC LIMIT 2) y),
geo AS (SELECT string_agg(country || ' (' || ${pct("w")} || '%)', ', ' ORDER BY w DESC) AS places FROM (
  SELECT c.value ->> 'name' AS country, sum((c.value ->> 'weight')::float) / max(an.k) AS w
  FROM ai, an, jsonb_array_elements(CASE WHEN jsonb_typeof(ai.audience_countries) = 'array' THEN ai.audience_countries ELSE '[]'::jsonb END) c WHERE c.value ->> 'name' IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 3) z),
n AS (SELECT count(*) AS k FROM picks)
SELECT CASE WHEN n.k = 0 THEN 'Not enough brand comments by attribute to brief yet' ELSE n.k || CASE WHEN n.k = 1 THEN ' brief' ELSE ' briefs' END || ' from what people say' END AS headline,
  CASE WHEN n.k = 0 THEN '<p>Try a longer period or all markets.</p>' ELSE
  (SELECT string_agg('<h3>' || picks.kind || ': ' || lower(coalesce(${ATTR("picks.attribute")}, picks.attribute)) || CASE WHEN picks.rival IS NOT NULL THEN ', against ' || picks.rival ELSE '' END || '</h3><ul>'
    || CASE picks.kind
         WHEN 'Amplify' THEN ${li(`'<strong>What to say:</strong> lead with it. People already praise us for it' || coalesce(': “' || qp.said || '”', '.')`)}
         WHEN 'Answer' THEN ${li(`'<strong>What to say:</strong> answer it before it is raised, in content and in customer care' || coalesce('. The objection in their words: “' || qn.said || '”', '.')`)}
         ELSE ${li(`'<strong>What to say:</strong> comparison content on the point where ' || picks.rival || ' draws more objections than we do' || coalesce('. What our own audience says: “' || qp.said || '”', '.')`)} END
    || ${li(`'<strong>Who should say it:</strong> ' || coalesce(crn.names || '. The figure is praise comments on this attribute under their posts about us.', 'no creator of ours has two or more praise comments on this attribute yet, so start with the creators in the theme briefs.')`)}
    || CASE WHEN (SELECT k FROM an) IS NOT NULL THEN ${li(`'<strong>Paid audience:</strong> ' || (SELECT CASE WHEN female >= 0.5 THEN ${pct("female")} || '% women' ELSE ${pct("1 - female")} || '% men' END FROM an) || coalesce(', mostly aged ' || (SELECT bands FROM ages), '') || coalesce(', in ' || (SELECT places FROM geo), '') || '. The average audience of the ' || (SELECT k::int FROM an) || ' creators under whose posts these comments were written and whose audience is known.'`)} ELSE '' END
    || '</ul>', '' ORDER BY picks.ord)
   FROM picks LEFT JOIN crn USING (attribute) LEFT JOIN qp USING (attribute) LEFT JOIN qn USING (attribute)) END AS body
FROM n`,
        sample: OUR_BC,
        rationale: "The brief says each answer becomes a brief, a creator and a paid audience. This does it for what people say.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "What people love and hate, by attribute",
        subtitle: `Praise and objections per 1,000 brand comments, us against the average tracked rival (rivals with ${COMMENT_MIN}+ brand comments). The six attributes are price, efficacy, ease, durability, safety and service.`,
        sql: `WITH ${ATTR_RATES}
SELECT ${ATTR("attribute")} AS attribute, ${r1("max(1000.0 * pos / total) FILTER (WHERE brand = focal_brand())")} AS "our praise per 1K", ${r1("avg(1000.0 * pos / total) FILTER (WHERE brand <> focal_brand())")} AS "rivals praise per 1K",
       ${r1("max(1000.0 * neg / total) FILTER (WHERE brand = focal_brand())")} AS "our objections per 1K", ${r1("avg(1000.0 * neg / total) FILTER (WHERE brand <> focal_brand())")} AS "rivals objections per 1K"
FROM ar GROUP BY attribute ORDER BY sum(n) FILTER (WHERE brand = focal_brand()) DESC NULLS LAST`,
        sample: OUR_BC,
        rationale: "What to lead claims with, and what to fix or answer, measured like for like against rivals.",
      },
      {
        type: "bar", w: 5, h: 6,
        title: "Buying signals per 1,000 brand comments",
        subtitle: `Comments signalling a purchase ("where can I get it", "just ordered"), us and each rival (brands with ${COMMENT_MIN}+ brand comments). A rate, not a count.`,
        sql: `SELECT brand, ${r1(`1000.0 * count(*) FILTER (WHERE ${INTENT}) / count(*)`)} AS value
FROM brand_comments GROUP BY brand HAVING count(*) >= ${COMMENT_MIN} OR brand = focal_brand() ORDER BY value DESC`,
        x: "brand", y: "value", colorBy: "brand", format: "decimal", horizontal: true, unit: "Buying signals per 1,000 brand comments (a rate)",
        sample: OUR_BC,
        rationale: "Whether our conversation converts better or worse than theirs.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "Objections that matter most",
        subtitle: "Objections in our brand comments by attribute. Weight is the number of objections plus the likes they collected: a liked objection means others agree. With the most-liked one, verbatim.",
        sql: `WITH o AS MATERIALIZED (SELECT coalesce(${ATTR()}, 'Other') AS attribute, coalesce(objection_phrase, text) AS said, coalesce(likes, 0) AS likes FROM brand_comments WHERE brand = focal_brand() AND ${NEGATIVE}),
top AS (SELECT DISTINCT ON (attribute) attribute, left(said, 170) AS example FROM o ORDER BY attribute, likes DESC)
SELECT o.attribute, count(*)::int AS objections, sum(o.likes)::int AS likes, (count(*) + sum(o.likes))::int AS weight, top.example AS "most-liked, verbatim"
FROM o JOIN top USING (attribute) GROUP BY o.attribute, top.example ORDER BY 4 DESC`,
        sample: OUR_BC,
        rationale: "An objection many people agree with costs more than one said often.",
      },
      {
        type: "table", w: 5, h: 6,
        title: "Where rivals are weak and we are strong",
        subtitle: `Objections per 1,000 brand comments by attribute: ours, the weakest rival's, and the gap (rivals with ${COMMENT_MIN}+ brand comments). A positive gap is a comparison we win.`,
        when: N_COMPETITORS,
        sql: `WITH ${ATTR_RATES},
us AS (SELECT attribute, 1000.0 * neg / total AS rate FROM ar WHERE brand = focal_brand()),
worst AS (SELECT DISTINCT ON (attribute) attribute, brand, 1000.0 * neg / total AS rate FROM ar WHERE brand <> focal_brand() AND n >= 5 ORDER BY attribute, neg / total DESC)
SELECT ${ATTR("worst.attribute")} AS attribute, ${r1("coalesce(us.rate, 0)")} AS "ours per 1K", worst.brand AS "weakest rival", ${r1("worst.rate")} AS "theirs per 1K", ${r1("worst.rate - coalesce(us.rate, 0)")} AS "gap per 1K"
FROM worst LEFT JOIN us USING (attribute) ORDER BY worst.rate - coalesce(us.rate, 0) DESC`,
        sample: OUR_BC,
        rationale: "A positive gap is a claim we can make and they cannot.",
      },
      {
        type: "table", w: 12, h: 7,
        title: "What people say, by product",
        subtitle: `Each product line of each tracked brand (lines with 20+ posts): posts and brand comments are counts, engagement vs norm is a ratio, praise, objections and buying signals are per 1,000 of the line's brand comments and shown only with ${COMMENT_MIN}+ of them. ${PRODUCT_NOTE}.`,
        when: N_PRODUCTS,
        sql: `WITH ${SCORED("posts")},
pp AS (SELECT brand, product, count(*)::int AS posts, sum(eng_s) / NULLIF(sum(expected), 0) AS vs FROM sp WHERE product IS NOT NULL GROUP BY 1, 2),
pc AS (
  SELECT brand, product, count(*)::float AS n, count(*) FILTER (WHERE ${POSITIVE}) AS pos, count(*) FILTER (WHERE ${NEGATIVE}) AS neg, count(*) FILTER (WHERE ${INTENT}) AS intent
  FROM brand_comments WHERE product IS NOT NULL GROUP BY 1, 2
)
SELECT pp.brand, pp.product, pp.posts, ${r2("pp.vs")} AS "engagement vs norm", coalesce(pc.n, 0)::int AS "brand comments",
       CASE WHEN pc.n >= ${COMMENT_MIN} THEN ${r1("1000.0 * pc.pos / pc.n")} END AS "praise per 1K",
       CASE WHEN pc.n >= ${COMMENT_MIN} THEN ${r1("1000.0 * pc.neg / pc.n")} END AS "objections per 1K",
       CASE WHEN pc.n >= ${COMMENT_MIN} THEN ${r1("1000.0 * pc.intent / pc.n")} END AS "buying signals per 1K"
FROM pp LEFT JOIN pc USING (brand, product) WHERE pp.posts >= 20 ORDER BY (pp.brand = focal_brand()) DESC, pp.brand, pp.posts DESC`,
        rationale: "The brief's matrix has four rows: my brand, competitor brands, my products, competitor products. This is the product half.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "Are we saying what people value?",
        subtitle: "For each product attribute: its share of the benefits claimed in posts about us, against its share of the praise in our brand comments. Say it more: people praise it at least 5 points more than our content claims it. Over-said: claimed at least 5 points more than praised. Counts are posts and comments; shares are percentages.",
        when: N_OUR_CLAIMS,
        sql: `WITH ${CLAIM_GAP("brand = focal_brand()")}
SELECT ${ATTR("j.attribute")} AS attribute, j.claims::int AS "our posts claiming it", ${r1("j.cs")} AS "share of our claims %", j.praise::int AS "comments praising it", ${r1("j.ps")} AS "share of our praise %", ${r1("j.ps - j.cs")} AS "gap, points",
       CASE WHEN j.ps - j.cs >= 5 THEN 'Say it more' WHEN j.ps - j.cs <= -5 THEN 'Over-said' WHEN j.ps IS NULL OR j.cs IS NULL THEN 'Too little to say' ELSE 'In line' END AS read
FROM j ORDER BY j.ps - j.cs DESC NULLS LAST`,
        sample: { sql: `SELECT count(*)::int AS n FROM brand_comments WHERE brand = focal_brand() AND attribute IS NOT NULL AND ${POSITIVE}`, min: COMMENT_MIN, unit: "comments praising an attribute of ours" },
        rationale: "The brief's last question on what people say: is the message in our content the one the audience gives back?",
      },
      {
        type: "table", w: 12, h: 5,
        title: "Amplify, answer and attack, by product",
        subtitle: `For each product line, ours first: the three attributes praised most and the three objected to most, each with its rate per 1,000 of the line's brand comments (attributes with 5+ mentions). Amplify and answer for our lines; attack for rivals' lines. ${PRODUCT_RATE_NOTE}.`,
        when: N_PRODUCT_COMMENTS,
        sql: `WITH ${PRODUCT_RATES},
r AS (
  SELECT par.*, row_number() OVER (PARTITION BY brand, product ORDER BY pos DESC, attribute) AS rp, row_number() OVER (PARTITION BY brand, product ORDER BY neg DESC, attribute) AS rn
  FROM par WHERE n >= 5
)
SELECT brand, product, max(total)::int AS "brand comments",
       string_agg(lower(${ATTR("attribute")}) || ' (' || ${r1("1000.0 * pos / total")} || ')', ', ' ORDER BY rp) FILTER (WHERE rp <= 3 AND pos > 0) AS "praised most (per 1K)",
       string_agg(lower(${ATTR("attribute")}) || ' (' || ${r1("1000.0 * neg / total")} || ')', ', ' ORDER BY rn) FILTER (WHERE rn <= 3 AND neg > 0) AS "objected to most (per 1K)",
       CASE WHEN brand = focal_brand() THEN 'Amplify the praise, answer the objections' ELSE 'Attack where they draw objections, and do not fight their praise head-on' END AS "use it to"
FROM r GROUP BY brand, product ORDER BY (brand = focal_brand()) DESC, max(total) DESC`,
        rationale: "The brief's output: for each brand and product, 3 things to amplify, 3 to answer and 3 to attack.",
      },
      {
        type: "table", w: 12, h: 6,
        title: "Who switches to whom",
        subtitle: "Brand comments across the tracked brands in which the commenter says they moved from one brand or method to another, or says one is better, as flows from and to (3+ comments). Flows to us first. Counts of comments: statements, not sales. Anything that is not a tracked brand is named as the commenter wrote it.",
        when: N_SWITCHES,
        sql: `SELECT switch_from AS "from", switch_to AS "to", count(*) FILTER (WHERE switch_kind = 'switched')::int AS "say they switched", count(*) FILTER (WHERE switch_kind = 'prefers')::int AS "say it is better",
       count(*)::int AS comments, (array_agg(left(text, 140) ORDER BY likes DESC NULLS LAST, comment_id))[1] AS "in their words"
FROM brand_comments WHERE switch_kind IS NOT NULL AND switch_from IS NOT NULL AND switch_to IS NOT NULL
GROUP BY 1, 2 HAVING count(*) >= 3 ORDER BY (switch_to = focal_brand()) DESC, (switch_from = focal_brand()) DESC, count(*) DESC, 1, 2 LIMIT 30`,
        rationale: "The brief asks who switches to whom as flows between brands: where we win people from, and where we lose them to.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Who people compare us with",
        subtitle: "Other brands and methods named in our brand comments (as written by commenters), and who the commenter favoured. Counts of comments.",
        when: N_RIVAL_MENTIONS,
        sql: `SELECT initcap(lower(trim(competitor_name))) AS brand, count(*)::int AS mentions,
       count(*) FILTER (WHERE competitor_favored = 'focal_brand')::int AS "favour us", count(*) FILTER (WHERE competitor_favored = 'competitor')::int AS "favour them",
       count(*) FILTER (WHERE competitor_mention_type = 'preference')::int AS preferences, count(*) FILTER (WHERE competitor_mention_type = 'comparison')::int AS comparisons
FROM brand_comments WHERE brand = focal_brand() AND competitor_name IS NOT NULL AND ${NOT_SELF("competitor_name")}
GROUP BY 1 HAVING count(*) >= 2 ORDER BY 2 DESC LIMIT 12`,
        sample: OUR_BC,
        rationale: "Who we are really compared with, in the audience's words, and who wins the comparison.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "What stops people buying",
        subtitle: "Brand comments that want to buy but name a condition (\"if it were cheaper\", \"not available here\"), grouped by what stands in the way, with the most-liked one. Counts of comments.",
        when: N_BLOCKERS,
        sql: `WITH k AS (
  SELECT coalesce(${ATTR()}, 'Other') AS blocker, text, coalesce(likes, 0) AS likes
  FROM brand_comments WHERE brand = focal_brand() AND (purchase_blocker IS NOT NULL OR purchase_intent_type = 'conditional')
), top AS (SELECT DISTINCT ON (blocker) blocker, left(text, 160) AS example FROM k ORDER BY blocker, likes DESC)
SELECT k.blocker AS "what stands in the way", count(*)::int AS comments, sum(k.likes)::int AS likes, top.example AS "most-liked, verbatim"
FROM k JOIN top USING (blocker) GROUP BY k.blocker, top.example ORDER BY 2 DESC`,
        sample: OUR_BC,
        rationale: "Each one is a sale waiting on a fix or an answer.",
      },
      {
        type: "table", w: 12, h: 6,
        title: "What the copy should say",
        subtitle: "The most-liked positive comments about our product, three per attribute, in their own words",
        sql: `WITH c AS (
  SELECT ${ATTR()} AS attribute, left(text, 220) AS said, coalesce(likes, 0)::int AS likes, username,
         row_number() OVER (PARTITION BY attribute ORDER BY likes DESC NULLS LAST) AS rk
  FROM brand_comments WHERE brand = focal_brand() AND about = 'brand' AND attribute IS NOT NULL AND ${POSITIVE} AND length(text) >= 25
)
SELECT attribute, said AS "in their words", likes, username AS "said by" FROM c WHERE rk <= 3 ORDER BY attribute, likes DESC`,
        sample: OUR_BC,
        rationale: "The audience already wrote the best lines.",
      },
    ],
  },
  {
    title: "4. Which creators win in each conversation?",
    widgets: [
      {
        type: "insight", w: 12, h: 4,
        title: "The answer: creators to brief first",
        subtitle: `Composed from the creator score below. ${SCORE_NOTE}.`,
        sql: `WITH ${CREATOR_SCORE},
pick AS (SELECT cs.*, row_number() OVER (ORDER BY score DESC) AS rk FROM cs WHERE rel IN ('unpaid', 'rivals only')), top AS (SELECT * FROM pick WHERE rk <= 5), n AS (SELECT count(*) AS k FROM top)
SELECT CASE WHEN n.k = 0 THEN 'No creator with two or more posts in this period' ELSE 'The ' || n.k || ' highest-scoring creators we have not paid' END AS headline,
       CASE WHEN n.k = 0 THEN '<p>Try a longer period.</p>' ELSE (SELECT '<ul>' || string_agg(${li(`'<strong>' || top.creator || '</strong> (' || coalesce(top.platform, '') || ', score ' || round(top.score::numeric, 0) || '): engagement ' || ${x2("top.vs")} || ' the norm over ' || top.posts || ' posts'
         || CASE WHEN top.theme IS NOT NULL THEN ', mostly on ' || lower(top.theme) ELSE '' END || CASE WHEN top.rel = 'rivals only' THEN '. Posts about ' || top.brands || ', not yet about us' ELSE '. Already posts about us unpaid' END || '.'`)}, '' ORDER BY top.rk) || '</ul>' FROM top) END AS body
FROM n`,
        rationale: "A shortlist to act on: who already wins the conversation and has not been paid by us.",
      },
      {
        type: "table", w: 12, h: 7,
        title: "Creator score: the top creators across the tracked brands",
        subtitle: `${SCORE_NOTE}. Relation says whether a post of theirs about us was paid or gifted. The fee is the supplier's modelled fee per post in US dollars, an estimate and not a quote.`,
        sql: `WITH ${CREATOR_SCORE}
SELECT creator, platform, posts, brands AS "posts about", rel AS "relation to us", ${r2("vs")} AS "engagement vs norm", theme AS "main theme", ${r0("100.0 * fit")} AS "theme fit %", ${r1("intent_k")} AS "intent per 1K", ${r0("100 * match")} AS "audience match %", ${r0("fee")} AS "est. fee per post $", avail AS availability, ${r0("score")} AS "creator score"
FROM cs ORDER BY score DESC LIMIT 15`,
        rationale: "The eighth measure: who is worth working with, scored one way for every creator.",
      },
      {
        type: "table", w: 12, h: 7,
        title: "Who drives each theme",
        subtitle: `The top 10 creators in each of the eight largest themes, ranked by creator score (creators with 2+ posts in the theme; brand-owned accounts left out). Beside the score are its parts: performance in the theme, theme fit, buying signals, audience match, estimated cost and availability. ${SCORE_NOTE}.`,
        when: N_THEMED,
        sql: `WITH ${CREATOR_SCORE}, ${LABEL_TAGS("sp")},
big AS (SELECT theme, count(*) AS n FROM tags GROUP BY 1 HAVING count(*) >= ${THEME_MIN} ORDER BY 2 DESC LIMIT 8),
c AS (
  SELECT t.theme, t.username AS creator, t.platform AS platform, count(*)::int AS posts, sum(coalesce(t.views, 0)) AS views,
         sum(t.eng_s) / NULLIF(sum(t.expected), 0) AS vs, string_agg(DISTINCT t.brand, ', ') AS brands
  FROM tags t JOIN big USING (theme) WHERE t.username IS NOT NULL AND NOT t.is_owned GROUP BY 1, 2, 3
), tv AS (SELECT theme, sum(views) AS theme_views FROM c GROUP BY 1),
r AS (
  SELECT c.*, cs.score, cs.fit, cs.intent_k, cs.match, cs.fee, cs.avail, row_number() OVER (PARTITION BY c.theme ORDER BY cs.score DESC NULLS LAST, c.views DESC, c.creator) AS rk
  FROM c LEFT JOIN cs ON cs.creator = c.creator AND cs.platform IS NOT DISTINCT FROM c.platform WHERE c.posts >= 2
)
SELECT r.theme, r.creator, r.platform, r.posts AS "posts in theme", ${r0("100.0 * r.views / NULLIF(tv.theme_views, 0)")} AS "share of theme views %", ${r2("r.vs")} AS "engagement vs norm in theme",
       ${r0("r.score")} AS "creator score", ${r0("100 * r.fit")} AS "theme fit %", ${r1("r.intent_k")} AS "intent per 1K", ${r0("100 * r.match")} AS "audience match %", ${r0("r.fee")} AS "est. fee per post $", r.avail AS availability, r.brands AS "posts about"
FROM r JOIN big USING (theme) JOIN tv USING (theme) WHERE r.rk <= 10 ORDER BY big.n DESC, r.rk`,
        rationale: "A shortlist per conversation, with who they already work with.",
      },
      {
        type: "table", w: 12, h: 7,
        title: "Who drives each product",
        subtitle: `The top 10 creators by creator score for each product line with 20+ posts, ours first (creators with 2+ posts on the line). Share of the line's views is a percentage; brand-owned accounts are left out. ${PRODUCT_NOTE}.`,
        when: N_PRODUCTS,
        sql: `WITH ${CREATOR_SCORE},
big AS (SELECT brand, product, count(*) AS n FROM sp WHERE product IS NOT NULL GROUP BY 1, 2 HAVING count(*) >= 20),
c AS (
  SELECT t.brand, t.product, t.username AS creator, t.platform AS platform, count(*)::int AS posts, sum(coalesce(t.views, 0)) AS views, sum(t.eng_s) / NULLIF(sum(t.expected), 0) AS vs
  FROM sp t JOIN big USING (brand, product) WHERE t.username IS NOT NULL AND NOT t.is_owned GROUP BY 1, 2, 3, 4
), tv AS (SELECT brand, product, sum(views) AS line_views FROM c GROUP BY 1, 2),
r AS (
  SELECT c.*, cs.score, cs.fit, cs.intent_k, cs.match, cs.fee, cs.avail, row_number() OVER (PARTITION BY c.brand, c.product ORDER BY cs.score DESC NULLS LAST, c.views DESC, c.creator) AS rk
  FROM c LEFT JOIN cs ON cs.creator = c.creator AND cs.platform IS NOT DISTINCT FROM c.platform WHERE c.posts >= 2
)
SELECT r.brand, r.product, r.creator, r.platform, r.posts AS "posts on the line", ${r0("100.0 * r.views / NULLIF(tv.line_views, 0)")} AS "share of line views %", ${r2("r.vs")} AS "engagement vs norm on the line",
       ${r0("r.score")} AS "creator score", ${r0("100 * r.fit")} AS "theme fit %", ${r1("r.intent_k")} AS "intent per 1K", ${r0("100 * r.match")} AS "audience match %", ${r0("r.fee")} AS "est. fee per post $", r.avail AS availability
FROM r JOIN big USING (brand, product) JOIN tv USING (brand, product) WHERE r.rk <= 10 ORDER BY (r.brand = focal_brand()) DESC, r.brand, big.n DESC, r.rk`,
        rationale: "The brief asks for the top creators per product, ours and competitors'.",
      },
      {
        type: "table", w: 12, h: 7,
        title: "Top 10 creators per rival",
        subtitle: "For each tracked rival, its ten creators with the highest creator score (2+ posts about it on one platform; brand-owned accounts left out), with the score's parts and whether the rival paid them and whether they also post about us. The best of them are the ones to win over.",
        when: N_COMPETITORS,
        sql: `WITH ${CREATOR_SCORE},
c AS (
  SELECT brand, username AS creator, platform, count(*)::int AS posts, sum(coalesce(views, 0)) AS views, sum(eng_s) / NULLIF(sum(expected), 0) AS vs, bool_or(is_paid) AS paid
  FROM sp WHERE brand <> focal_brand() AND username IS NOT NULL AND NOT is_owned GROUP BY 1, 2, 3 HAVING count(*) >= 2
), ours AS (SELECT DISTINCT username, platform FROM posts WHERE brand = focal_brand() AND username IS NOT NULL),
bn AS (SELECT brand, count(*) AS n FROM posts WHERE brand <> focal_brand() GROUP BY 1),
r AS (
  SELECT c.*, cs.score, cs.fit, cs.intent_k, cs.match, cs.fee, cs.avail, row_number() OVER (PARTITION BY c.brand ORDER BY cs.score DESC NULLS LAST, c.vs DESC NULLS LAST, c.creator) AS rk
  FROM c LEFT JOIN cs ON cs.creator = c.creator AND cs.platform IS NOT DISTINCT FROM c.platform
)
SELECT r.brand AS rival, r.creator, r.platform, r.posts AS "posts about them", ${r2("r.vs")} AS "engagement vs norm on them", ${r0("r.score")} AS "creator score", ${r0("100 * r.fit")} AS "theme fit %", ${r1("r.intent_k")} AS "intent per 1K", ${r0("100 * r.match")} AS "audience match %", ${r0("r.fee")} AS "est. fee per post $", r.avail AS availability,
       CASE WHEN r.paid THEN 'yes' ELSE 'no' END AS "paid by them", CASE WHEN ours.username IS NOT NULL THEN 'yes' ELSE 'no' END AS "also posts about us"
FROM r JOIN bn USING (brand) LEFT JOIN ours ON ours.username = r.creator AND ours.platform IS NOT DISTINCT FROM r.platform WHERE r.rk <= 10 ORDER BY bn.n DESC, r.brand, r.rk`,
        rationale: "The brief asks for a top 10 per competitor: rivals' best performers to win over.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Earned creators: posting about us, never paid",
        subtitle: "Creators whose posts about us carry no paid, gifted or shop marker, ranked by engagements (a count). Brand-owned accounts are left out. A partnership shortlist.",
        sql: `WITH ${SCORED("posts")}
SELECT username AS creator, max(platform) AS platform, max(tier) AS size, count(*)::int AS posts, sum(engagement)::bigint AS engagements, ${r2(vs())} AS "engagement vs norm"
FROM sp WHERE brand = focal_brand() AND username IS NOT NULL AND NOT is_owned
GROUP BY 1 HAVING NOT bool_or(is_paid) AND NOT bool_or(is_gifted) AND NOT bool_or(is_affiliate) ORDER BY 5 DESC NULLS LAST LIMIT 12`,
        rationale: "People who chose to talk about us without being asked.",
      },
      {
        type: "table", w: 6, h: 6,
        title: "Who drives buying",
        subtitle: "Creators of our content ranked by buying signals per 1,000 brand comments under their posts (20+ brand comments), against the rate across all tracked brands, as the brief asks: 1.0 is the category rate.",
        when: N_BC,
        sql: `WITH pc AS (SELECT segment_id, post_id, count(*)::float AS n, count(*) FILTER (WHERE ${INTENT})::float AS intent FROM brand_comments WHERE brand = focal_brand() GROUP BY 1, 2),
avg_rate AS MATERIALIZED (SELECT 1000.0 * count(*) FILTER (WHERE ${INTENT}) / NULLIF(count(*), 0) AS rate FROM brand_comments)
SELECT p.username AS creator, p.platform AS platform, count(DISTINCT p.post_id)::int AS posts, sum(pc.n)::int AS "brand comments",
       ${r1("1000.0 * sum(pc.intent) / sum(pc.n)")} AS "intent per 1K", ${r1("(1000.0 * sum(pc.intent) / sum(pc.n)) / NULLIF((SELECT rate FROM avg_rate), 0)")} AS "times the category rate"
FROM posts p JOIN pc ON pc.segment_id = p.segment_id AND pc.post_id = p.post_id
WHERE p.brand = focal_brand() AND p.username IS NOT NULL AND NOT p.is_owned GROUP BY 1, 2 HAVING sum(pc.n) >= 20 AND sum(pc.intent) > 0 ORDER BY 5 DESC LIMIT 12`,
        sample: OUR_BC,
        rationale: "Reach is easy to buy. These creators move people toward a purchase.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "Who works with competitors",
        subtitle: "Creators who post about rivals, the ones we share first, ranked by engagements. Brand-owned accounts are left out.",
        when: N_COMPETITORS,
        sql: `WITH ${SCORED("posts")},
c AS (
  SELECT username AS creator, platform, count(*) FILTER (WHERE brand = focal_brand())::int AS ours, count(*) FILTER (WHERE brand <> focal_brand())::int AS theirs,
         string_agg(DISTINCT brand, ', ') FILTER (WHERE brand <> focal_brand()) AS rivals, bool_or(is_paid AND brand <> focal_brand()) AS paid_by_rival, sum(engagement) AS engagement, ${vs()} AS vs
  FROM sp WHERE username IS NOT NULL AND NOT is_owned GROUP BY 1, 2
)
SELECT c.creator, c.platform, CASE WHEN c.ours > 0 THEN 'shared' ELSE 'rivals only' END AS relation, c.ours AS "our posts", c.theirs AS "rival posts", c.rivals,
       CASE WHEN c.paid_by_rival THEN 'yes' ELSE 'no' END AS "paid by a rival", ${r2("c.vs")} AS "engagement vs norm"
FROM c WHERE c.theirs > 0 ORDER BY (c.ours > 0) DESC, c.engagement DESC NULLS LAST LIMIT 15`,
        rationale: "Shared creators are a conflict or an opening. Rivals' best performers are a shortlist.",
      },
      {
        type: "bar", w: 5, h: 6,
        title: "Does performance hold when paid? Engagement vs norm",
        subtitle: "On earned, gifted, affiliate and paid posts, us against the tracked competitors. Brand-owned posts are left out. 1.0 is the norm.",
        when: N_PAID,
        sql: `WITH ${SCORED("posts")}
SELECT CASE WHEN is_paid THEN 'Paid' WHEN is_affiliate THEN 'Affiliate or shop' WHEN is_gifted THEN 'Gifted' ELSE 'Earned' END AS kind, ${r2(vs("brand = focal_brand()"))} AS us, ${r2(vs("brand <> focal_brand()"))} AS competitors
FROM sp WHERE expected IS NOT NULL AND NOT is_owned GROUP BY 1 ORDER BY 1`,
        x: "kind", format: "ratio", unit: "Engagement vs norm: 1.0× is the norm",
        rationale: "If paid posts fall below the norm, the audience can tell.",
      },
      {
        type: "table", w: 6, h: 5,
        title: "Rising creators",
        subtitle: `Creators of our content whose views grew, with engagement at 1.5 times the norm or more now. Views are counts. ${VERSUS}.`,
        when: N_HISTORY,
        sql: `WITH ${BOUNDS}, ${WINDOW_POSTS}, ${SCORED("w")},
c AS (
  SELECT username AS creator, platform, count(*) FILTER (WHERE cur)::int AS posts,
         coalesce(sum(views) FILTER (WHERE cur), 0) AS views_now, coalesce(sum(views) FILTER (WHERE NOT cur), 0) AS views_before, ${vs("cur")} AS vs
  FROM sp WHERE brand = focal_brand() AND username IS NOT NULL AND NOT is_owned GROUP BY 1, 2
)
SELECT c.creator, c.platform, c.posts, c.views_now::bigint AS "views now", c.views_before::bigint AS "views before", ${r2("c.vs")} AS "engagement vs norm"
FROM c WHERE c.posts > 0 AND c.views_now > c.views_before AND c.vs >= 1.5 ORDER BY c.views_now - c.views_before DESC LIMIT 12`,
        rationale: "Worth a conversation before their price catches up.",
      },
      {
        type: "table", w: 6, h: 5,
        title: "Who is good value",
        subtitle: "Modelled creator fees on our content by creator size: cost per 1,000 views and per 100 engagements",
        when: N_FEES,
        sql: `WITH ${SCORED("posts")},
t AS (
  SELECT tier, count(*)::int AS posts, sum((budget_min + budget_max) / 2) AS fee, sum(coalesce(views, 0)) AS views, sum(engagement) AS engagement, ${vs()} AS vs
  FROM sp WHERE brand = focal_brand() AND budget_min IS NOT NULL AND tier IS NOT NULL GROUP BY 1
)
SELECT t.tier AS "creator size", t.posts, ${r0("t.fee / t.posts")} AS "fee per post", ${r2("1000.0 * t.fee / NULLIF(t.views, 0)")} AS "cost per 1K views",
       ${r2("100.0 * t.fee / NULLIF(t.engagement, 0)")} AS "cost per 100 engagements", ${r2("t.vs")} AS "engagement vs norm"
FROM t ORDER BY 5 ASC NULLS LAST`,
        rationale: "The size of creator that buys the most attention for the money.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "Who reaches our buyer",
        subtitle: "Creators of our content with audience data: where their audience is and who it is. Only some creators have audience data.",
        when: N_AUDIENCE,
        sql: `SELECT i.username AS creator, i.network AS platform, i.followers::bigint AS followers,
       i.audience_countries->0->>'name' AS "top audience country", ${r0("100 * (i.audience_countries->0->>'weight')::float")} AS "audience in that country %",
       ${r0("100 * i.audience_female")} AS "women %", count(p.post_id)::int AS "posts about us", coalesce(sum(p.engagement), 0)::bigint AS engagements
FROM influencers i JOIN posts p ON p.segment_id = i.segment_id AND p.influencer_id = i.influencer_id
WHERE i.brand = focal_brand() AND i.audience_countries IS NOT NULL AND jsonb_typeof(i.audience_countries) = 'array' AND NOT p.is_owned
GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 8 DESC LIMIT 12`,
        rationale: "Performance only matters if the audience is the buyer.",
      },
    ],
  },
  {
    title: "5. What should we build or fix?",
    when: N_BC,
    widgets: [
      {
        type: "insight", w: 12, h: 4,
        title: "The answer: fix, protect, start talking about",
        subtitle: "Composed from the priority grid below: each product attribute in our brand comments placed by how often it comes up and how people feel about it.",
        sql: `WITH ${ATTR_RATES}, ${GRID("brand = focal_brand()")},
x AS (SELECT box, string_agg('<strong>' || ${ATTR("attribute")} || '</strong> (' || mentions::int || ' comments, net sentiment ' || round((100 * net)::numeric, 0) || ')', ' · ' ORDER BY mentions DESC) AS items FROM grid GROUP BY 1)
SELECT 'What to fix, protect and start talking about' AS headline,
  '<ul>' || ${li(`'<strong>Fix first</strong> (talked about a lot, liked less than our average): ' || coalesce((SELECT items FROM x WHERE box = 'Fix first'), 'nothing in this period') || '.'`)}
         || ${li(`'<strong>Protect</strong> (talked about a lot and liked): ' || coalesce((SELECT items FROM x WHERE box = 'Protect'), 'nothing in this period') || '.'`)}
         || ${li(`'<strong>Start talking about</strong> (liked, rarely mentioned): ' || coalesce((SELECT items FROM x WHERE box = 'Start talking about'), 'nothing in this period') || '.'`)} || '</ul>'
  || '<p>Net sentiment is praise minus objections as a share of the attribute''s comments, from -100 to 100.</p>' AS body`,
        sample: OUR_BC,
        rationale: "Four boxes turned into three instructions for the product team.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "Product priority grid",
        subtitle: "Each attribute in our brand comments: mentions (a count), mentions per 1,000 brand comments (a rate), and net sentiment (praise minus objections as a share of its comments, -100 to 100). Fix first: talked about a lot and liked less than our average. Protect: talked about a lot and liked. Start talking about: liked but rarely mentioned.",
        sql: `WITH ${ATTR_RATES}, ${GRID("brand = focal_brand()")}
SELECT ${ATTR("attribute")} AS attribute, mentions::int AS mentions, ${r1("per_k")} AS "per 1K brand comments", ${r0("100 * net")} AS "net sentiment", ${r0("100 * (net - avg_net)")} AS "vs our average pts", neg::int AS objections, box AS priority
FROM grid ORDER BY CASE box WHEN 'Fix first' THEN 0 WHEN 'Protect' THEN 1 WHEN 'Start talking about' THEN 2 ELSE 3 END, mentions DESC`,
        sample: OUR_BC,
        rationale: "Four boxes: what to fix, what to protect, what to start saying, and what to leave.",
      },
      {
        type: "table", w: 12, h: 5,
        title: "Where competitor products are weak: their \"fix first\" box",
        subtitle: `The same grid for each rival with ${COMMENT_MIN}+ brand comments, showing the attributes that land in their "fix first" box, with the most-liked objection. Their objections become our spec.`,
        when: N_COMPETITORS,
        sql: `WITH ${ATTR_RATES}, ${GRID("brand <> focal_brand() AND total >= " + COMMENT_MIN)},
ex AS (SELECT DISTINCT ON (brand, attribute) brand, attribute, left(coalesce(objection_phrase, text), 150) AS example FROM brand_comments WHERE brand <> focal_brand() AND attribute IS NOT NULL AND ${NEGATIVE} ORDER BY brand, attribute, likes DESC NULLS LAST)
SELECT grid.brand, ${ATTR("grid.attribute")} AS attribute, grid.mentions::int AS mentions, ${r1("1000.0 * grid.neg / (SELECT n FROM tot WHERE tot.brand = grid.brand)")} AS "objections per 1K", ${r0("100 * grid.net")} AS "net sentiment", ex.example AS "most-liked objection"
FROM grid LEFT JOIN ex ON ex.brand = grid.brand AND ex.attribute = grid.attribute WHERE grid.box = 'Fix first' ORDER BY grid.brand, grid.mentions DESC`,
        rationale: "Their weaknesses, in their own audience's words.",
      },
      {
        type: "table", w: 12, h: 6,
        title: "Objections by product, ours and rivals'",
        subtitle: `Product lines with 5+ objections in their brand comments, ours first: objections (a count), per 1,000 of the line's brand comments (a rate, shown with ${COMMENT_MIN}+ of them), the attribute objected to most, and the most-liked objection about that attribute in the commenter's words. ${PRODUCT_NOTE}.`,
        when: N_PRODUCTS,
        sql: `WITH o AS (SELECT brand, product, attribute, text, coalesce(likes, 0) AS likes FROM brand_comments WHERE product IS NOT NULL AND ${NEGATIVE}),
n AS (SELECT brand, product, count(*)::float AS n FROM brand_comments WHERE product IS NOT NULL GROUP BY 1, 2),
t AS (SELECT brand, product, count(*)::int AS objections FROM o GROUP BY 1, 2 HAVING count(*) >= 5),
a AS (SELECT DISTINCT ON (brand, product) brand, product, attribute FROM (SELECT brand, product, attribute, count(*) AS k FROM o WHERE attribute IS NOT NULL GROUP BY 1, 2, 3) x ORDER BY brand, product, k DESC, attribute),
q AS (SELECT DISTINCT ON (o.brand, o.product) o.brand, o.product, left(o.text, 160) AS said FROM o JOIN a ON a.brand = o.brand AND a.product = o.product AND a.attribute = o.attribute WHERE length(o.text) >= 20 ORDER BY o.brand, o.product, o.likes DESC, o.text)
SELECT t.brand, t.product, t.objections, n.n::int AS "brand comments", CASE WHEN n.n >= ${COMMENT_MIN} THEN ${r1("1000.0 * t.objections / n.n")} END AS "objections per 1K",
       ${ATTR("a.attribute")} AS "objected to most", q.said AS "in their words"
FROM t JOIN n USING (brand, product) LEFT JOIN a USING (brand, product) LEFT JOIN q USING (brand, product)
ORDER BY (t.brand = focal_brand()) DESC, t.objections DESC`,
        rationale: "The priority grid is per brand. This says which product the objection belongs to, for us and for each rival.",
      },
      {
        type: "table", w: 12, h: 7,
        title: "Priority grid by product, ours and rivals'",
        subtitle: `The same grid for each product line, ours first: each attribute placed by how often it comes up and how people feel about it. Mentions is a count, per 1K a rate of the line's brand comments, net sentiment is praise minus objections as a percent of mentions (attributes with 5+ mentions). A rival line's "fix first" box is our spec. ${PRODUCT_RATE_NOTE}.`,
        when: N_PRODUCT_COMMENTS,
        sql: `WITH ${PRODUCT_RATES},
g AS (SELECT brand, product, attribute, n AS mentions, 1000.0 * n / total AS per_k, (pos - neg) / n AS net FROM par WHERE n >= 5),
gb AS MATERIALIZED (SELECT brand, product, percentile_cont(0.5) WITHIN GROUP (ORDER BY mentions) AS med, sum(net * mentions) / NULLIF(sum(mentions), 0) AS avg_net FROM g GROUP BY 1, 2)
SELECT g.brand, g.product, ${ATTR("g.attribute")} AS attribute, g.mentions::int AS mentions, ${r1("g.per_k")} AS "per 1K", ${r0("100 * g.net")} AS "net sentiment",
       CASE WHEN g.mentions >= gb.med AND g.net < gb.avg_net THEN 'Fix first' WHEN g.mentions >= gb.med THEN 'Protect' WHEN g.net >= gb.avg_net THEN 'Start talking about' ELSE 'Watch' END AS box
FROM g JOIN gb USING (brand, product) ORDER BY (g.brand = focal_brand()) DESC, g.brand, g.product, g.mentions DESC`,
        rationale: "The brief asks for the grid per product and per competitor product.",
      },
      {
        type: "line", w: 12, h: 5,
        title: "What is breaking, by product",
        subtitle: "Objections per 1,000 brand comments on each of our product lines, by month (months with 50+ brand comments on the line). A line that climbs is a product problem. Ignores the period.",
        period: "all",
        when: N_PRODUCT_COMMENTS,
        sql: `WITH m AS (
  SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, product, count(*)::float AS n, count(*) FILTER (WHERE ${NEGATIVE})::float AS neg
  FROM brand_comments_all WHERE brand = focal_brand() AND product IS NOT NULL AND published_at IS NOT NULL GROUP BY 1, 2 HAVING count(*) >= 50
)
SELECT month, product, ${r1("1000.0 * neg / n")} AS value FROM m ORDER BY 1, 2`,
        x: "month", y: "value", series: "product", format: "decimal", unit: "Objections per 1,000 brand comments (a rate)",
        rationale: "The brief asks for objections by product over time, to catch a defect early.",
      },
      {
        type: "line", w: 7, h: 6,
        title: "What is breaking, and is it getting worse?",
        subtitle: "Objections per 1,000 brand comments on our content, by month and attribute (months with 50+ brand comments). Ignores the period.",
        period: "all",
        sql: `WITH m AS (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, count(*)::float AS n FROM brand_comments_all WHERE brand = focal_brand() AND published_at IS NOT NULL GROUP BY 1 HAVING count(*) >= 50),
o AS MATERIALIZED (SELECT to_char(date_trunc('month', published_at), 'YYYY-MM') AS month, attribute, count(*)::float AS n FROM brand_comments_all WHERE brand = focal_brand() AND attribute IS NOT NULL AND ${NEGATIVE} AND published_at IS NOT NULL GROUP BY 1, 2),
big AS (SELECT attribute FROM o GROUP BY 1 ORDER BY sum(n) DESC LIMIT 4)
SELECT m.month, ${ATTR("o.attribute")} AS attribute, ${r1("1000.0 * o.n / m.n")} AS value
FROM m JOIN o USING (month) JOIN big USING (attribute) ORDER BY 1`,
        x: "month", y: "value", series: "attribute", format: "decimal", unit: "Objections per 1,000 brand comments (a rate)",
        rationale: "A complaint that grows month after month is a product problem, not a comment.",
      },
      {
        type: "table", w: 5, h: 6,
        title: "How people judge price and value",
        subtitle: `Brand comments about price, per brand: how many (a count), and the share that are positive ("worth it") or objections (brands with 10+ price comments)`,
        sql: `SELECT brand, count(*)::int AS "price comments", ${r0(`100.0 * count(*) FILTER (WHERE ${POSITIVE}) / count(*)`)} AS "positive %", ${r0(`100.0 * count(*) FILTER (WHERE ${NEGATIVE}) / count(*)`)} AS "objections %",
       left((array_agg(text ORDER BY likes DESC NULLS LAST))[1], 120) AS "most-liked"
FROM brand_comments WHERE attribute = 'price' GROUP BY brand HAVING count(*) >= 10 ORDER BY (brand = focal_brand()) DESC, count(*) DESC`,
        sample: OUR_BC,
        rationale: "Whether price is a reason to buy or a reason not to, against rivals.",
      },
      {
        type: "table", w: 7, h: 6,
        title: "What people wish existed",
        subtitle: "Requests for a product change in our brand comments by kind (feature, variant, format), with the most-liked one verbatim. Requests to the creator (\"do a tutorial\") are left out.",
        when: N_REQUESTS,
        sql: `WITH q AS (SELECT feature_request_type AS kind, coalesce(feature_request, text) AS said, coalesce(likes, 0) AS likes FROM brand_comments WHERE brand = focal_brand() AND about = 'brand' AND feature_request_type IS NOT NULL),
top AS (SELECT DISTINCT ON (kind) kind, left(said, 160) AS example FROM q ORDER BY kind, likes DESC)
SELECT q.kind AS request, count(*)::int AS comments, sum(q.likes)::int AS likes, top.example AS "most-liked, verbatim" FROM q JOIN top USING (kind) GROUP BY q.kind, top.example ORDER BY 2 DESC`,
        sample: OUR_BC,
        rationale: "The roadmap the audience would write.",
      },
      {
        type: "table", w: 5, h: 6,
        title: "How people actually use it",
        subtitle: "Uses people describe in our brand comments, grouped by who they are. Counts of comments.",
        when: N_USE_CASES,
        sql: `SELECT use_case_segment AS "who", count(*)::int AS comments, coalesce(sum(likes), 0)::int AS likes, left(min(use_case), 140) AS "an example"
FROM brand_comments WHERE brand = focal_brand() AND use_case_segment IS NOT NULL GROUP BY 1 HAVING count(*) >= 2 ORDER BY 2 DESC LIMIT 12`,
        sample: OUR_BC,
        rationale: "Uses nobody designed for are the next variant or the next message.",
      },
    ],
  },
  {
    title: "How to read this, and its limits",
    widgets: [
      {
        type: "text", w: 12, h: 6,
        title: "Reading it every month, and what it cannot show yet",
        content: `**Every month.** The measures are calculated the same way each month. Set the period bar to a month and switch on Compare to see what moved. Counts change by a percent, shares by percentage points. The Reports page opens each month with the eight measures and what moved most, for all markets or one, and keeps a written review per month.

**What is checked.** Paid posts are found from the caption (#ad, Anzeige, Publi and the like) as well as the platform's flag. Shop and commission posts are counted on their own, as affiliate. Comments are read one by one to tell whether they are about the brand or about the creator. Posts not about the brand are left out. The list of brand-owned accounts is a draft for you to confirm.

**Limits we state up front.**
- **Culture lens:** not here yet. It needs a culture query beyond brand mentions.
- **Hooks and formats** are read from captions, not from video transcripts.
- **Audience** age and gender are known for some creators only, so audience match is shown and not scored.
- **Comments** exist for some industries only. Without them, sections 3 and 5 and the comment measures are left out.
- **Minimum samples:** 30 posts behind a theme and 200 brand comments behind a comment measure. Smaller cells are hidden, not shown as zero.
- **Purchase intent is a signal, not sales.** Proving the link needs your own sales data.

**Method.** The Method page in the left menu has every definition, the coverage per industry and the measured accuracy of each reading.`,
      },
    ],
  },
];
