import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { makeBrands, setWorkspace, type Workspace } from "./brands";
import type { Db, Row } from "./db";
import { DashboardScopeSchema, scopeBrands, type CatalogBrand, type CatalogIndustry, type DashboardScope } from "./scope-shared";

/**
 * The catalogue: every industry in the database and the brands tracked in each, with their
 * descriptions. It is loaded from the data (industries and segments_raw, which are filled from
 * data/seed/catalog.json and the industry packs), so nothing here names a brand. A dashboard's
 * brand scope is always a choice of brands inside one industry.
 */
export interface Catalog {
  industries: CatalogIndustry[];
}

const g = globalThis as unknown as { __siCatalog?: Catalog; __siCatalogGen?: number };

export function getCatalog(): Catalog {
  return g.__siCatalog ?? { industries: [] };
}
/** Changes whenever the catalogue is reloaded; caches built from it use it as their key. */
export function catalogGeneration(): number {
  return g.__siCatalogGen ?? 0;
}
export function getIndustry(id: string | null | undefined): CatalogIndustry | undefined {
  return getCatalog().industries.find((i) => i.id === id);
}

/* ---------------------------------------------------------------- */
/* Scope                                                              */
/* ---------------------------------------------------------------- */

/** The selection offered first for an industry: the suggested brand as "us", every real brand as a competitor. */
export function defaultScope(industryId?: string | null): DashboardScope | null {
  const cat = getCatalog();
  const ind = (industryId && cat.industries.find((i) => i.id === industryId)) || cat.industries.find((i) => i.live) || cat.industries[0];
  if (!ind || !ind.brands.length) return null;
  const focal = ind.brands.find((b) => b.name === ind.suggestedFocal) ?? [...ind.brands].sort((a, b) => b.posts - a.posts)[0];
  return { industry: ind.id, focal: focal.name, competitors: ind.brands.filter((b) => b !== focal && b.kind !== "topic").map((b) => b.name) };
}

/** Validates a scope against the catalogue: unknown brands are dropped; null when the industry or the focal brand is unknown. */
export function normalizeScope(input: unknown): DashboardScope | null {
  const parsed = DashboardScopeSchema.safeParse(typeof input === "string" ? safeJson(input) : input);
  if (!parsed.success) return null;
  const ind = getIndustry(parsed.data.industry);
  if (!ind) return null;
  const names = new Set(ind.brands.map((b) => b.name));
  if (!names.has(parsed.data.focal)) return null;
  const competitors = [...new Set(parsed.data.competitors)].filter((c) => names.has(c) && c !== parsed.data.focal);
  return { industry: ind.id, focal: parsed.data.focal, competitors };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** A stored scope, or the default when a dashboard has none (dashboards created before scopes existed). */
export function scopeOrDefault(stored: unknown): DashboardScope | null {
  return normalizeScope(stored) ?? defaultScope();
}

/** The brand context a scope gives the app: coloured brands, who is "us", the company and the category. */
export function workspaceFor(scope: DashboardScope | null): Workspace {
  const ind = scope ? getIndustry(scope.industry) : undefined;
  if (!scope || !ind) return { brands: [], company: null, category: null, aliases: [], industry: null, scope: null, hasComments: false };
  const wanted = new Set(scopeBrands(scope));
  const rows = ind.brands.filter((b) => wanted.has(b.name));
  const focal = rows.find((b) => b.name === scope.focal);
  return {
    brands: makeBrands(rows.map((b) => ({ id: b.segmentId, brand: b.name, role: b.name === scope.focal ? "focal" : "competitor", posts: b.posts }))),
    company: focal?.owner ?? null,
    category: ind.category,
    aliases: focal?.aliases ?? [],
    industry: { id: ind.id, name: ind.name, live: ind.live },
    scope,
    hasComments: rows.some((b) => b.comments > 0),
  };
}

/* ---------------------------------------------------------------- */
/* Loading the catalogue from the database                            */
/* ---------------------------------------------------------------- */

const num = (v: unknown) => Number(v ?? 0) || 0;

function parseAliases(v: unknown): string[] {
  const a = typeof v === "string" ? safeJson(v) : v;
  return Array.isArray(a) ? a.map(String) : [];
}

/** Reads industries and brands into the registry and sets the default workspace. Called at start, after packs load and after imports. */
export async function loadCatalog(db: Db): Promise<Catalog> {
  const inds = await db.query<Row>(`SELECT id, name, category, region, summary, suggested_focal, pack FROM industries ORDER BY sort, id`);
  const segs = await db.query<Row>(
    `SELECT s.id, s.brand, s.role, s.industry, s.description, s.owner, s.kind, s.aliases, s.source_posts,
            coalesce(p.n, 0)::int AS posts, coalesce(c.n, 0)::int AS comments
       FROM segments_raw s
       LEFT JOIN (SELECT segment_id, count(*) AS n FROM posts_raw GROUP BY 1) p ON p.segment_id = s.id
       LEFT JOIN (SELECT segment_id, count(*) AS n FROM comments_raw GROUP BY 1) c ON c.segment_id = s.id
      WHERE s.brand IS NOT NULL ORDER BY s.id`,
  );
  const months = await db.query<Row>(
    `SELECT s.industry, to_char(date_trunc('month', p.published_at), 'YYYY-MM') AS month FROM posts_raw p JOIN segments_raw s ON s.id = p.segment_id
      WHERE p.published_at IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  // An industry whose pack is still loading is not offered yet.
  const packs = await db.query<Row>(`SELECT key, value FROM app_meta WHERE key LIKE 'pack:%'`);
  const loadedPacks = new Set(packs.filter((r) => String(r.value).endsWith(":done")).map((r) => String(r.key).slice(5)));
  // A database without a catalogue file still works: its brands form one unnamed industry.
  const all: Row[] = inds.length ? inds : [{ id: "workspace", name: "Workspace", category: null, region: null, summary: null, suggested_focal: null, pack: null }];
  const list = all.filter((i) => !i.pack || loadedPacks.has(String(i.id)));
  const fallback = String((all.find((i) => !i.pack) ?? all[0]).id);
  const industries: CatalogIndustry[] = list.map((i) => {
    const id = String(i.id);
    const rows = segs.filter((s) => (s.industry ? String(s.industry) : fallback) === id);
    const brands: CatalogBrand[] = rows
      .map((s) => ({
        segmentId: num(s.id),
        name: String(s.brand),
        industry: id,
        description: (s.description as string | null) ?? null,
        owner: (s.owner as string | null) ?? null,
        kind: (s.kind as string | null) ?? null,
        aliases: parseAliases(s.aliases),
        posts: num(s.posts),
        comments: num(s.comments),
        sourcePosts: s.source_posts == null ? null : num(s.source_posts),
      }))
      .filter((b) => b.posts > 0 || !i.pack);
    const roleFocal = rows.find((s) => s.role === "focal");
    return {
      id,
      name: String(i.name),
      category: (i.category as string | null) ?? null,
      region: (i.region as string | null) ?? null,
      summary: (i.summary as string | null) ?? null,
      suggestedFocal: (i.suggested_focal as string | null) ?? (roleFocal ? String(roleFocal.brand) : null),
      live: !i.pack,
      brands,
      posts: brands.reduce((n, b) => n + b.posts, 0),
      comments: brands.reduce((n, b) => n + b.comments, 0),
      months: months.filter((m) => (m.industry ? String(m.industry) : fallback) === id).map((m) => String(m.month)),
    };
  });
  const catalog: Catalog = { industries: industries.filter((i) => i.brands.length > 0) };
  g.__siCatalog = catalog;
  g.__siCatalogGen = (g.__siCatalogGen ?? 0) + 1;
  setWorkspace(workspaceFor(defaultScope()));
  return catalog;
}

/* ---------------------------------------------------------------- */
/* Catalogue file and industry packs                                  */
/* ---------------------------------------------------------------- */

interface CatalogFile {
  version?: number;
  industries: Array<{
    id: string;
    name: string;
    category?: string;
    region?: string;
    summary?: string;
    suggestedFocal?: string;
    pack?: string | null;
    brands: Array<{ name: string; description?: string; owner?: string; kind?: string; aliases?: string[]; handles?: string[] }>;
  }>;
}
interface PackFile {
  id: string;
  segments: Array<{ id: number; brand: string; exported?: number; kept?: number }>;
  posts: Row[];
  influencers: Row[];
}

function seedDir() {
  return process.env.SEED_DIR ?? path.join(process.cwd(), "data", "seed");
}

function readCatalogFile(): { file: CatalogFile; hash: string } | null {
  const p = path.join(seedDir(), "catalog.json");
  if (!fs.existsSync(p)) return null;
  try {
    const buf = fs.readFileSync(p);
    return { file: JSON.parse(buf.toString("utf8")) as CatalogFile, hash: crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16) };
  } catch (e) {
    console.error("[catalog] could not read catalog.json:", (e as Error).message);
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

/**
 * Copies data/seed/catalog.json into the database when the file changed: the industries, and each
 * brand's description, owner, kind and aliases. Brands with no industry belong to the live one.
 */
export async function syncCatalog(db: Db) {
  const cat = readCatalogFile();
  if (!cat) return;
  if ((await getMeta(db, "catalog_hash")) === cat.hash) return;
  let sort = 0;
  for (const ind of cat.file.industries) {
    await db.query(
      `INSERT INTO industries (id, name, category, region, summary, suggested_focal, pack, sort) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, region = EXCLUDED.region, summary = EXCLUDED.summary,
         suggested_focal = EXCLUDED.suggested_focal, pack = EXCLUDED.pack, sort = EXCLUDED.sort`,
      [ind.id, ind.name, ind.category ?? null, ind.region ?? null, ind.summary ?? null, ind.suggestedFocal ?? null, ind.pack ?? null, sort++],
    );
    for (const b of ind.brands) {
      await db.query(
        `UPDATE segments_raw SET industry = $1, description = $3, owner = $4, kind = $5, aliases = $6::jsonb, handles = $8::jsonb
          WHERE brand = $2 AND (industry = $1 OR ($7::boolean AND industry IS NULL))`,
        [ind.id, b.name, b.description ?? null, b.owner ?? null, b.kind ?? null, JSON.stringify(b.aliases ?? []), !ind.pack, JSON.stringify(b.handles ?? [])],
      );
    }
  }
  const live = cat.file.industries.find((i) => !i.pack);
  if (live) await db.query(`UPDATE segments_raw SET industry = $1 WHERE industry IS NULL`, [live.id]);
  await setMeta(db, "catalog_hash", cat.hash);
}

const POST_TYPES: Array<[string, string]> = [
  ["post_id", "bigint"], ["segment_id", "integer"], ["brand", "text"], ["influencer_id", "bigint"], ["username", "text"], ["platform", "text"],
  ["post_type", "text"], ["url", "text"], ["text", "text"], ["published_at", "timestamptz"], ["likes", "double precision"],
  ["comments", "double precision"], ["shares", "double precision"], ["views", "double precision"], ["saves", "double precision"],
  ["engagement", "double precision"], ["is_paid", "boolean"], ["tier", "text"], ["country", "text"], ["language", "text"], ["followers", "double precision"],
];
const INFLUENCER_TYPES: Array<[string, string]> = [
  ["segment_id", "integer"], ["brand", "text"], ["influencer_id", "bigint"], ["username", "text"], ["fullname", "text"], ["network", "text"],
  ["url", "text"], ["followers", "double precision"], ["country", "text"], ["has_report", "boolean"],
];
const CHUNK = 2000;

/** One statement per chunk: the rows travel as a single JSON parameter. */
async function insertJson(db: Db, table: string, types: Array<[string, string]>, rows: Row[]) {
  const cols = types.map(([c]) => `"${c}"`).join(", ");
  const def = types.map(([c, t]) => `"${c}" ${t}`).join(", ");
  await db.query(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM jsonb_to_recordset($1::jsonb) AS t(${def}) ON CONFLICT DO NOTHING`, [JSON.stringify(rows)]);
}

/**
 * Loads the industry packs (data/seed/packs/<id>.json.gz) that are not in the database yet, or
 * whose file changed. Works in chunks and stops when `budgetMs` is spent, recording how far it
 * got in app_meta so the next call continues from there. Returns how many packs are still pending.
 */
export async function loadPacks(db: Db, budgetMs: number, log: (m: string) => void = () => {}): Promise<{ pending: number; loaded: boolean }> {
  const cat = readCatalogFile();
  if (!cat) return { pending: 0, loaded: false };
  const started = Date.now();
  const spent = () => Date.now() - started > budgetMs;
  let pending = 0;
  let loaded = false;
  for (const ind of cat.file.industries) {
    if (!ind.pack) continue;
    const file = path.join(seedDir(), "packs", `${ind.pack}.json.gz`);
    if (!fs.existsSync(file)) continue;
    const key = `pack:${ind.id}`;
    const state = await getMeta(db, key);
    const buf = fs.readFileSync(file);
    const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
    if (state === `${hash}:done`) continue;
    if (spent()) {
      pending++;
      continue;
    }
    const pack = JSON.parse(zlib.gunzipSync(buf).toString("utf8")) as PackFile;
    const ids = pack.segments.map((s) => Number(s.id));
    let [h, table, offset] = (state ?? "").split(":");
    if (h !== hash) {
      // New pack or a rebuilt one: start clean so rows from an older build cannot linger.
      await db.query(`DELETE FROM posts_raw WHERE segment_id = ANY($1::int[])`, [ids]);
      await db.query(`DELETE FROM influencers_raw WHERE segment_id = ANY($1::int[])`, [ids]);
      const byName = new Map(ind.brands.map((b) => [b.name, b]));
      for (const s of pack.segments) {
        const b = byName.get(s.brand);
        await db.query(
          `INSERT INTO segments_raw (id, name, brand, role, industry, description, owner, kind, aliases, source_posts, handles) VALUES ($1, $2, $2, 'competitor', $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, brand = EXCLUDED.brand, industry = EXCLUDED.industry, description = EXCLUDED.description,
             owner = EXCLUDED.owner, kind = EXCLUDED.kind, aliases = EXCLUDED.aliases, source_posts = EXCLUDED.source_posts, handles = EXCLUDED.handles`,
          [s.id, s.brand, ind.id, b?.description ?? null, b?.owner ?? null, b?.kind ?? null, JSON.stringify(b?.aliases ?? []), s.exported ?? null, JSON.stringify(b?.handles ?? [])],
        );
      }
      h = hash;
      table = "posts";
      offset = "0";
      await setMeta(db, key, `${hash}:posts:0`);
    }
    let stopped = false;
    for (const [name, physical, types, rows] of [
      ["posts", "posts_raw", POST_TYPES, pack.posts],
      ["influencers", "influencers_raw", INFLUENCER_TYPES, pack.influencers],
    ] as const) {
      if (table === "influencers" && name === "posts") continue;
      let at = table === name ? Number(offset) || 0 : 0;
      while (at < rows.length) {
        if (spent()) {
          stopped = true;
          break;
        }
        await insertJson(db, physical, types as Array<[string, string]>, rows.slice(at, at + CHUNK) as Row[]);
        at += CHUNK;
        await setMeta(db, key, `${hash}:${name}:${at}`);
      }
      if (stopped) break;
      table = name === "posts" ? "influencers" : "done";
      offset = "0";
    }
    if (stopped) {
      pending++;
      log(`${ind.id}: paused, continues on the next request`);
      continue;
    }
    await setMeta(db, key, `${hash}:done`);
    loaded = true;
    log(`${ind.id}: ${pack.posts.length} posts, ${pack.influencers.length} creators loaded`);
  }
  return { pending, loaded };
}
