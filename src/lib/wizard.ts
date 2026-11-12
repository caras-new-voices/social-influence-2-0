import { z } from "zod";
import { BRANDS, FOCAL_BRAND } from "./brands";
import { NOT_SELF, type TemplateWidget } from "./templates";
import type { ProposedWidget } from "./widgets";

/**
 * The guided onboarding: eight strategic questions, each with a few personalising choices (chips
 * that map to known columns), a "what the data says" query, and default element recipes whose SQL
 * is rewritten from the choices. Everything demo mode needs lives here; the LLM path uses the same
 * definitions as grounding.
 */

const B = FOCAL_BRAND.name;
const COMPETITORS = BRANDS.filter((b) => b.role === "competitor").map((b) => b.name);

/* ------------------------------------------------------------------ */
/* Goals and ordering                                                    */
/* ------------------------------------------------------------------ */

export const GOALS = [
  { id: "launch", label: "A launch or campaign", blurb: "What to make, where to put it, who to work with." },
  { id: "retention", label: "Keeping customers", blurb: "What fans love, what they ask, where they get stuck." },
  { id: "competitive", label: "Competitive pressure", blurb: "Who is winning the conversation and why." },
  { id: "risk", label: "Risk and reputation", blurb: "Push-back, sponsorship scepticism, unanswered questions." },
  { id: "unsure", label: "Not sure yet", blurb: "Tell the analyst what you are trying to find out." },
] as const;
export type GoalId = (typeof GOALS)[number]["id"];

export const STEP_IDS = ["driving", "intent", "love", "pushback", "unanswered", "build", "emerging", "partners"] as const;
export type StepId = (typeof STEP_IDS)[number];

/** Editorial ordering: the most relevant questions for a goal come first, the rest keep Eran's order. */
const GOAL_FIRST: Record<GoalId, StepId[]> = {
  launch: ["build", "emerging", "partners"],
  retention: ["love", "unanswered", "pushback"],
  competitive: ["driving", "partners", "intent"],
  risk: ["pushback", "unanswered", "driving"],
  unsure: [],
};
export function stepOrder(goal: GoalId | null | undefined): StepId[] {
  const first = goal ? GOAL_FIRST[goal] : [];
  return [...first, ...STEP_IDS.filter((s) => !first.includes(s))];
}

/* ------------------------------------------------------------------ */
/* Answers                                                               */
/* ------------------------------------------------------------------ */

export const StepAnswerSchema = z.object({
  choices: z.record(z.string(), z.array(z.string())).default({}),
  text: z.string().max(2000).optional(),
  /** Widget ids accepted on this step (the widgets themselves are kept client-side until finish). */
  added: z.array(z.string()).default([]),
  skipped: z.boolean().default(false),
});
export type StepAnswer = z.infer<typeof StepAnswerSchema>;

export const WizardAnswersSchema = z.object({
  competitors: z.array(z.string()).default(COMPETITORS),
  view: z.enum(["month", "all", "90d"]).default("month"),
  goal: z.enum(["launch", "retention", "competitive", "risk", "unsure"]).default("unsure"),
  goalText: z.string().max(2000).optional(),
  steps: z.record(z.string(), StepAnswerSchema).default({}),
});
export type WizardAnswers = z.infer<typeof WizardAnswersSchema>;

export const OnboardingStateSchema = z.object({
  version: z.literal(1).default(1),
  answers: WizardAnswersSchema,
  order: z.array(z.enum(STEP_IDS)),
  currentStep: z.number().int().min(0).default(0),
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

/* ------------------------------------------------------------------ */
/* Choices                                                               */
/* ------------------------------------------------------------------ */

export interface WizardChoice {
  key: string;
  label: string;
  multi: boolean;
  options: Array<{ value: string; label: string }>;
  default: string[];
}

const PLATFORMS: WizardChoice = { key: "platforms", label: "Channels to watch", multi: true, options: [{ value: "tiktok", label: "TikTok" }, { value: "instagram", label: "Instagram" }, { value: "youtube", label: "YouTube" }], default: ["tiktok", "instagram", "youtube"] };
const TIERS: WizardChoice = { key: "tiers", label: "Creator sizes that matter", multi: true, options: [{ value: "nano", label: "Nano" }, { value: "micro", label: "Micro" }, { value: "mid", label: "Mid" }, { value: "macro", label: "Macro" }, { value: "mega", label: "Mega" }], default: ["nano", "micro", "mid", "macro", "mega"] };
const PAID: WizardChoice = { key: "paid", label: "Paid, organic or both", multi: false, options: [{ value: "both", label: "Both" }, { value: "organic", label: "Organic only" }, { value: "paid", label: "Paid only" }], default: ["both"] };
const STAGES: WizardChoice = { key: "stages", label: "Intent to count", multi: true, options: [{ value: "explicit", label: "Explicit (buying now)" }, { value: "aspirational", label: "Aspirational" }, { value: "conditional", label: "Conditional" }], default: ["explicit", "aspirational", "conditional"] };
const YESNO = (key: string, label: string, dflt = "yes"): WizardChoice => ({ key, label, multi: false, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }], default: [dflt] });
const FOCUS3: WizardChoice = { key: "focus", label: "What to show", multi: true, options: [{ value: "topics", label: "Topics they praise" }, { value: "formats", label: "Formats that land" }, { value: "loyalty", label: "Loyalty and fans" }], default: ["topics", "formats", "loyalty"] };
const OBJECTIONS: WizardChoice = { key: "objections", label: "Objections to track", multi: true, options: [{ value: "quality", label: "Quality" }, { value: "price", label: "Price" }, { value: "shipping_availability", label: "Availability" }, { value: "trust_credibility", label: "Trust" }, { value: "comparison_based", label: "Comparisons" }, { value: "ethics", label: "Ethics" }, { value: "ingredients_composition", label: "Ingredients" }, { value: "fit_sizing", label: "Fit" }], default: ["quality", "price", "shipping_availability", "trust_credibility", "comparison_based", "ethics", "ingredients_composition", "fit_sizing"] };
const REPLIES: WizardChoice = { key: "replies", label: "Which questions", multi: false, options: [{ value: "unanswered", label: "Only those with no reply" }, { value: "all", label: "All questions" }], default: ["unanswered"] };
const MIN_LIKES: WizardChoice = { key: "minLikes", label: "Minimum likes on the comment", multi: false, options: [{ value: "0", label: "Any" }, { value: "5", label: "5+" }, { value: "20", label: "20+" }], default: ["0"] };
const REQUEST_TYPES: WizardChoice = { key: "requestTypes", label: "Request types", multi: true, options: [{ value: "variant", label: "Variants" }, { value: "feature", label: "Features" }, { value: "format", label: "Formats" }, { value: "size", label: "Sizes" }, { value: "color", label: "Colours" }, { value: "modification", label: "Modifications" }, { value: "other", label: "Other" }], default: ["variant", "feature", "format", "size", "color", "modification", "other"] };
const SCOPE: WizardChoice = { key: "scope", label: "Look at", multi: false, options: [{ value: "category", label: "The whole category" }, { value: "own", label: "Our audience only" }], default: ["category"] };
const PARTNER_TYPES: WizardChoice = { key: "partnerTypes", label: "Partner types", multi: true, options: [{ value: "creators", label: "Creators" }, { value: "brands", label: "Adjacent brands" }, { value: "competitors", label: "Competitors in our conversation" }], default: ["creators", "brands", "competitors"] };
const MIN_FOLLOWERS: WizardChoice = { key: "minFollowers", label: "Minimum followers", multi: false, options: [{ value: "0", label: "Any" }, { value: "10000", label: "10K+" }, { value: "100000", label: "100K+" }], default: ["0"] };

/* ------------------------------------------------------------------ */
/* SQL helpers                                                           */
/* ------------------------------------------------------------------ */

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const list = (vs: string[]) => vs.map(q).join(", ");
function get(step: StepAnswer | undefined, choice: WizardChoice): string[] {
  const v = step?.choices?.[choice.key];
  return v && v.length ? v : choice.default;
}
const RECENT = (col = "published_at", table = "posts") => `${col} >= coalesce(period_start(), (SELECT max(published_at) FROM ${table} WHERE brand = ${q(B)}) - interval '90 days')`;
const RECENT_LABEL = "In the selected period (last 90 days when viewing all time)";

/* ------------------------------------------------------------------ */
/* Steps                                                                 */
/* ------------------------------------------------------------------ */

export interface WizardStep {
  id: StepId;
  /** The question as the client would say it. */
  question: string;
  short: string;
  choices: WizardChoice[];
  /** One query whose rows feed "what the data says". */
  dataSql: (a: WizardAnswers) => string;
  /** Scripted sentences from the rows (demo mode, and grounding for the LLM). */
  dataText: (rows: Record<string, unknown>[], a: WizardAnswers) => string;
  /** Personalised element recipes. */
  elements: (a: WizardAnswers) => TemplateWidget[];
}

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const fmt = (v: unknown) => Math.round(n(v)).toLocaleString("en-US");
const pct = (v: unknown) => `${Math.round(n(v))}%`;

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: "driving",
    question: "What is driving the conversation about us right now?",
    short: "What drives the conversation",
    choices: [PLATFORMS, TIERS, PAID],
    dataSql: (a) => {
      const s = a.steps.driving;
      const pf = `p.platform IN (${list(get(s, PLATFORMS))}) AND p.tier IN (${list(get(s, TIERS))})${paidClause(get(s, PAID)[0], "p")}`;
      return `WITH p AS (SELECT * FROM posts p WHERE p.brand = ${q(B)} AND ${pf} AND ${RECENT("p.published_at")})
SELECT (SELECT count(*)::int FROM p) AS posts, (SELECT count(DISTINCT influencer_id)::int FROM p) AS creators,
  (SELECT platform FROM p GROUP BY 1 ORDER BY sum(engagement) DESC NULLS LAST LIMIT 1) AS top_platform,
  (SELECT round(100.0 * max(s) / NULLIF(sum(s), 0)) FROM (SELECT sum(engagement) AS s FROM p GROUP BY platform) x) AS top_platform_share,
  (SELECT round(100.0 * sum(s) FILTER (WHERE rn <= 3) / NULLIF(sum(s), 0)) FROM (SELECT sum(engagement) AS s, row_number() OVER (ORDER BY sum(engagement) DESC NULLS LAST) AS rn FROM p GROUP BY username) y) AS top3_share,
  (SELECT username FROM p GROUP BY 1 ORDER BY sum(engagement) DESC NULLS LAST LIMIT 1) AS top_creator`;
    },
    dataText: (rows) => {
      const r = rows[0] ?? {};
      if (!n(r.posts)) return `There are no ${B} posts matching these choices in this period. Widen the channels or creator sizes.`;
      return `${fmt(r.posts)} creator posts about ${B} from ${fmt(r.creators)} creators match these choices. ${String(r.top_platform ?? "One channel")} carries ${pct(r.top_platform_share)} of the engagement, and the top three creators (led by ${String(r.top_creator ?? "one creator")}) account for ${pct(r.top3_share)} of it.`;
    },
    elements: (a) => {
      const s = a.steps.driving;
      const platforms = get(s, PLATFORMS), tiers = get(s, TIERS), paid = get(s, PAID)[0];
      const pf = (al: string) => `${al}.platform IN (${list(platforms)}) AND ${al}.tier IN (${list(tiers)})${paidClause(paid, al)}`;
      return [
        {
          type: "kpi", w: 12, h: 3, title: `${B} conversation in this period`, subtitle: "Versus the previous period of the same length",
          sql: `WITH b AS (
  SELECT coalesce(period_start(), (SELECT max(published_at) FROM posts_all WHERE brand = ${q(B)}) - interval '90 days') AS s,
         coalesce(period_end(), (SELECT max(published_at) FROM posts_all WHERE brand = ${q(B)}) + interval '1 second') AS e
), cur AS (SELECT count(*)::float AS posts, count(DISTINCT influencer_id)::float AS creators, sum(engagement) AS engagement, sum(views) AS views FROM posts_all p, b WHERE p.brand = ${q(B)} AND ${pf("p")} AND p.published_at >= b.s AND p.published_at < b.e),
   prev AS (SELECT count(*)::float AS posts, count(DISTINCT influencer_id)::float AS creators, sum(engagement) AS engagement, sum(views) AS views FROM posts_all p, b WHERE p.brand = ${q(B)} AND ${pf("p")} AND p.published_at >= b.s - (b.e - b.s) AND p.published_at < b.s)
SELECT 'Posts' AS label, cur.posts AS value, prev.posts AS compare, 'compact' AS fmt FROM cur, prev
UNION ALL SELECT 'Creators', cur.creators, prev.creators, 'compact' FROM cur, prev
UNION ALL SELECT 'Engagement', cur.engagement, prev.engagement, 'compact' FROM cur, prev
UNION ALL SELECT 'Views', cur.views, prev.views, 'compact' FROM cur, prev`,
          rationale: "Is the conversation growing or fading, on the channels and creator sizes you chose.",
        },
        {
          type: "table", w: 7, h: 6, title: "Creators driving the conversation", subtitle: `${RECENT_LABEL}, ranked by engagement`,
          sql: `SELECT p.username AS creator, p.platform, p.tier, count(*)::int AS posts, sum(p.engagement) AS engagement, sum(p.views) AS views, bool_or(p.is_paid) AS paid
FROM posts p WHERE p.brand = ${q(B)} AND ${pf("p")} AND ${RECENT("p.published_at")} GROUP BY 1, 2, 3 ORDER BY engagement DESC NULLS LAST LIMIT 15`,
          rationale: "Who is moving people right now, and whether you paid them.",
        },
        {
          type: "bar", w: 5, h: 6, title: "Channels driving the conversation", subtitle: `Engagement by platform. ${RECENT_LABEL}`,
          sql: `SELECT p.platform, sum(p.engagement) AS value FROM posts p WHERE p.brand = ${q(B)} AND ${pf("p")} AND ${RECENT("p.published_at")} GROUP BY 1 ORDER BY 2 DESC`,
          x: "platform", y: "value", colorBy: "platform", format: "compact", horizontal: true, rationale: "Where the conversation is happening.",
        },
      ];
    },
  },
  {
    id: "intent",
    question: "Where does the conversation show real intent to buy, and from whom?",
    short: "Intent to buy",
    choices: [STAGES, YESNO("blockers", "Show what blocks them")],
    dataSql: (a) => {
      const s = a.steps.intent;
      return `SELECT count(*)::int AS intent, count(*) FILTER (WHERE c.purchase_intent_type = 'explicit')::int AS explicit,
  (SELECT p.platform FROM comments c2 JOIN posts p ON p.post_id = c2.post_id AND p.segment_id = c2.segment_id WHERE c2.brand = ${q(B)} AND c2.purchase_intent_type IN (${list(get(s, STAGES))}) GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS top_platform,
  (SELECT count(*)::int FROM comments c3 WHERE c3.brand = ${q(B)} AND c3.purchase_blocker IS NOT NULL) AS blockers
FROM comments c WHERE c.brand = ${q(B)} AND c.purchase_intent_type IN (${list(get(s, STAGES))})`;
    },
    dataText: (rows) => {
      const r = rows[0] ?? {};
      if (!n(r.intent)) return `No ${B} comments show the selected intent stages in this period.`;
      return `${fmt(r.intent)} comments on ${B} content show buying intent (${fmt(r.explicit)} explicit), most of them on ${String(r.top_platform ?? "one platform")}. ${fmt(r.blockers)} comments name something that stops the purchase.`;
    },
    elements: (a) => {
      const s = a.steps.intent;
      const stages = list(get(s, STAGES));
      const out: TemplateWidget[] = [
        {
          type: "stacked_bar", w: 5, h: 6, title: "Purchase intent by platform", subtitle: `${B} comments flagged with buying intent, by stage`,
          sql: `SELECT p.platform, c.purchase_intent_type AS stage, count(*)::int AS value FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id
WHERE c.brand = ${q(B)} AND c.purchase_intent_type IN (${stages}) GROUP BY 1, 2 ORDER BY 1`,
          x: "platform", y: "value", series: "stage", colorBy: "auto", format: "compact", rationale: "Which channel produces buyers.",
        },
        {
          type: "table", w: 7, h: 6, title: "Whose audiences want to buy", subtitle: "Creators whose posts attract the most buying-intent comments",
          sql: `SELECT p.username AS creator, p.platform, p.tier, count(*)::int AS intent_comments, round((count(*)::numeric / NULLIF(count(DISTINCT p.post_id), 0)), 1) AS per_post
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id WHERE c.brand = ${q(B)} AND c.purchase_intent_type IN (${stages})
GROUP BY 1, 2, 3 ORDER BY intent_comments DESC LIMIT 15`,
          rationale: "The creators whose followers are closest to purchase.",
        },
      ];
      if (get(s, YESNO("blockers", ""))[0] !== "no") out.push({
        type: "table", w: 12, h: 5, title: "Intent in their own words", subtitle: "Most-liked buying-intent comments, with the blocker when one is mentioned",
        sql: `SELECT c.purchase_intent_type AS stage, left(c.text, 140) AS comment, c.purchase_blocker AS blocker, c.likes, p.username AS on_post_by, p.platform
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id WHERE c.brand = ${q(B)} AND c.purchase_intent_type IN (${stages}) ORDER BY c.likes DESC NULLS LAST LIMIT 15`,
        rationale: "Verbatim intent, and what stands between intent and purchase.",
      });
      return out;
    },
  },
  {
    id: "love",
    question: "What does the audience love that we should keep doing?",
    short: "What they love",
    choices: [FOCUS3, PLATFORMS],
    dataSql: (a) => {
      const s = a.steps.love;
      return `SELECT round(100.0 * count(*) FILTER (WHERE c.sentiment = 'positive') / NULLIF(count(*) FILTER (WHERE c.sentiment IS NOT NULL), 0)) AS positive_share,
  (SELECT topic FROM comments c2, unnest(c2.topics) AS topic WHERE c2.brand = ${q(B)} AND c2.sentiment = 'positive' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS top_topic,
  (SELECT count(*)::int FROM comments c3 WHERE c3.brand = ${q(B)} AND c3.loyalty_type IS NOT NULL) AS loyal
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id WHERE c.brand = ${q(B)} AND p.platform IN (${list(get(s, PLATFORMS))})`;
    },
    dataText: (rows) => {
      const r = rows[0] ?? {};
      return `${pct(r.positive_share)} of analysed ${B} comments are positive on the channels you chose; the most common theme is "${String(r.top_topic ?? "praise")}". ${fmt(r.loyal)} comments carry a loyalty signal (advocacy, long-term use, repeat buying).`;
    },
    elements: (a) => {
      const s = a.steps.love;
      const focus = get(s, FOCUS3), platforms = list(get(s, PLATFORMS));
      const out: TemplateWidget[] = [];
      if (focus.includes("topics")) out.push({
        type: "bar", w: 5, h: 6, title: "What positive comments are about", subtitle: `Top topics in positive ${B} comments`,
        sql: `SELECT topic, count(*)::int AS value FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id, unnest(c.topics) AS topic
WHERE c.brand = ${q(B)} AND c.sentiment = 'positive' AND p.platform IN (${platforms}) GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        x: "topic", y: "value", format: "compact", horizontal: true, rationale: "The themes the audience responds to best.",
      });
      if (focus.includes("formats")) out.push({
        type: "bar", w: 7, h: 6, title: "Content that earns the warmest reaction", subtitle: "Share of positive comments by platform and format (posts with 20+ comments)",
        sql: `SELECT p.platform || ' · ' || p.post_type AS content, round(100.0 * count(*) FILTER (WHERE c.sentiment = 'positive') / NULLIF(count(*), 0), 1) AS value
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id WHERE c.brand = ${q(B)} AND c.sentiment IS NOT NULL AND p.platform IN (${platforms})
GROUP BY 1 HAVING count(*) >= 20 ORDER BY 2 DESC`,
        x: "content", y: "value", colorBy: "auto", format: "number", horizontal: true, rationale: "Which formats make people happy, not just loud.",
      });
      if (focus.includes("loyalty")) out.push({
        type: "table", w: 12, h: 5, title: "What fans say we get right", subtitle: "Most-liked loyalty and praise comments",
        sql: `SELECT coalesce(c.loyalty_type, 'praise') AS signal, left(coalesce(c.loyalty_phrase, c.text), 140) AS comment, c.likes, p.username AS on_post_by, p.platform
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id
WHERE c.brand = ${q(B)} AND p.platform IN (${platforms}) AND (c.loyalty_type IS NOT NULL OR ('praise' = ANY(c.topics) AND c.sentiment = 'positive')) ORDER BY c.likes DESC NULLS LAST LIMIT 12`,
        rationale: "Verbatims to reuse in messaging and briefs.",
      });
      return out;
    },
  },
  {
    id: "pushback",
    question: "What is the audience ignoring or pushing back on?",
    short: "Push-back",
    choices: [OBJECTIONS, YESNO("sponsorship", "Include how sponsorships land")],
    dataSql: (a) => {
      const s = a.steps.pushback;
      return `SELECT count(*)::int AS objections, (SELECT objection_category FROM comments c2 WHERE c2.brand = ${q(B)} AND c2.objection_category IN (${list(get(s, OBJECTIONS))}) GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS top,
  (SELECT count(*)::int FROM comments c3 WHERE c3.brand = ${q(B)} AND c3.partnership_perception IN ('ad_callout', 'skepticism_inconsistent_recs', 'ad_fatigue_platform', 'skeptical', 'cynical')) AS ad_pushback
FROM comments c WHERE c.brand = ${q(B)} AND c.objection_category IN (${list(get(s, OBJECTIONS))})`;
    },
    dataText: (rows) => {
      const r = rows[0] ?? {};
      return `${fmt(r.objections)} ${B} comments raise an objection in the categories you chose; "${String(r.top ?? "quality").replace(/_/g, " ")}" is the most common. ${fmt(r.ad_pushback)} comments push back on sponsorships themselves (ad call-outs, scepticism).`;
    },
    elements: (a) => {
      const s = a.steps.pushback;
      const cats = list(get(s, OBJECTIONS));
      const out: TemplateWidget[] = [
        {
          type: "bar", w: 6, h: 6, title: "What they push back on", subtitle: `Objections in ${B} comments, by category`,
          sql: `SELECT objection_category AS objection, count(*)::int AS value FROM comments WHERE brand = ${q(B)} AND objection_category IN (${cats}) GROUP BY 1 ORDER BY 2 DESC`,
          x: "objection", y: "value", format: "compact", horizontal: true, rationale: "Where the criticism concentrates.",
        },
        {
          type: "table", w: 6, h: 6, title: "Push-back in their own words", subtitle: "Most-liked objection comments",
          sql: `SELECT objection_category AS objection, left(coalesce(objection_phrase, text), 120) AS comment, likes FROM comments WHERE brand = ${q(B)} AND objection_category IN (${cats}) ORDER BY likes DESC NULLS LAST LIMIT 12`,
          rationale: "The exact wording of the criticism.",
        },
      ];
      if (get(s, YESNO("sponsorship", ""))[0] !== "no") out.push({
        type: "bar", w: 6, h: 5, title: "How sponsorships land", subtitle: `Partnership perception in ${B} comments`,
        sql: `SELECT partnership_perception AS perception, count(*)::int AS value FROM comments WHERE brand = ${q(B)} AND partnership_perception IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
        x: "perception", y: "value", format: "compact", horizontal: true, rationale: "Ad call-outs and scepticism are the audience pushing back on the format itself.",
      });
      out.push({
        type: "table", w: 6, h: 5, title: "What they ignore", subtitle: "Formats with the lowest engagement per view (posts with 5,000+ views)",
        sql: `SELECT platform, post_type AS format, CASE WHEN is_paid THEN 'paid' ELSE 'organic' END AS kind, count(*)::int AS posts,
  round((1000.0 * sum(engagement) / NULLIF(sum(views), 0))::numeric, 1) AS engagement_per_1k_views
FROM posts WHERE brand = ${q(B)} AND views >= 5000 GROUP BY 1, 2, 3 HAVING count(*) >= 5 ORDER BY engagement_per_1k_views ASC`,
        rationale: "Content people scroll past: seen a lot, reacted to little.",
      });
      return out;
    },
  },
  {
    id: "unanswered",
    question: "What are people asking that nobody is answering yet?",
    short: "Unanswered questions",
    choices: [REPLIES, MIN_LIKES],
    dataSql: (a) => {
      const s = a.steps.unanswered;
      return `SELECT count(*)::int AS questions, (SELECT faq_topic FROM comments c2 WHERE c2.brand = ${q(B)} AND c2.faq_topic IS NOT NULL ${repliesClause(get(s, REPLIES)[0], "c2")} GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS top
FROM comments c WHERE c.brand = ${q(B)} AND c.faq_topic IS NOT NULL ${repliesClause(get(s, REPLIES)[0], "c")} AND coalesce(c.likes, 0) >= ${Number(get(s, MIN_LIKES)[0]) || 0}`;
    },
    dataText: (rows, a) => {
      const r = rows[0] ?? {};
      const only = get(a.steps.unanswered, REPLIES)[0] === "unanswered" ? " with no reply" : "";
      return `${fmt(r.questions)} ${B} comments are questions${only}; the most frequent topic is "${String(r.top ?? "price").replace(/_/g, " ")}". Each of these is a caption, pinned comment or FAQ entry waiting to be written.`;
    },
    elements: (a) => {
      const s = a.steps.unanswered;
      const rc = repliesClause(get(s, REPLIES)[0], "c"), min = Number(get(s, MIN_LIKES)[0]) || 0;
      return [
        {
          type: "bar", w: 5, h: 6, title: "Unanswered question topics", subtitle: `Questions in ${B} comments${get(s, REPLIES)[0] === "unanswered" ? " that received no reply" : ""}`,
          sql: `SELECT c.faq_topic AS topic, count(*)::int AS value FROM comments c WHERE c.brand = ${q(B)} AND c.faq_topic IS NOT NULL ${rc} AND coalesce(c.likes, 0) >= ${min} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
          x: "topic", y: "value", format: "compact", horizontal: true, rationale: "Questions the brand could answer in captions, pinned comments or on the product page.",
        },
        {
          type: "table", w: 7, h: 6, title: "The questions, verbatim", subtitle: "Most-liked questions and where they were asked",
          sql: `SELECT c.faq_topic AS topic, left(coalesce(c.faq_phrase, c.text), 140) AS question, c.likes, p.username AS asked_under, p.platform
FROM comments c JOIN posts p ON p.post_id = c.post_id AND p.segment_id = c.segment_id WHERE c.brand = ${q(B)} AND c.faq_topic IS NOT NULL ${rc} AND coalesce(c.likes, 0) >= ${min} ORDER BY c.likes DESC NULLS LAST LIMIT 15`,
          rationale: "Each of these is a piece of content waiting to be written.",
        },
      ];
    },
  },
  {
    id: "build",
    question: "What product or service is the conversation asking us to build?",
    short: "What to build",
    choices: [REQUEST_TYPES, YESNO("blockers", "Include blockers we could remove")],
    dataSql: (a) => {
      const s = a.steps.build;
      return `SELECT count(*)::int AS requests, (SELECT feature_request_type FROM comments c2 WHERE c2.brand = ${q(B)} AND c2.feature_request_type IN (${list(get(s, REQUEST_TYPES))}) GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS top,
  (SELECT left(feature_request, 90) FROM comments c3 WHERE c3.brand = ${q(B)} AND c3.feature_request IS NOT NULL AND c3.feature_request_type IN (${list(get(s, REQUEST_TYPES))}) ORDER BY likes DESC NULLS LAST LIMIT 1) AS example
FROM comments c WHERE c.brand = ${q(B)} AND c.feature_request_type IN (${list(get(s, REQUEST_TYPES))})`;
    },
    dataText: (rows) => {
      const r = rows[0] ?? {};
      return `${fmt(r.requests)} ${B} comments ask for something specific; most are ${String(r.top ?? "feature")} requests. The most-liked one: "${String(r.example ?? "")}".`;
    },
    elements: (a) => {
      const s = a.steps.build;
      const types = list(get(s, REQUEST_TYPES));
      const out: TemplateWidget[] = [
        {
          type: "bar", w: 5, h: 6, title: "Feature requests by type", subtitle: `What ${B} commenters ask the product to do`,
          sql: `SELECT feature_request_type AS request, count(*)::int AS value FROM comments WHERE brand = ${q(B)} AND feature_request_type IN (${types}) GROUP BY 1 ORDER BY 2 DESC`,
          x: "request", y: "value", format: "compact", horizontal: true, rationale: "Variants, formats and sizes the audience is asking for.",
        },
        {
          type: "table", w: 7, h: 6, title: "Requests, verbatim", subtitle: "Most-liked feature requests",
          sql: `SELECT feature_request_type AS type, left(coalesce(feature_request, text), 140) AS request, likes FROM comments WHERE brand = ${q(B)} AND feature_request_type IN (${types}) ORDER BY likes DESC NULLS LAST LIMIT 15`,
          rationale: "The product brief, written by customers.",
        },
      ];
      if (get(s, YESNO("blockers", ""))[0] !== "no") out.push({
        type: "table", w: 12, h: 5, title: "Blockers we could remove", subtitle: "What stops people who already want to buy",
        sql: `SELECT purchase_blocker AS blocker, count(*)::int AS comments, sum(likes) AS likes_on_them, left(min(text), 120) AS example FROM comments WHERE brand = ${q(B)} AND purchase_blocker IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        rationale: "Service and availability gaps that cost sales today.",
      });
      return out;
    },
  },
  {
    id: "emerging",
    question: "What new need is emerging in the conversation that no brand owns yet?",
    short: "Emerging needs",
    choices: [SCOPE],
    dataSql: (a) => `SELECT count(*)::int AS needs, (SELECT use_case_segment FROM comments c2 WHERE ${scopeClause(a, "c2")} AND c2.use_case_segment IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS top,
  (SELECT count(DISTINCT brand)::int FROM comments c3 WHERE ${scopeClause(a, "c3")} AND c3.use_case_segment IS NOT NULL) AS brands
FROM comments c WHERE ${scopeClause(a, "c")} AND c.use_case_segment IS NOT NULL`,
    dataText: (rows, a) => {
      const r = rows[0] ?? {};
      const scope = get(a.steps.emerging, SCOPE)[0] === "own" ? `your own audience` : `the category (${B} and ${a.competitors.length} competitors)`;
      return `${fmt(r.needs)} comments across ${scope} describe a non-standard need; the most common is "${String(r.top ?? "travelers")}", mentioned under ${fmt(r.brands)} ${n(r.brands) === 1 ? "brand" : "brands"}. A need spread across several brands belongs to nobody yet.`;
    },
    elements: (a) => [
      {
        type: "table", w: 7, h: 6, title: "Emerging needs", subtitle: "Non-standard use cases people describe, and how many brands they appear under",
        sql: `SELECT use_case_segment AS need, count(*)::int AS comments, count(DISTINCT brand)::int AS brands_mentioned, string_agg(DISTINCT brand, ', ') AS brands, left(min(use_case), 110) AS example
FROM comments c WHERE ${scopeClause(a, "c")} AND c.use_case_segment IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
        rationale: "Needs spread across several brands belong to nobody yet.",
      },
      {
        type: "bar", w: 5, h: 6, title: "Requests no brand answers", subtitle: "Feature requests by type",
        sql: `SELECT feature_request_type AS request, count(*)::int AS value FROM comments c WHERE ${scopeClause(a, "c")} AND c.feature_request_type IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
        x: "request", y: "value", format: "compact", horizontal: true, rationale: "Gaps in the whole category, not just ours.",
      },
    ],
  },
  {
    id: "partners",
    question: "Which creators, brands and partners are already part of our conversation, and who should we partner with?",
    short: "Who to partner with",
    choices: [PARTNER_TYPES, MIN_FOLLOWERS],
    dataSql: (a) => {
      const s = a.steps.partners;
      const minF = Number(get(s, MIN_FOLLOWERS)[0]) || 0;
      return `SELECT (SELECT count(DISTINCT influencer_id)::int FROM posts p WHERE p.brand = ${q(B)} AND p.followers >= ${minF} AND p.influencer_id NOT IN (SELECT influencer_id FROM posts WHERE brand = ${q(B)} AND is_paid)) AS organic_creators,
  (SELECT brand_affinity_name FROM comments c WHERE c.brand = ${q(B)} AND c.brand_affinity_name IS NOT NULL AND ${NOT_SELF("c.brand_affinity_name")} GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS top_affinity,
  (SELECT count(*)::int FROM comments c WHERE c.brand = ${q(B)} AND c.competitor_name IS NOT NULL AND ${NOT_SELF("c.competitor_name")}) AS competitor_mentions`;
    },
    dataText: (rows) => {
      const r = rows[0] ?? {};
      return `${fmt(r.organic_creators)} creators talk about ${B} without being paid. The brand your audience names most warmly is ${String(r.top_affinity ?? "Dove")}, and ${fmt(r.competitor_mentions)} comments bring a competitor into your conversation.`;
    },
    elements: (a) => {
      const s = a.steps.partners;
      const types = get(s, PARTNER_TYPES), minF = Number(get(s, MIN_FOLLOWERS)[0]) || 0;
      const out: TemplateWidget[] = [];
      if (types.includes("creators")) out.push({
        type: "table", w: 7, h: 6, title: "Creators to partner with", subtitle: `Organic ${B} creators (never paid) with the strongest engagement${minF ? `, ${minF.toLocaleString("en-US")}+ followers` : ""}`,
        sql: `SELECT p.username AS creator, p.platform, p.tier, max(p.followers) AS followers, count(*)::int AS organic_posts, sum(p.engagement) AS engagement,
  round((avg(p.engagement) / NULLIF(max(p.followers), 0) * 100)::numeric, 2) AS eng_rate_per_post_pct, max(p.country) AS country
FROM posts p WHERE p.brand = ${q(B)} AND p.followers >= ${minF} AND p.influencer_id NOT IN (SELECT influencer_id FROM posts WHERE brand = ${q(B)} AND is_paid)
GROUP BY 1, 2, 3 HAVING count(*) >= 2 ORDER BY engagement DESC NULLS LAST LIMIT 15`,
        rationale: "People already talking about us for free, with an audience that responds.",
      });
      if (types.includes("brands")) out.push({
        type: "table", w: 5, h: 6, title: "Brands our audience already loves", subtitle: `Other brands named with affinity in ${B} comments`,
        sql: `SELECT brand_affinity_name AS brand, brand_affinity_category AS category, count(*)::int AS mentions FROM comments
WHERE brand = ${q(B)} AND brand_affinity_name IS NOT NULL AND ${NOT_SELF("brand_affinity_name")} AND brand_affinity_name NOT ILIKE ALL (ARRAY['%unspecified%', '%unnamed%', '%unknown%', 'this brand', 'none', 'n/a'])
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`,
        rationale: "Co-marketing and bundle candidates the audience has pre-approved.",
      });
      if (types.includes("competitors")) out.push({
        type: "table", w: 6, h: 5, title: "Competitors already in our conversation", subtitle: `Brands commenters compare us with under ${B} content`,
        sql: `SELECT competitor_name AS brand, count(*)::int AS mentions, count(*) FILTER (WHERE competitor_favored = 'competitor')::int AS prefers_them, count(*) FILTER (WHERE competitor_favored = 'focal_brand')::int AS prefers_us
FROM comments WHERE brand = ${q(B)} AND competitor_name IS NOT NULL AND competitor_mention_type IN ('preference', 'comparison') AND ${NOT_SELF("competitor_name")} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        rationale: "Who we are measured against, and whether we win the comparison.",
      });
      return out;
    },
  },
];

function paidClause(v: string, al: string): string {
  return v === "organic" ? ` AND NOT coalesce(${al}.is_paid, false)` : v === "paid" ? ` AND ${al}.is_paid` : "";
}
function repliesClause(v: string, al: string): string {
  return v === "all" ? "" : ` AND coalesce(${al}.reply_count, 0) = 0`;
}
function scopeClause(a: WizardAnswers, al: string): string {
  const own = get(a.steps.emerging, SCOPE)[0] === "own";
  return own ? `${al}.brand = ${q(B)}` : `${al}.brand IN (${list([B, ...a.competitors])})`;
}

export const STEPS_BY_ID: Record<StepId, WizardStep> = Object.fromEntries(WIZARD_STEPS.map((s) => [s.id, s])) as Record<StepId, WizardStep>;

/** Element recipes for a step as propose_widget inputs. */
export function stepProposals(stepId: StepId, answers: WizardAnswers): ProposedWidget[] {
  const step = STEPS_BY_ID[stepId];
  return step.elements(answers).map(({ w, h, ...spec }) => ({ ...spec, width: w, height: h }));
}

/** Human summary of the choices made so far, for the analyst's context and the summary screen. */
export function describeAnswers(a: WizardAnswers, upTo?: StepId): string {
  const parts: string[] = [];
  parts.push(`Goal: ${GOALS.find((g) => g.id === a.goal)?.label ?? a.goal}${a.goalText ? ` ("${a.goalText}")` : ""}. Competitors tracked: ${a.competitors.join(", ") || "none"}. Default view: ${a.view === "month" ? "latest complete month versus the previous" : a.view === "90d" ? "last 90 days versus the 90 before" : "all time"}.`);
  for (const s of WIZARD_STEPS) {
    if (upTo && s.id === upTo) break;
    const st = a.steps[s.id];
    if (!st) continue;
    const chosen = s.choices.map((c) => `${c.label}: ${get(st, c).map((v) => c.options.find((o) => o.value === v)?.label ?? v).join(", ")}`).join("; ");
    parts.push(`${s.short}: ${st.skipped ? "skipped" : chosen}${st.text ? ` (said: "${st.text}")` : ""}.`);
  }
  return parts.join("\n");
}

/** The instruction for one wizard step, sent to the analyst instead of a free question. */
export function stepInstruction(stepId: StepId, answers: WizardAnswers, dataSummary: string, proposals: ProposedWidget[]): string {
  const step = STEPS_BY_ID[stepId];
  const st = answers.steps[stepId];
  const chosen = step.choices.map((c) => `${c.label}: ${get(st, c).join(", ")}`).join("; ");
  return [
    `GUIDED SETUP, question "${step.question}"`,
    `The person is building their dashboard by answering eight questions. Their choices so far:\n${describeAnswers(answers, stepId)}`,
    `For this question they chose: ${chosen}.${st?.text ? ` They added: "${st.text}".` : ""}`,
    `Grounding, from a query already run for this question: ${dataSummary}`,
    `Reply with exactly: two or three plain sentences on what the data says for this question with the key numbers (you may run one or two more queries if needed), then call propose_widget once for each of the following elements, keeping their SQL, titles and recipes unless the person's added text asks for a change (then adapt the SQL minimally and say what you changed). Do not add other elements. No follow-up questions line.`,
    `Elements to propose:\n${proposals.map((p, i) => `${i + 1}. ${JSON.stringify(p)}`).join("\n")}`,
  ].join("\n\n");
}

/** The instruction when the person types a free message on a step. */
export function stepDiscussInstruction(stepId: StepId, answers: WizardAnswers, text: string, proposedIds: Array<{ id: string; title: string }>): string {
  const step = STEPS_BY_ID[stepId];
  return [
    `GUIDED SETUP, question "${step.question}". The person is on this question of the eight-question setup; their choices so far:\n${describeAnswers(answers)}`,
    proposedIds.length ? `Elements currently proposed for this question: ${proposedIds.map((p) => `${p.id} "${p.title}"`).join("; ")}.` : "",
    `They say: "${text}"`,
    `Answer briefly and concretely with numbers from the data. If they ask to change one of the proposed elements, call propose_widget with the full new spec and replaces_widget_id set to that element's id. If they ask for something new that answers this question, propose it (at most two elements). Keep the reply under 120 words. No follow-up questions line.`,
  ].filter(Boolean).join("\n\n");
}

export const WIZARD_INTRO = `I have the creator posts and audience comments about ${B} and its competitors. Let's set up a dashboard around eight questions. For each one I'll show what the data says, you tell me what matters to you, and I'll propose the elements. It takes about five minutes, and you can stop early and let me fill in the rest.`;
