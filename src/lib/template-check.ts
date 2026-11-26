import { getWorkspace } from "./brands";
import { getCatalog } from "./catalog";
import { getCoverage } from "./coverage";
import { monthEnd, monthStart, type PeriodWindow } from "./period";
import { runWidgetQuery } from "./query";
import { ensureReady } from "./schema";
import { runInScope } from "./scope";
import { buildTemplateForWorkspace } from "./template-build";
import type { TemplateId } from "./templates";
import { WidgetSpecSchema } from "./widgets";

/**
 * The rotation test behind "works for any brand": in every industry, every brand takes a turn as
 * "us" with the industry's other brands as competitors. The template is built for it and every
 * element runs over all time and over each month with data. An element passes when it returns
 * rows, or when it is empty inside a period (the card then shows its designed empty state). An
 * error always fails; an empty core element over all time fails. The built template is also
 * scanned for brand, alias, owner and category words.
 */
export interface CheckFailure {
  industry: string;
  focal: string;
  window: string;
  element: string;
  problem: string;
}

export interface BrandCheck {
  industry: string;
  focal: string;
  posts: number;
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

/**
 * Sections whose elements must return rows over all time for any brand with a real amount of data.
 * Tom's template is analytical: outside its headline, a table can be rightly empty (no spike, no
 * unowned theme), so only the headline is held to it.
 */
const CORE_SECTIONS: Partial<Record<TemplateId, RegExp>> = { starter: /^[123]\. /, eran: /^[123]\. /, tom: /^The eight measures/, tomnohash: /^The eight measures/, tom8: /^The eight measures/ };
/** Below this many posts a brand is too thin for "must not be empty" to mean anything. */
const CORE_MIN_POSTS = 20;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function checkTemplate(template: TemplateId, opts: { months?: boolean; brands?: string[]; industries?: string[] } = {}): Promise<TemplateCheckResult> {
  await ensureReady();
  const started = Date.now();
  const failures: CheckFailure[] = [];
  const brands: BrandCheck[] = [];
  const neutrality = new Set<string>();
  let queries = 0;

  for (const ind of getCatalog().industries.filter((i) => !opts.industries || opts.industries.includes(i.id))) {
    for (const brand of ind.brands.filter((b) => !opts.brands || opts.brands.includes(b.name))) {
      const scope = { industry: ind.id, focal: brand.name, competitors: ind.brands.filter((b) => b !== brand).map((b) => b.name) };
      await runInScope(scope, async () => {
        const ws = getWorkspace();
        const cov = await getCoverage();
        const windows: Array<{ label: string; window: PeriodWindow | null }> = [{ label: "all time", window: null }];
        if (opts.months !== false) {
          for (const m of cov.months.filter((x) => x.posts > 0)) windows.push({ label: m.month, window: { start: monthStart(m.month), end: monthEnd(m.month) } });
        }
        // Whole words only: a brand called like an ordinary word must not match inside another word.
        const words = [...ws.brands.map((b) => b.name), ...ws.aliases.map((a) => a.replace(/%/g, "")), ...(ws.category ? [ws.category] : []), ...(ws.company ? [ws.company] : [])]
          .filter((w) => w.length >= 3)
          .map((w) => ({ word: w.toLowerCase(), re: new RegExp(`(^|[^a-z0-9])${escapeRe(w.toLowerCase())}([^a-z0-9]|$)`) }));
        const built = await buildTemplateForWorkspace(template);
        const check: BrandCheck = {
          industry: ind.id, focal: brand.name, posts: brand.posts,
          elements: built.widgets.filter((w) => w.type !== "section").length, skipped: built.skipped.map((s) => s.title), queries: 0, emptyInPeriod: 0, emptyAllTime: [],
        };
        let section = "";
        for (const w of built.widgets) {
          if (w.type === "section") section = w.title;
          const text = [w.title, w.subtitle, w.rationale, w.sql, w.content].filter(Boolean).join(" \n ").toLowerCase();
          for (const { word, re } of words) if (re.test(text)) neutrality.add(`"${word}" in "${w.title}"`);
          // A box the save route would refuse makes the whole dashboard impossible to save.
          const valid = WidgetSpecSchema.safeParse(w);
          if (!valid.success) failures.push({ industry: ind.id, focal: brand.name, window: "any", element: w.title, problem: `cannot be saved: ${valid.error.issues[0]?.path.join(".")} ${valid.error.issues[0]?.message}` });
          if (!w.sql) continue;
          for (const win of windows) {
            const window = w.period === "all" ? null : win.window;
            const res = await runWidgetQuery(w.sql, 50, window);
            queries++; check.queries++;
            if (!res.ok) {
              failures.push({ industry: ind.id, focal: brand.name, window: win.label, element: w.title, problem: res.error });
            } else if (res.rows.length === 0) {
              if (window) check.emptyInPeriod++;
              else if (!win.window) {
                check.emptyAllTime.push(w.title);
                if (CORE_SECTIONS[template]?.test(section) && brand.posts >= CORE_MIN_POSTS) failures.push({ industry: ind.id, focal: brand.name, window: win.label, element: w.title, problem: "core element is empty over all time" });
              }
            }
            if (w.sample && res.ok) {
              const s = await runWidgetQuery(w.sample.sql, 1, window);
              queries++;
              if (!s.ok) failures.push({ industry: ind.id, focal: brand.name, window: win.label, element: w.title, problem: `sample query failed: ${s.error}` });
            }
          }
        }
        brands.push(check);
      });
    }
  }
  return { template, ok: failures.length === 0 && neutrality.size === 0, brands, failures, neutrality: [...neutrality], queries, ms: Date.now() - started };
}
