import { runWidgetQuery } from "./query";
import { STARTER_SECTIONS, type StarterCondition, type StarterSection } from "./starter";
import { TOM_NOHASH_SECTIONS, TOM_SECTIONS } from "./tom";
import { buildTemplate, ERAN_SECTIONS, layoutSections, type TemplateId, type TemplateSection } from "./templates";
import type { WidgetSpec } from "./widgets";

export interface BuiltTemplate {
  widgets: WidgetSpec[];
  /** Parts left out because the workspace's data does not reach their minimum. */
  skipped: Array<{ title: string; what: string; have: number; need: number }>;
}

async function passes(cond: StarterCondition, focal?: string): Promise<{ ok: boolean; have: number }> {
  const res = await runWidgetQuery(cond.sql, 1, null, focal ? { focal } : undefined);
  const have = res.ok ? Number(res.rows[0]?.n ?? 0) || 0 : 0;
  return { ok: have >= cond.min, have };
}

/**
 * Builds a template for this workspace. The starter is data-aware: conditional elements and
 * sections are included only when their signal exists in enough volume, so nobody opens a new
 * dashboard onto an empty chart. `focal` builds it as if another tracked brand were "us".
 */
export async function buildTemplateForWorkspace(id: TemplateId, opts: { focal?: string } = {}): Promise<BuiltTemplate> {
  if (id === "eran") return buildWithoutComments(ERAN_SECTIONS, opts.focal);
  if (id === "starter") return buildConditional(STARTER_SECTIONS, opts.focal);
  if (id === "tom") return buildConditional(TOM_SECTIONS, opts.focal);
  if (id === "tomnohash") return buildConditional(TOM_NOHASH_SECTIONS, opts.focal);
  return { widgets: buildTemplate(id), skipped: [] };
}

/** Lays out sections whose parts carry `when` conditions, leaving out the parts the data cannot support. */
async function buildConditional(all: StarterSection[], focal?: string): Promise<BuiltTemplate> {
  const skipped: BuiltTemplate["skipped"] = [];
  const cache = new Map<string, { ok: boolean; have: number }>();
  const check = async (c: StarterCondition) => {
    if (!cache.has(c.sql)) cache.set(c.sql, await passes(c, focal));
    return cache.get(c.sql)!;
  };
  const sections: TemplateSection[] = [];
  for (const sec of all) {
    if (sec.when) {
      const r = await check(sec.when);
      if (!r.ok) {
        skipped.push({ title: sec.title, what: sec.when.what, have: r.have, need: sec.when.min });
        continue;
      }
    }
    const widgets: TemplateSection["widgets"] = [];
    for (const el of sec.widgets) {
      const { when, ...spec } = el;
      if (when) {
        const r = await check(when);
        if (!r.ok) {
          skipped.push({ title: spec.title, what: when.what, have: r.have, need: when.min });
          continue;
        }
      }
      widgets.push(spec);
    }
    if (widgets.length) sections.push({ title: sec.title, widgets });
  }
  // Numbered questions stay 1, 2, 3 when one in the middle was left out.
  let n = 0;
  const numbered = sections.map((sec) => (/^\d+\. /.test(sec.title) ? { ...sec, title: `${++n}. ${sec.title.replace(/^\d+\. /, "")}` } : sec));
  return { widgets: layoutSections(numbered), skipped };
}

/** True when a query reads the comments table (not the comments count column on posts). */
const READS_COMMENTS = /\b(from|join)\s+comments(_all)?\b/i;

/**
 * A fixed template on brands that have creator posts but no audience comments: the elements that
 * read comments are left out (with a note), so the dashboard does not open onto empty charts.
 */
async function buildWithoutComments(all: TemplateSection[], focal?: string): Promise<BuiltTemplate> {
  const have = await passes({ sql: `SELECT count(*)::int AS n FROM comments_all WHERE brand = focal_brand()`, min: 1, what: "" }, focal);
  if (have.ok) return { widgets: layoutSections(all), skipped: [] };
  const skipped: BuiltTemplate["skipped"] = [];
  const sections: TemplateSection[] = [];
  for (const sec of all) {
    const widgets = sec.widgets.filter((w) => !(w.sql && READS_COMMENTS.test(w.sql)));
    for (const w of sec.widgets) if (!widgets.includes(w)) skipped.push({ title: w.title, what: "audience comments", have: 0, need: 1 });
    if (widgets.length) sections.push({ title: sec.title, widgets });
  }
  return { widgets: layoutSections(sections), skipped };
}

/** The note the analyst leaves in the chat when parts of the starter were left out. */
export function skippedNote(skipped: BuiltTemplate["skipped"]): string | null {
  if (!skipped.length) return null;
  // Brands with posts but no comments lose many elements for one reason: say it once.
  const noComments = skipped.filter((s) => s.have === 0 && /comments/.test(s.what));
  const rest = skipped.filter((s) => !noComments.includes(s));
  const lines = rest.map((s) => `- **${s.title.replace(/^\d+\. /, "").replace(/\?$/, "")}**: needs ${s.need}+ ${s.what}; there ${s.have === 1 ? "is" : "are"} ${s.have} so far.`);
  if (noComments.length) lines.unshift(`- **Everything built on audience comments** (${noComments.map((s) => s.title.replace(/^\d+\. /, "").replace(/\?$/, "")).join("; ")}): these brands have creator posts but no comments.`);
  return `I built this dashboard from the template and left out what the data cannot support yet:\n\n${lines.join("\n")}\n\nThey will be worth adding when that data arrives. Ask me for any of them and I will propose it with what is there.`;
}
