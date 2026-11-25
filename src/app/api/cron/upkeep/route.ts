import { after, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAuthorized } from "@/lib/imports";
import { readNewRows } from "@/lib/live-classify";
import { ensureReady } from "@/lib/schema";
import { classifyPosts } from "@/lib/themes";
import { warmDashboards } from "@/lib/warm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How many times a run may call itself to finish the work: enough for a large import, not endless. */
const MAX_CHAIN = 40;

/**
 * Upkeep after the data changes (called once a day by the cron in vercel.json, and by an import
 * when it finishes):
 *  1. reads new posts and comments with the model, so a later import is labelled like the first data;
 *  2. applies the corrections that depend on those readings;
 *  3. works out the saved dashboards' boxes, so the first visitor does not wait.
 * Each step has a time budget. While work remains the run calls itself again, up to MAX_CHAIN times.
 * ?warm=0 skips step 3, ?read=0 skips step 1, ?chain=0 stops it calling itself.
 */
async function run(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const n = Number(url.searchParams.get("n") ?? 0) || 0;
  const budget = Math.min(240_000, Number(url.searchParams.get("budget") ?? 0) || 240_000);
  const started = Date.now();
  const left = () => budget - (Date.now() - started);
  const log = (m: string) => console.log("[upkeep]", m);
  try {
    await ensureReady();
    const db = await getDb();
    const before = await classifyPosts(db, Math.min(60_000, left()), log);
    const reading = url.searchParams.get("read") === "0" ? null : await readNewRows(db, Math.max(0, left() - 60_000), log);
    const applied = await classifyPosts(db, Math.max(5_000, Math.min(60_000, left())), log);
    const waiting = (reading?.enabled ? reading.pending.reduce((a, p) => a + p.posts + p.comments, 0) : 0) + (reading?.note?.startsWith("The limit") ? -1e9 : 0);
    const settled = !before.pending && !applied.pending && waiting <= 0;
    // Warm only once the labels are settled: answers worked out before that would be thrown away.
    const warm = url.searchParams.get("warm") === "0" || !settled || left() < 10_000 ? null : await warmDashboards(left() - 5_000);
    const more = !settled || (warm ? !warm.finished : url.searchParams.get("warm") !== "0");
    // Reading that returns nothing while rows wait (the model is failing) must not loop.
    const stuck = !!reading?.enabled && waiting > 0 && reading.posts + reading.comments === 0 && !before.pending && !applied.pending;
    const again = more && !stuck && url.searchParams.get("chain") !== "0" && n < MAX_CHAIN;
    if (again) {
      const next = new URL(url);
      next.searchParams.set("n", String(n + 1));
      const auth = req.headers.get("authorization");
      // After the response is sent, so this run ends and the next one has its own time limit.
      after(() => fetch(next, { method: "POST", headers: auth ? { authorization: auth } : {}, signal: AbortSignal.timeout(10_000) }).catch(() => {}));
    }
    return NextResponse.json({ ok: true, run: n, ms: Date.now() - started, corrections: { pending: applied.pending }, reading, warm, continues: again });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
