import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db";

/**
 * Themes and hooks. Every post gets the themes (what it is about) and the hooks (how it is told)
 * whose rule matches the words of its caption. The rules live in data/seed/themes.json: one list
 * of themes per industry and one list of hooks for all of them, each a name and a regular
 * expression. Nothing here names a brand or an industry.
 *
 * The result is stored in post_labels_raw and read through the post_themes and post_hooks views.
 * A model-based classifier can later fill the same table; nothing that reads it would change.
 */
interface RulesFile {
  version?: number;
  hooks: Array<{ name: string; pattern: string }>;
  industries: Record<string, Array<{ name: string; pattern: string }>>;
}

function readRules(): { file: RulesFile; hash: string } | null {
  const p = path.join(process.env.SEED_DIR ?? path.join(process.cwd(), "data", "seed"), "themes.json");
  if (!fs.existsSync(p)) return null;
  try {
    const buf = fs.readFileSync(p);
    return { file: JSON.parse(buf.toString("utf8")) as RulesFile, hash: crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12) };
  } catch (e) {
    console.error("[themes] could not read themes.json:", (e as Error).message);
    return null;
  }
}

async function getMeta(db: Db, key: string): Promise<string | null> {
  const rows = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}
async function setMeta(db: Db, key: string, value: string) {
  await db.query(`INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);
}

/** Copies the rules file into theme_rules when it changed. Hooks are stored under industry '*'. */
async function syncRules(db: Db, rules: { file: RulesFile; hash: string }) {
  if ((await getMeta(db, "themes_hash")) === rules.hash) return;
  await db.query(`DELETE FROM theme_rules`);
  const rows: Array<[string, string, string, string, number]> = [];
  rules.file.hooks.forEach((h, i) => rows.push(["*", "hook", h.name, h.pattern, i]));
  for (const [industry, list] of Object.entries(rules.file.industries)) list.forEach((t, i) => rows.push([industry, "theme", t.name, t.pattern, i]));
  for (const r of rows) await db.query(`INSERT INTO theme_rules (industry, kind, label, pattern, sort) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, r);
  await setMeta(db, "themes_hash", rules.hash);
}

/**
 * Assigns themes and hooks to the posts of every industry whose rules or posts changed since the
 * last run. Works one industry at a time and stops when `budgetMs` is spent; the next call
 * continues. Returns how many industries are still waiting.
 */
export async function classifyPosts(db: Db, budgetMs: number, log: (m: string) => void = () => {}): Promise<{ pending: number }> {
  const rules = readRules();
  if (!rules) return { pending: 0 };
  await syncRules(db, rules);
  const started = Date.now();
  const industries = await db.query<{ industry: string; posts: number }>(
    `SELECT s.industry, count(*)::int AS posts FROM posts_raw p JOIN segments_raw s ON s.id = p.segment_id WHERE s.industry IS NOT NULL GROUP BY 1 ORDER BY 2`,
  );
  let pending = 0;
  for (const ind of industries) {
    const key = `themes:${ind.industry}`;
    const state = `${rules.hash}:${ind.posts}`;
    if ((await getMeta(db, key)) === state) continue;
    if (Date.now() - started > budgetMs) {
      pending++;
      continue;
    }
    await db.query(`DELETE FROM post_labels_raw WHERE segment_id IN (SELECT id FROM segments_raw WHERE industry = $1)`, [ind.industry]);
    const list = await db.query<{ kind: string; label: string; pattern: string }>(
      `SELECT kind, label, pattern FROM theme_rules WHERE industry = $1 OR industry = '*' ORDER BY kind, sort`,
      [ind.industry],
    );
    let labelled = 0;
    for (const r of list) {
      try {
        // One statement per rule, so a rule with a bad pattern is skipped without losing the others.
        const res = await db.query<{ n: number }>(
          `WITH ins AS (
             INSERT INTO post_labels_raw (segment_id, post_id, brand, kind, label)
             SELECT p.segment_id, p.post_id, p.brand, $2, $3 FROM posts_raw p JOIN segments_raw s ON s.id = p.segment_id
              WHERE s.industry = $1 AND p.text IS NOT NULL AND lower(p.text) ~ $4
             ON CONFLICT DO NOTHING RETURNING 1)
           SELECT count(*)::int AS n FROM ins`,
          [ind.industry, r.kind, r.label, r.pattern],
        );
        labelled += Number(res[0]?.n ?? 0);
      } catch (e) {
        console.error(`[themes] rule "${r.label}" (${ind.industry}) failed:`, (e as Error).message.slice(0, 200));
      }
    }
    await setMeta(db, key, state);
    log(`${ind.industry}: ${labelled} labels on ${ind.posts} posts`);
  }
  return { pending };
}
