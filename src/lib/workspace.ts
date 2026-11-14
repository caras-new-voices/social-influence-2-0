import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db";
import { makeBrands, setWorkspace, type Workspace } from "./brands";

/**
 * Loads the workspace configuration from the data: the tracked brands and which one is focal come
 * from the segments table; company, category and aliases come from app_meta (seeded from
 * data/seed/workspace.json when present). Called by ensureReady and after every import.
 */
export async function loadWorkspace(db: Db): Promise<Workspace> {
  const rows = await db.query<{ id: number; brand: string; role: string | null; posts: number }>(
    `SELECT s.id, s.brand, s.role, (SELECT count(*) FROM posts_all p WHERE p.segment_id = s.id)::int AS posts FROM segments s WHERE s.brand IS NOT NULL`,
  );
  const meta = await db.query<{ key: string; value: string }>(`SELECT key, value FROM app_meta WHERE key LIKE 'workspace_%'`);
  const m = new Map(meta.map((r) => [r.key, r.value]));
  let aliases: string[] = [];
  try {
    const parsed = JSON.parse(m.get("workspace_aliases") ?? "[]") as unknown;
    if (Array.isArray(parsed)) aliases = parsed.map(String);
  } catch {
    /* ignore a malformed alias list */
  }
  const ws: Workspace = {
    brands: makeBrands(rows.map((r) => ({ id: Number(r.id), brand: String(r.brand), role: r.role, posts: Number(r.posts) }))),
    company: m.get("workspace_company") || null,
    category: m.get("workspace_category") || null,
    aliases,
  };
  setWorkspace(ws);
  return ws;
}

/** Copies data/seed/workspace.json into app_meta for keys that are not set yet. */
export async function seedWorkspaceMeta(db: Db) {
  const file = path.join(process.env.SEED_DIR ?? path.join(process.cwd(), "data", "seed"), "workspace.json");
  if (!fs.existsSync(file)) return;
  let cfg: { company?: string; category?: string; aliases?: string[] };
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return;
  }
  const entries: Array<[string, string]> = [];
  if (cfg.company) entries.push(["workspace_company", cfg.company]);
  if (cfg.category) entries.push(["workspace_category", cfg.category]);
  if (Array.isArray(cfg.aliases)) entries.push(["workspace_aliases", JSON.stringify(cfg.aliases)]);
  for (const [k, v] of entries) await db.query(`INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [k, v]);
}
