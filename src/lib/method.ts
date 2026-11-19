/**
 * The measured accuracy of each thing a model or a rule reads from the data, for the Method page.
 * Figures come from the reports in docs/ (accuracy-report*.md). Update them when a check is run again.
 */
export interface AccuracyLine {
  what: string;
  /** Agreement with the judge, in percent. */
  agreement: number;
  sample: string;
  scope: string;
}

export const ACCURACY_DATE = "18 November 2026";
export const ACCURACY_JUDGE = "A stronger model reads a random sample without seeing our answer. This is agreement between two models, not a human check.";
export const PASS_MARK = 90;

export const ACCURACY: AccuracyLine[] = [
  { what: "Paid, gifted or neither", agreement: 97, sample: "1,500 posts", scope: "All industries" },
  { what: "Posts shown as paid from the caption really disclose it", agreement: 92, sample: "718 posts", scope: "All industries" },
  { what: "Posts kept are about the brand they are filed under", agreement: 89.7, sample: "1,499 posts", scope: "All industries" },
  { what: "A comment is about the brand or category, or it is not", agreement: 89, sample: "300 comments", scope: "Hair removal" },
  { what: "The right one of the six attributes on a brand comment", agreement: 87, sample: "150 comments", scope: "Hair removal" },
  { what: "Comments counted as buying signals are buying signals", agreement: 92, sample: "150 comments", scope: "Hair removal" },
  { what: "Unanswered questions are about the brand", agreement: 98, sample: "175 comments", scope: "Hair removal" },
  { what: "Earned creators: no disclosure in their captions", agreement: 94, sample: "108 creators", scope: "Hair removal" },
  { what: "The theme of a post", agreement: 78, sample: "measured the week before", scope: "Hair removal" },
  { what: "The product line of a post, where one is named", agreement: 94, sample: "141 posts", scope: "Hair removal" },
  { what: "The product line of a brand comment, where one is named", agreement: 93, sample: "162 comments", scope: "Hair removal" },
  { what: "A caption we tag as claiming price really claims it", agreement: 100, sample: "34 posts", scope: "Hair removal" },
  { what: "A caption we tag as claiming efficacy really claims it", agreement: 100, sample: "66 posts", scope: "Hair removal" },
  { what: "A caption we tag as claiming ease of use really claims it", agreement: 98, sample: "57 posts", scope: "Hair removal" },
  { what: "A caption we tag as claiming safety and comfort really claims it", agreement: 100, sample: "76 posts", scope: "Hair removal" },
  { what: "A caption we tag as claiming durability really claims it", agreement: 100, sample: "5 posts", scope: "Hair removal" },
  { what: "A caption we tag as claiming service and availability really claims it", agreement: 96, sample: "28 posts", scope: "Hair removal" },
  { what: "Share of the judge's claims that we also find (we read more strictly)", agreement: 78, sample: "300 posts", scope: "Hair removal" },
];

export const MEASURES: Array<{ name: string; formula: string; note: string }> = [
  { name: "Share of voice", formula: "Our posts ÷ all tracked brands' posts", note: "Also shown by views, creators and engagements. The category is the tracked brands, not the whole market." },
  { name: "Engagement vs norm", formula: "Engagements ÷ expected engagements", note: "Expected is reach times the tracked brands' engagement rate for that platform and creator size. Reach is views, or followers for Instagram image posts and posts without views. The norm is fixed over all time, so a month can be compared with another. With a market selected, the norm is that market's own." },
  { name: "Momentum", formula: "Posts in the period ÷ posts in the period before, minus 1", note: "Viewing all time, it is the last 90 days against the 90 before. A calendar month is compared with the month before." },
  { name: "Earned share", formula: "Earned posts ÷ all our posts", note: "Earned means not from our own accounts, not paid, not sold for commission and not gifted." },
  { name: "Purchase intent", formula: "Buying-signal comments per 1,000 brand comments", note: "A buying signal asks where to get it, the price or a code, or says they will buy or just bought." },
  { name: "Praise and objections", formula: "Positive, and negative, comments per 1,000 brand comments", note: "Split by six attributes: price, efficacy, ease, durability, safety, service." },
  { name: "Content gap", formula: "A theme's share of comments minus its share of posts, in points", note: "Above zero, the audience talks about it more than creators cover it." },
  { name: "Creator score", formula: "45% engagement vs norm, 25% buying signals, 15% theme fit, 10% value, 5% availability", note: "Each part is the creator's rank among all creators. Value is the modelled fee per engagement. Availability is lost when a rival has paid them. Creators with fewer than five posts are scaled down." },
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
