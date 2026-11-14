import { runWidgetQuery } from "./query";
import { STARTER_SECTIONS, type StarterCondition } from "./starter";
import { buildTemplate, layoutSections, type TemplateId, type TemplateSection } from "./templates";
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
  if (id !== "starter") return { widgets: buildTemplate(id), skipped: [] };
  const skipped: BuiltTemplate["skipped"] = [];
  const cache = new Map<string, { ok: boolean; have: number }>();
  const check = async (c: StarterCondition) => {
    if (!cache.has(c.sql)) cache.set(c.sql, await passes(c, opts.focal));
    return cache.get(c.sql)!;
  };
  const sections: TemplateSection[] = [];
  for (const sec of STARTER_SECTIONS) {
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
  return { widgets: layoutSections(sections), skipped };
}

/** The note the analyst leaves in the chat when parts of the starter were left out. */
export function skippedNote(skipped: BuiltTemplate["skipped"]): string | null {
  if (!skipped.length) return null;
  const lines = skipped.map((s) => `- **${s.title.replace(/\?$/, "")}**: needs ${s.need}+ ${s.what}; there ${s.have === 1 ? "is" : "are"} ${s.have} so far.`);
  return `I built this dashboard from the starter template and left out what the data cannot support yet:\n\n${lines.join("\n")}\n\nThey will be worth adding as more data arrives. Ask me for any of them and I will propose it with what is there.`;
}
