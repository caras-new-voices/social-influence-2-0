import fs from "node:fs";
import path from "node:path";

/**
 * The measured accuracy of each thing a model or a rule reads from the data, for the Method page.
 * The figures are in data/seed/accuracy.json, which the checks write (scripts/check_accuracy.py and
 * scripts/classify_products.py judge and judge-claims), so the page shows the last measurement.
 */
export interface AccuracyLine {
  key: string;
  what: string;
  /** Agreement with the judge, in percent. */
  agreement: number;
  sample: string;
  scope: string;
  /** The day it was measured. */
  measured: string;
}

export const ACCURACY_JUDGE = "A stronger model reads a random sample without seeing our answer. This is agreement between two models, not a human check.";

/** The accuracy lines and the pass mark, read from the seed folder. Empty when the file is missing. */
export function readAccuracy(): { pass: number; lines: AccuracyLine[] } {
  try {
    const file = path.join(process.env.SEED_DIR ?? path.join(process.cwd(), "data", "seed"), "accuracy.json");
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as { pass?: number; lines?: AccuracyLine[] };
    return { pass: doc.pass ?? 90, lines: doc.lines ?? [] };
  } catch {
    return { pass: 90, lines: [] };
  }
}


export const MEASURES: Array<{ name: string; formula: string; note: string }> = [
  { name: "Share of voice", formula: "Our posts ÷ all tracked brands' posts", note: "Also shown by views, creators and engagements. The category is the tracked brands, not the whole market." },
  { name: "Engagement vs norm", formula: "Engagements ÷ expected engagements", note: "Expected is reach times the tracked brands' engagement rate for that platform and creator size. Reach is views, or followers for Instagram image posts and posts without views. The norm is fixed over all time, so a month can be compared with another. With a market selected, the norm is that market's own." },
  { name: "Momentum", formula: "Posts in the period ÷ posts in the period before, minus 1", note: "Viewing all time, it is the last 90 days against the 90 before. A calendar month is compared with the month before." },
  { name: "Earned share", formula: "Earned posts ÷ all our posts", note: "Earned means not from our own accounts, not paid, not sold for commission and not gifted." },
  { name: "Purchase intent", formula: "Buying-signal comments per 1,000 brand comments", note: "A buying signal asks where to get it, the price or a code, or says they will buy or just bought." },
  { name: "Praise and objections", formula: "Positive, and negative, comments per 1,000 brand comments", note: "Split by six attributes: price, efficacy, ease, durability, safety, service." },
  { name: "Content gap", formula: "A theme's share of comments minus its share of posts, in points", note: "Above zero, the audience talks about it more than creators cover it." },
  { name: "Creator score", formula: "40% engagement vs norm, 20% buying signals, 15% theme fit, 10% audience match, 10% value, 5% availability", note: "Performance, buying signals and value are the creator's rank among all creators. Audience match is the share of their audience inside the target audience set on the dashboard, and a neutral half when none is set or their audience is not known. Value is the modelled fee per engagement. Availability is lost when a rival has paid them. Creators with fewer than five posts are scaled down." },
];

export const THRESHOLDS: Array<[string, string]> = [
  ["Outperforming", "Engagement vs norm of 1.2 or more"],
  ["Winning theme", "Growing, and at 1.2 or more"],
  ["Early signal", "1.5 or more, with momentum under 20%"],
  ["Peaking", "Growth of 50% or more, below the norm"],
  ["Smallest theme shown", "30 posts"],
  ["Smallest sample behind a comment measure", "200 brand comments"],
  ["Smallest market offered in the market filter", "30 posts"],
  ["Open or crowded benefit", "5 points between share of praise and share of claims"],
];

export const LIMITS: string[] = [
  "Only hair removal has audience comments. The other industries show the measures that need posts only.",
  "Captions are cut at 600 characters in the supplied data and there are no transcripts, so themes, hooks and claims are read from the caption alone.",
  "A partnership the creator does not disclose looks earned.",
  "The supplier's paid flag is not explained. Posts flagged with nothing in the caption are shown as \"Paid: platform label only\".",
  "The list of brand-owned accounts and the product lines are drafts that nobody who knows the brands has confirmed.",
  "Creator fees are the supplier's model, not quotes.",
  "The Culture lens of the brief is not built: it needs a query beyond brand mentions.",
];
