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
 *
 * The same pass corrects three things the supplied data gets wrong (applyFlags below): which
 * posts are paid, gifted or from the brand's own account; which posts are not about the brand;
 * and what each comment is about. Those land in columns of posts_raw and comments_raw.
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

/* ------------------------------------------------------------------ */
/* Paid, gifted, brand-owned, and what a comment is about                */
/* ------------------------------------------------------------------ */

interface DisclosureFile { values: string[]; rows: Array<[number, number, number]> }
interface ProductLabelsFile { products: string[]; attributes: string[]; posts: Array<[number, number, number, number]>; comments: Array<[number, number, number]> }
interface CommentLabelsFile { about: string[]; attributes: string[]; rows: Array<[number, number, number, number, number?]> }

function readGz<T>(folder: string, industry: string): { file: T; hash: string } | null {
  const p = path.join(seedDir(), folder, `${industry}.json.gz`);
  if (!fs.existsSync(p)) return null;
  try {
    const buf = fs.readFileSync(p);
    return { file: JSON.parse(zlib.gunzipSync(buf).toString("utf8")) as T, hash: crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12) };
  } catch (e) {
    console.error(`[themes] could not read ${folder} for ${industry}:`, (e as Error).message);
    return null;
  }
}

/**
 * Caption markers of a paid partnership, in the languages the data holds (Postgres regular
 * expressions on the lower-cased caption). The supplied is_paid flag misses most of them.
 */
const PAID_MARKERS = [
  "#ad\\M", "#ads\\M", "#advert", "^ad\\M", "\\mad\\s*$", "\\mad ?[|/:]", "[|/] ?ad\\M", "\\(ad\\)", "\\[ad\\]", "#sponsored", "\\msponsored by", "paid partnership", "#paidpartnership", "#brandpartner", "#ambassador\\M",
  "#anzeige", "\\manzeige\\M", "#werbung", "\\mwerbung\\M", "bezahlte partnerschaft", "#gesponsert", "#kooperation",
  "#publi\\M", "\\mpubli\\M", "#publicidad", "\\mpublicidad\\M", "colaboraci[oó]n pagada", "#colaboracionpagada", "#patrocinado",
  "#pub\\M", "#sponsoris", "collaboration commerciale", "partenariat r[eé]mun[eé]r[eé]", "#collaborationcommerciale",
  "#adv\\M", "\\madv\\M", "#pubblicit", "#sponsorizzato", "#reklame\\M", "#reklam\\M", "#reklama\\M", "#annons", "#annonse", "#mainos", "#spon\\M",
  "wsp[oó][lł]praca reklamowa", "#wsp[oó][lł]praca", "#samenwerking", "#advertentie", "#spolupraca", "#spoluprace", "#parceriapaga", "#διαφημιση",
].join("|");
/** Wording that says the opposite: named brands without payment. */
const NOT_PAID_MARKERS = ["unbezahlt", "unbeauftragt", "wegen verlinkung", "selbst ?gekauft", "markennennung", "not sponsored", "#notsponsored", "#notanad", "not an ad\\M", "nicht gesponsert", "keine werbung", "#keinewerbung", "no es publi", "non sponsoris"].join("|");
/**
 * Shop and commission posts: the creator sells the product through the platform's shop or an
 * affiliate programme. Nobody at the brand briefed them, but the post is not unprompted either.
 * Only clear markers: a loose tag such as #tiktokmademebuyit sits on ordinary posts too.
 */
const AFFILIATE_MARKERS = ["tiktok ?shop", "#tiktokshop", "#ttshop", "#tts[a-z]{3,}", "#shoptok", "#affiliate", "affiliate link", "\\maffiliate\\M", "#commission", "commission (paid|earned)", "eligible for commission", "earns? commission", "#ltk[a-z]*", "liketoknow\\.it", "#amazonassociate", "#amazoninfluencer", "amazon storefront", "#creatorpicks", "#spotlightfinds", "#dealsforyoudays"].join("|");
/** A product received for free, with no payment disclosed. */
const GIFTED_MARKERS = ["#gifted", "\\mgifted\\M", "#giftedby", "pr sample", "#prsample", "pr package", "#prpackage", "#prgift", "#prunboxing", "#complimentary", "#freesample", "kindly sent", "#influenster", "#trnd\\M", "#markenjury", "#theinsiders", "#produkttest", "#gratistesten", "#regalo\\M", "#offert\\M"].join("|");

/**
 * Applies the corrections to one industry's posts and comments:
 *  - disclosure: 'paid' when the model or a caption marker says so (and nothing says "unpaid"),
 *    else 'gifted' (a free product, or a giveaway run with the brand's product).
 *  - is_affiliate: a shop or commission post. is_paid: a paid disclosure in the caption, or the
 *    supplied flag (kept in is_paid_source) when the caption says nothing. is_gifted: gifted and
 *    neither of those. A post is at most one of the three.
 *  - is_owned: the post comes from one of the brand's own accounts (segments_raw.handles, from the catalog).
 *  - about: the post's "about the brand" label, so the views can leave out posts that are not.
 *  - comments: `about` and `attribute` from the comment classifier.
 *  - product and claims: the product line a post or a brand comment is about, and the benefits a
 *    caption claims (scripts/classify_products.py). Codes 0 and 1 in the file mean none and several.
 */
async function applyFlags(db: Db, industry: string, disclosure: DisclosureFile | null, comments: CommentLabelsFile | null, products: ProductLabelsFile | null) {
  const seg = `segment_id IN (SELECT id FROM segments_raw WHERE industry = $1)`;
  await db.query(`UPDATE posts_raw SET is_paid_source = coalesce(is_paid, false) WHERE is_paid_source IS NULL AND ${seg}`, [industry]);
  await db.query(`UPDATE posts_raw SET disclosure = NULL, is_gifted = false, is_owned = false, is_affiliate = false, paid_basis = NULL, about = NULL WHERE ${seg}`, [industry]);
  if (disclosure) {
    const rows = disclosure.rows.filter((r) => r[2] > 0).map(([segment_id, post_id, d]) => ({ segment_id, post_id, d: disclosure.values[d] }));
    for (let at = 0; at < rows.length; at += CHUNK) {
      await db.query(
        `UPDATE posts_raw p SET disclosure = t.d FROM jsonb_to_recordset($1::jsonb) AS t(segment_id integer, post_id bigint, d text)
          WHERE p.segment_id = t.segment_id AND p.post_id = t.post_id`,
        [JSON.stringify(rows.slice(at, at + CHUNK))],
      );
    }
  }
  await db.query(`UPDATE posts_raw SET disclosure = 'paid' WHERE ${seg} AND text IS NOT NULL AND lower(text) ~ $2`, [industry, PAID_MARKERS]);
  await db.query(`UPDATE posts_raw SET disclosure = NULL WHERE ${seg} AND disclosure = 'paid' AND lower(text) ~ $2`, [industry, NOT_PAID_MARKERS]);
  await db.query(`UPDATE posts_raw SET disclosure = 'gifted' WHERE ${seg} AND disclosure IS NULL AND text IS NOT NULL AND lower(text) ~ $2`, [industry, GIFTED_MARKERS]);
  // A giveaway or competition run with the brand's product is not unprompted, whatever the caption discloses.
  await db.query(
    `UPDATE posts_raw p SET disclosure = 'gifted' WHERE p.disclosure IS NULL AND p.segment_id IN (SELECT id FROM segments_raw WHERE industry = $1)
        AND EXISTS (SELECT 1 FROM post_labels_raw l WHERE l.segment_id = p.segment_id AND l.post_id = p.post_id AND l.kind = 'hook' AND l.label = 'Giveaway or competition')`,
    [industry],
  );
  // A shop or commission post, unless the caption carries an explicit advert marker. It overrides a model "paid" given for a link or a code.
  await db.query(
    `UPDATE posts_raw SET is_affiliate = true WHERE ${seg} AND text IS NOT NULL AND lower(text) ~ $2 AND NOT (lower(text) ~ $3 AND NOT lower(text) ~ $4)`,
    [industry, AFFILIATE_MARKERS, PAID_MARKERS, NOT_PAID_MARKERS],
  );
  // What the caption says wins over the bare flag: a flagged post whose caption says gifted is gifted, a flagged shop post is affiliate.
  await db.query(
    `UPDATE posts_raw SET
       paid_basis = CASE WHEN is_affiliate THEN NULL WHEN disclosure = 'paid' THEN 'caption' WHEN is_paid_source AND disclosure IS DISTINCT FROM 'gifted' THEN 'flag' END,
       is_paid = NOT is_affiliate AND (coalesce(disclosure = 'paid', false) OR (is_paid_source AND disclosure IS DISTINCT FROM 'gifted')),
       is_gifted = NOT is_affiliate AND coalesce(disclosure = 'gifted', false)
     WHERE ${seg}`,
    [industry],
  );
  await db.query(
    `UPDATE posts_raw p SET is_owned = true FROM segments_raw s
      WHERE s.id = p.segment_id AND s.industry = $1 AND s.handles IS NOT NULL AND jsonb_typeof(s.handles) = 'array'
        AND lower(p.username) IN (SELECT jsonb_array_elements_text(s.handles))`,
    [industry],
  );
  await db.query(
    `UPDATE posts_raw p SET about = l.label FROM post_labels_raw l
      WHERE l.kind = 'about' AND l.segment_id = p.segment_id AND l.post_id = p.post_id AND p.segment_id IN (SELECT id FROM segments_raw WHERE industry = $1)`,
    [industry],
  );
  // A comment's market is its post's: the creator's country.
  await db.query(
    `UPDATE comments_raw c SET country = p.country FROM posts_raw p
      WHERE p.segment_id = c.segment_id AND p.post_id = c.post_id AND c.country IS DISTINCT FROM p.country AND c.segment_id IN (SELECT id FROM segments_raw WHERE industry = $1)`,
    [industry],
  );
  await db.query(`UPDATE comments_raw SET about = NULL, attribute = NULL, buying = NULL WHERE ${seg} AND about IS NOT NULL`, [industry]);
  if (comments) {
    // buying: 1 or 0 from the stricter second reading; anything else (not read twice) stays NULL, so the supplied tag is used.
    const rows = comments.rows.map(([segment_id, comment_id, a, t, b]) => ({ segment_id, comment_id, about: comments.about[a], attribute: t > 0 ? comments.attributes[t] : null, buying: b === 1 ? true : b === 0 ? false : null }));
    for (let at = 0; at < rows.length; at += CHUNK) {
      await db.query(
        `UPDATE comments_raw c SET about = t.about, attribute = t.attribute, buying = t.buying FROM jsonb_to_recordset($1::jsonb) AS t(segment_id integer, comment_id bigint, about text, attribute text, buying boolean)
          WHERE c.segment_id = t.segment_id AND c.comment_id = t.comment_id`,
        [JSON.stringify(rows.slice(at, at + CHUNK))],
      );
    }
  }
  await db.query(`UPDATE posts_raw SET product = NULL, claims = NULL WHERE ${seg} AND (product IS NOT NULL OR claims IS NOT NULL)`, [industry]);
  await db.query(`UPDATE comments_raw SET product = NULL WHERE ${seg} AND product IS NOT NULL`, [industry]);
  if (products) {
    const line = (code: number) => (code >= 2 ? products.products[code] ?? null : null);
    const posts = products.posts.map(([segment_id, post_id, code, mask]) => {
      const claims = products.attributes.filter((_, i) => mask & (1 << i));
      return { segment_id, post_id, product: line(code), claims: claims.length ? claims : null };
    });
    for (let at = 0; at < posts.length; at += CHUNK) {
      await db.query(
        `UPDATE posts_raw p SET product = t.product, claims = t.claims FROM jsonb_to_recordset($1::jsonb) AS t(segment_id integer, post_id bigint, product text, claims text[])
          WHERE p.segment_id = t.segment_id AND p.post_id = t.post_id`,
        [JSON.stringify(posts.slice(at, at + CHUNK))],
      );
    }
    const rows = products.comments.map(([segment_id, comment_id, code]) => ({ segment_id, comment_id, product: line(code) })).filter((r) => r.product);
    for (let at = 0; at < rows.length; at += CHUNK) {
      await db.query(
        `UPDATE comments_raw c SET product = t.product FROM jsonb_to_recordset($1::jsonb) AS t(segment_id integer, comment_id bigint, product text)
          WHERE c.segment_id = t.segment_id AND c.comment_id = t.comment_id`,
        [JSON.stringify(rows.slice(at, at + CHUNK))],
      );
    }
  }
}
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
    const disclosure = readGz<DisclosureFile>("disclosure", ind.industry);
    const commentLabels = readGz<CommentLabelsFile>("comment_labels", ind.industry);
    const productLabels = readGz<ProductLabelsFile>("product_labels", ind.industry);
    const handles = await db.query<{ h: string }>(`SELECT md5(coalesce(string_agg(brand || ':' || coalesce(handles::text, ''), '|' ORDER BY brand), '')) AS h FROM segments_raw WHERE industry = $1`, [ind.industry]);
    const base = `${rules.hash}:${model?.hash ?? "rules"}:${ind.posts}`;
    // The corrections have their own state, so a new disclosure or comment file does not redo the labels.
    const flagsKey = `flags:${ind.industry}`;
    const flagsBase = `${base}:f8:${disclosure?.hash ?? "-"}:${commentLabels?.hash ?? "-"}:${productLabels?.hash ?? "-"}:${handles[0]?.h.slice(0, 8) ?? "-"}`;
    const applyFlagsIfNeeded = async (): Promise<boolean> => {
      // An import that re-sends posts overwrites is_paid and clears is_paid_source (imports.ts): the corrections must run again.
      const stale = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM posts_raw WHERE is_paid_source IS NULL AND segment_id IN (SELECT id FROM segments_raw WHERE industry = $1)`,
        [ind.industry],
      );
      if ((await getMeta(db, flagsKey)) === flagsBase && !stale[0]?.n) return true;
      if (spent()) return false;
      // One instance at a time: the corrections reset columns before filling them, so two runs must not
      // overlap, and a run that dies must not leave the key saying "applied". The claim expires after five minutes.
      const now = Date.now();
      const claim = await db.query<{ key: string }>(
        `INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
          WHERE app_meta.value NOT LIKE 'running:%' OR split_part(app_meta.value, ':', 2)::bigint < $3 RETURNING key`,
        [flagsKey, `running:${now}`, now - 300000],
      );
      if (!claim.length) return false;
      const t0 = Date.now();
      await applyFlags(db, ind.industry, disclosure?.file ?? null, commentLabels?.file ?? null, productLabels?.file ?? null);
      await setMeta(db, flagsKey, flagsBase);
      log(`${ind.industry}: paid, brand-owned, comment and product corrections applied in ${Date.now() - t0} ms`);
      return true;
    };
    const state = (await getMeta(db, key)) ?? "";
    if (state === `${base}|done`) {
      if (!(await applyFlagsIfNeeded())) pending++;
      continue;
    }
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
    // Last: paid, gifted and brand-owned posts, posts not about the brand, and what comments are about.
    await setMeta(db, flagsKey, "");
    if (!(await applyFlagsIfNeeded())) pending++;
    log(`${ind.industry}: ${ind.posts} posts labelled${model ? ` (model labels: ${model.file.rows.length})` : " by word rules"}`);
  }
  return { pending };
}
