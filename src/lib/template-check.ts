import { getWorkspace } from "./brands";
import { getCoverage } from "./coverage";
import { monthEnd, monthStart, type PeriodWindow } from "./period";
import { runWidgetQuery } from "./query";
import { ensureReady } from "./schema";
import { buildTemplateForWorkspace } from "./template-build";
import type { TemplateId } from "./templates";

/**
 * The rotation test behind "works for any brand": every tracked brand takes a turn as the focal
 * brand, the template is built for it, and every element runs over all time and over each month
 * with data. An element passes when it returns rows, or when it is empty inside a period (the card
 * then shows its designed empty state). An error always fails; an empty core element over all time
 * fails. The built template is also scanned for brand, alias and category words.
 */
export interface CheckFailure {
  focal: string;
  window: string;
  element: string;
  problem: string;
}

export interface BrandCheck {
  focal: string;
  elements: number;
  skipped: string[];
  queries: number;
  emptyInPeriod: number;
  emptyAllTime: string[];
}

export interface TemplateCheckResult {
  template: TemplateId;
  ok: boolean;
  brands: BrandCheck[];
  failures: CheckFailure[];
  neutrality: string[];
  queries: number;
  ms: number;
}

/** Sections whose elements must return rows over all time for any brand that has data at all. */
const CORE_SECTION = /^[123]\. /;

export async function checkTemplate(template: TemplateId, opts: { months?: boolean; brands?: string[] } = {}): Promise<TemplateCheckResult> {
  await ensureReady();
  const started = Date.now();
  const ws = getWorkspace();
  const cov = await getCoverage();
  const windows: Array<{ label: string; window: PeriodWindow | null }> = [{ label: "all time", window: null }];
  if (opts.months !== false) {
    for (const m of cov.months.filter((x) => x.posts > 0)) windows.push({ label: m.month, window: { start: monthStart(m.month), end: monthEnd(m.month) } });
  }
  const failures: CheckFailure[] = [];
  const brands: BrandCheck[] = [];
  const neutrality = new Set<string>();
  const words = [...ws.brands.map((b) => b.name), ...ws.aliases.map((a) => a.replace(/%/g, "")), ...(ws.category ? [ws.category] : []), ...(ws.company ? [ws.company] : [])]
    .filter((w) => w.length >= 3)
    .map((w) => w.toLowerCase());
  let queries = 0;

  for (const brand of ws.brands.filter((b) => !opts.brands || opts.brands.includes(b.name))) {
    const built = await buildTemplateForWorkspace(template, { focal: brand.name });
    const check: BrandCheck = { focal: brand.name, elements: built.widgets.filter((w) => w.type !== "section").length, skipped: built.skipped.map((s) => s.title), queries: 0, emptyInPeriod: 0, emptyAllTime: [] };
    let section = "";
    for (const w of built.widgets) {
      if (w.type === "section") { section = w.title; }
      const text = [w.title, w.subtitle, w.rationale, w.sql, w.content].filter(Boolean).join(" \n ").toLowerCase();
      for (const word of words) if (text.includes(word)) neutrality.add(`"${word}" in "${w.title}"`);
      if (!w.sql) continue;
      for (const win of windows) {
        const window = w.period === "all" ? null : win.window;
        const res = await runWidgetQuery(w.sql, 50, window, { focal: brand.name });
        queries++; check.queries++;
        if (!res.ok) {
          failures.push({ focal: brand.name, window: win.label, element: w.title, problem: res.error });
        } else if (res.rows.length === 0) {
          if (window) check.emptyInPeriod++;
          else if (!win.window) {
            check.emptyAllTime.push(w.title);
            if (CORE_SECTION.test(section)) failures.push({ focal: brand.name, window: win.label, element: w.title, problem: "core element is empty over all time" });
          }
        }
        if (w.sample && res.ok) {
          const s = await runWidgetQuery(w.sample.sql, 1, window, { focal: brand.name });
          queries++;
          if (!s.ok) failures.push({ focal: brand.name, window: win.label, element: w.title, problem: `sample query failed: ${s.error}` });
        }
      }
    }
    brands.push(check);
  }
  return { template, ok: failures.length === 0 && neutrality.size === 0, brands, failures, neutrality: [...neutrality], queries, ms: Date.now() - started };
}
