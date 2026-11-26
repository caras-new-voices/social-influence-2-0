import { runInScope } from "./scope";
import { buildTemplateForWorkspace } from "./template-build";
import { isTemplateId, type TemplateId } from "./templates";
import { newId, type DashboardRecord, type WidgetSpec } from "./widgets";

/**
 * What a saved dashboard is missing against the template it was made from. A dashboard keeps the
 * boxes it was created with, so every later change to the template shows only in new dashboards.
 * This works out, for the dashboard's own brands:
 *  - added: boxes the template has now and the dashboard does not, each placed after the box it
 *    follows in the template, with the moves that make room for it;
 *  - changed: boxes on both whose definition differs (query, wording, chart settings);
 *  - own: boxes on the dashboard that the template does not have (the person's own, or ones the
 *    template has since dropped). They are never touched.
 * Boxes are matched by title. Position, size and a box's own period are kept.
 */
export interface TemplateUpdate {
  template: TemplateId | null;
  added: WidgetSpec[];
  /** New y for existing boxes that move down to make room, by id. */
  moves: Record<string, number>;
  changed: Array<{ id: string; title: string; next: WidgetSpec }>;
  own: number;
}

/** A title without the number a numbered section carries, which shifts when a section is left out. */
const key = (title: string) => title.replace(/^\d+\.\s+/, "").trim().toLowerCase();
/** A box's definition: everything except who it is, where it sits and its own period. */
function definition(w: WidgetSpec): string {
  const { id: _id, layout: _layout, period: _period, title, ...rest } = w;
  void _id; void _layout; void _period;
  return JSON.stringify({ title: key(title), ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))) });
}
const overlap = (dashboard: WidgetSpec[], template: WidgetSpec[]) => {
  const have = new Set(dashboard.map((w) => key(w.title)));
  return template.filter((w) => have.has(key(w.title))).length;
};

/** The template a dashboard was made from: the one recorded, else the one most of its boxes come from. */
async function templateOf(d: DashboardRecord & { template?: string | null }): Promise<{ id: TemplateId; widgets: WidgetSpec[] } | null> {
  const build = async (id: TemplateId) => ({ id, widgets: (await buildTemplateForWorkspace(id)).widgets });
  if (isTemplateId(d.template) && d.template !== "blank") return build(d.template);
  let best: { id: TemplateId; widgets: WidgetSpec[]; n: number } | null = null;
  for (const id of ["tom8", "tom", "tomnohash", "starter", "eran"] as TemplateId[]) {
    const t = await build(id);
    const n = overlap(d.widgets, t.widgets);
    if (!best || n > best.n) best = { ...t, n };
    // Most of the dashboard comes from this one: no need to try the older templates.
    if (n >= 10 && n >= 0.6 * d.widgets.length) break;
  }
  return best && best.n >= 5 ? best : null;
}

export async function templateUpdate(d: DashboardRecord & { template?: string | null }): Promise<TemplateUpdate> {
  return runInScope(d.scope ?? null, async () => {
    const t = await templateOf(d);
    if (!t) return { template: null, added: [], moves: {}, changed: [], own: 0 };
    const template = [...t.widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
    // Working copy of where everything sits; matched boxes are taken once each.
    const place = new Map(d.widgets.map((w) => [w.id, { ...w.layout }]));
    const free = new Map<string, WidgetSpec[]>();
    for (const w of d.widgets) free.set(key(w.title), [...(free.get(key(w.title)) ?? []), w]);
    const added: WidgetSpec[] = [];
    const changed: TemplateUpdate["changed"] = [];
    const matched = new Set<string>();
    let anchor: { id: string; templateY: number } | null = null;
    for (const tw of template) {
      const mine = free.get(key(tw.title))?.shift();
      if (mine) {
        matched.add(mine.id);
        if (definition(mine) !== definition(tw)) changed.push({ id: mine.id, title: mine.title, next: { ...tw, id: mine.id, layout: mine.layout, ...(mine.period ? { period: mine.period } : {}) } });
        anchor = { id: mine.id, templateY: tw.layout.y };
        continue;
      }
      const id = newId();
      const a = anchor ? place.get(anchor.id)! : null;
      let spot: WidgetSpec["layout"];
      if (a && anchor!.templateY === tw.layout.y && a.x + a.w + tw.layout.w <= 12) {
        // Beside the box it sits beside in the template.
        spot = { x: a.x + a.w, y: a.y, w: tw.layout.w, h: tw.layout.h };
      } else {
        // Below the box it follows; everything from there on moves down.
        const y = a ? a.y + a.h : 0;
        for (const l of place.values()) if (l.y >= y) l.y += tw.layout.h;
        spot = { x: tw.layout.x, y, w: tw.layout.w, h: tw.layout.h };
      }
      place.set(id, spot);
      added.push({ ...tw, id });
      anchor = { id, templateY: tw.layout.y };
    }
    const moves: Record<string, number> = {};
    for (const w of d.widgets) if (place.get(w.id)!.y !== w.layout.y) moves[w.id] = place.get(w.id)!.y;
    return { template: t.id, added: added.map((w) => ({ ...w, layout: place.get(w.id)! })), moves, changed, own: d.widgets.filter((w) => !matched.has(w.id)).length };
  });
}
