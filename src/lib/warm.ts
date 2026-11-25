import { listDashboards } from "./dashboards";
import { effectiveWindow, resolveCompare, resolveWindow } from "./period";
import { resolveScope, runInScope } from "./scope";
import { answerWidget, requestWindow } from "./widget-data";
import { isDataWidget } from "./widgets";

/** The most dashboards warmed in one pass: the most recently changed ones. */
const MAX_DASHBOARDS = () => Number(process.env.WARM_DASHBOARDS ?? 12) || 12;

export interface WarmResult { dashboards: number; boxes: number; worked: number; alreadyStored: number; failed: number; finished: boolean }

/**
 * Works out the boxes of the saved dashboards ahead of the first visitor, so nobody waits after
 * the data changes. Each box is asked for exactly as the page asks (same brands, saved period and
 * market, same comparison), so its answer lands in the store under the key the page will look up.
 * A box whose answer is already stored costs one lookup. The boxes that carry a section's answer
 * go first, because the summary shows them. Stops when `budgetMs` is spent; the next call goes on.
 */
export async function warmDashboards(budgetMs: number): Promise<WarmResult> {
  const started = Date.now();
  const spent = () => Date.now() - started > budgetMs;
  const out: WarmResult = { dashboards: 0, boxes: 0, worked: 0, alreadyStored: 0, failed: 0, finished: true };
  const dashboards = (await listDashboards()).slice(0, MAX_DASHBOARDS());
  for (const d of dashboards) {
    out.dashboards += 1;
    const main = resolveWindow(d.period);
    const boxes = d.widgets.filter((w) => !!w.sql && isDataWidget(w.type));
    const first = (title: string) => (title.startsWith("The answer") || title === "The three outcomes" ? 0 : 1);
    boxes.sort((a, b) => first(a.title) - first(b.title));
    const work = async (w: (typeof boxes)[number]) => {
      if (spent()) { out.finished = false; return; }
      const win = effectiveWindow(main, w.period);
      // The page compares only boxes that follow the dashboard's period.
      const compare = w.period && w.period !== "inherit" ? null : resolveCompare(d.period);
      const res = await answerWidget(w.sql!, requestWindow(win), compare ? requestWindow(compare) : undefined, w.sample?.sql);
      out.boxes += 1;
      if (!res.ok) out.failed += 1;
      else if (res.stored) out.alreadyStored += 1;
      else out.worked += 1;
    };
    await runInScope(resolveScope(d.scope), async () => {
      // Four at a time: enough to be quick, few enough to leave the database free for visitors.
      let at = 0;
      await Promise.all(Array.from({ length: 4 }, async () => { while (at < boxes.length && !spent()) await work(boxes[at++]); }));
      if (at < boxes.length) out.finished = false;
    });
    if (spent()) { out.finished = false; break; }
  }
  return out;
}
