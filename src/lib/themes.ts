import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Db } from "./db";

/**
 * Themes and hooks. Every post gets the themes (what it is about) and the hooks (how it is told)
 * whose rule matches the words of its caption. The rules live in data/seed/themes.json: one list
 * of themes per industry and one list of hooks for all of them, each a name and a regular
 * expression. Nothing here names a brand or an industry.
 *
 * Where an industry has been classified by a language model (scripts/classify_posts.py writes
 * data/seed/labels/<industry>.json.gz), those labels are used instead: one primary theme, up to two
 * secondary ones, one hook, and whether the post is really about the brand. The word rules then
 * only cover posts the model has not seen, such as posts that arrive with a later import.
 *
 * The result is stored in post_labels_raw and read through the post_themes, post_hooks and
 * post_about views, so nothing that reads it depends on where a label came from.
 */
interface LabelsFile {
  industry: string;
  model?: string;
  themes: string[];
  hooks: string[];
  /** [segment_id, post_id, primary theme (1-based, 0 other, -1 unknown), secondary themes, hook (1-based, 0 none), about] */
  rows: Array<[number, number, number, number[], number, string]>;
}

function seedDir() {
  return process.env.SEED_DIR ?? path.join(process.cwd(), "data", "seed");
}

function readLabels(industry: string): { file: LabelsFile; hash: string } | null {
  const p = path.join(seedDir(), "labels", `${industry}.json.gz`);
  if (!fs.existsSync(p)) return null;
  try {
    const buf = fs.readFileSync(p);
    return { file: JSON.parse(zlib.gunzipSync(buf).toString("utf8")) as LabelsFile, hash: crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12) };
  } catch (e) {
    console.error(`[themes] could not read the labels for ${industry}:`, (e as Error).message);
    return null;
  }
}

const OTHER = "Other";
const UNKNOWN = "Unknown";

/** Turns a labels file into rows for post_labels_raw. The brand comes from the post itself at insert time. */
function labelRows(file: LabelsFile): Array<{ segment_id: number; post_id: number; kind: string; label: string; rank: number | null }> {
  const out: Array<{ segment_id: number; post_id: number; kind: string; label: string; rank: number | null }> = [];
  for (const [segment_id, post_id, theme, also, hook, about] of file.rows) {
    const primary = theme > 0 ? file.themes[theme - 1] : theme === 0 ? OTHER : UNKNOWN;
    if (primary) out.push({ segment_id, post_id, kind: "theme", label: primary, rank: 1 });
    for (const a of also ?? []) if (file.themes[a - 1] && file.themes[a - 1] !== primary) out.push({ segment_id, post_id, kind: "theme", label: file.themes[a - 1], rank: 2 });
    if (hook > 0 && file.hooks[hook - 1]) out.push({ segment_id, post_id, kind: "hook", label: file.hooks[hook - 1], rank: 1 });
    if (about === "yes" || about === "passing" || about === "no") out.push({ segment_id, post_id, kind: "about", label: about, rank: 1 });
  }
  return out;
}
const CHUNK = 4000;
interface RulesFile {
  version?: number;
  hooks: Array<{ name: string; pattern: string }>;
  industries: Record<string, Array<{ name: string; pattern: string }>>;
}

function readRules(): { file: RulesFile; hash: string } | null {
  const p = path.join(seedDir(), "themes.json");
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
  const spent = () => Date.now() - started > budgetMs;
  for (const ind of industries) {
    const key = `themes:${ind.industry}`;
    const model = readLabels(ind.industry);
    const base = `${rules.hash}:${model?.hash ?? "rules"}:${ind.posts}`;
    const state = (await getMeta(db, key)) ?? "";
    if (state === `${base}|done`) continue;
    if (spent()) {
      pending++;
      continue;
    }
    // Progress is kept as "<step>:<position>", so an interrupted run continues where it stopped.
    let step = "model";
    let at = 0;
    if (state.startsWith(`${base}|`)) {
      const [st, pos] = state.slice(base.length + 1).split(":");
      step = st;
      at = Number(pos) || 0;
    } else {
      await db.query(`DELETE FROM post_labels_raw WHERE segment_id IN (SELECT id FROM segments_raw WHERE industry = $1)`, [ind.industry]);
    }
    let stopped = false;
    if (step === "model") {
      const rows = model ? labelRows(model.file) : [];
      while (at < rows.length) {
        if (spent()) {
          stopped = true;
          break;
        }
        await db.query(
          `INSERT INTO post_labels_raw (segment_id, post_id, brand, kind, label, rank, source)
           SELECT t.segment_id, t.post_id, p.brand, t.kind, t.label, t.rank, 'model'
             FROM jsonb_to_recordset($1::jsonb) AS t(segment_id integer, post_id bigint, kind text, label text, rank smallint)
             JOIN posts_raw p ON p.segment_id = t.segment_id AND p.post_id = t.post_id
           ON CONFLICT DO NOTHING`,
          [JSON.stringify(rows.slice(at, at + CHUNK))],
        );
        at += CHUNK;
        await setMeta(db, key, `${base}|model:${at}`);
      }
      if (!stopped) {
        step = "rules";
        at = 0;
      }
    }
    const list = await db.query<{ kind: string; label: string; pattern: string }>(
      `SELECT kind, label, pattern FROM theme_rules WHERE industry = $1 OR industry = '*' ORDER BY kind, sort, label`,
      [ind.industry],
    );
    for (let i = at; !stopped && step === "rules" && i < list.length; i++) {
      if (spent()) {
        stopped = true;
        break;
      }
      const r = list[i];
      try {
        // One statement per rule, so a rule with a bad pattern is skipped without losing the others.
        // Posts the model has labelled keep the model's answer.
        await db.query(
          `INSERT INTO post_labels_raw (segment_id, post_id, brand, kind, label, source)
           SELECT p.segment_id, p.post_id, p.brand, $2, $3, 'rules' FROM posts_raw p JOIN segments_raw s ON s.id = p.segment_id
            WHERE s.industry = $1 AND p.text IS NOT NULL AND lower(p.text) ~ $4
              AND NOT EXISTS (SELECT 1 FROM post_labels_raw m WHERE m.segment_id = p.segment_id AND m.post_id = p.post_id AND m.source = 'model')
           ON CONFLICT DO NOTHING`,
          [ind.industry, r.kind, r.label, r.pattern],
        );
      } catch (e) {
        console.error(`[themes] rule "${r.label}" (${ind.industry}) failed:`, (e as Error).message.slice(0, 200));
      }
      await setMeta(db, key, `${base}|rules:${i + 1}`);
    }
    if (stopped) {
      pending++;
      continue;
    }
    await setMeta(db, key, `${base}|done`);
    log(`${ind.industry}: ${ind.posts} posts labelled${model ? ` (model labels: ${model.file.rows.length})` : " by word rules"}`);
  }
  return { pending };
}
