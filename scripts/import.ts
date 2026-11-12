/**
 * CLI: npm run import -- <dir> [--source name] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * Reads segments, posts, comments and influencers from <dir> as <table>.json, <table>.json.gz or
 * <table>.csv (any subset) and loads them with the same code as POST /api/imports. Files use the
 * normalised column layout of data/seed (see COLUMNS in src/lib/schema.ts); raw IMAI exports go
 * through scripts/build_seed.py first. Uses DATABASE_URL when set, otherwise local PGlite.
 * Stop `next dev` first when using PGlite: the embedded database allows one process at a time.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Row } from "../src/lib/db";
import { DATASET_TABLES, importBatch, type DatasetTable } from "../src/lib/imports";

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. Returns rows keyed by header. */
export function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let field = "";
  let rec: string[] = [];
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { rec.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      rec.push(field); field = "";
      if (rec.length > 1 || rec[0] !== "") records.push(rec);
      rec = [];
    } else field += ch;
  }
  if (field !== "" || rec.length) { rec.push(field); records.push(rec); }
  const [header, ...body] = records;
  if (!header) return [];
  // Cells stay strings; importBatch coerces them per column (numbers, booleans, JSON, arrays).
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

function readTable(dir: string, table: DatasetTable): Row[] | undefined {
  for (const ext of [".json", ".json.gz", ".csv"]) {
    const file = path.join(dir, `${table}${ext}`);
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    if (ext === ".csv") return parseCsv(buf.toString("utf8"));
    const text = ext === ".json.gz" ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    const data = JSON.parse(text) as unknown;
    if (!Array.isArray(data)) throw new Error(`${file}: expected a JSON array of rows`);
    return data as Row[];
  }
  return undefined;
}

function parseArgs(argv: string[]) {
  const out: { dir?: string; source?: string; from?: string; to?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") out.source = argv[++i];
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (!a.startsWith("--")) out.dir = a;
    else throw new Error(`Unknown option ${a}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error("Usage: npm run import -- <dir> [--source name] [--from YYYY-MM-DD] [--to YYYY-MM-DD]");
    process.exit(2);
  }
  const dir = path.resolve(args.dir);
  const tables: Partial<Record<DatasetTable, Row[]>> = {};
  for (const t of DATASET_TABLES) {
    const rows = readTable(dir, t);
    if (rows) {
      tables[t] = rows;
      console.log(`${t}: ${rows.length} rows`);
    }
  }
  if (!Object.keys(tables).length) throw new Error(`No segments/posts/comments/influencers .json, .json.gz or .csv files in ${dir}`);
  const { import: rec, events } = await importBatch({ ...tables, source: args.source ?? `cli:${path.basename(dir)}`, coversFrom: args.from, coversTo: args.to });
  console.log(`Import #${rec.id} ${rec.status}: covers ${rec.covers_from} to ${rec.covers_to}`);
  console.log(`  posts +${rec.posts_added} updated ${rec.posts_updated}; comments +${rec.comments_added} updated ${rec.comments_updated}; influencers +${rec.influencers_added} updated ${rec.influencers_updated}; segments ${rec.segments_upserted}`);
  if (rec.notes) console.log(`  ${rec.notes}`);
  if (!events.length) console.log("No period events.");
  for (const e of events) console.log(`  event #${e.id} ${e.kind} ${e.summary.label}: ${e.summary.posts} posts (${e.summary.posts_delta >= 0 ? "+" : ""}${e.summary.posts_delta}), ${e.summary.comments} comments (${e.summary.comments_delta >= 0 ? "+" : ""}${e.summary.comments_delta})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
