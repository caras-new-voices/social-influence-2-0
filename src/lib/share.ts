import { randomBytes } from "node:crypto";
import { getDashboard } from "./dashboards";
import { getDb } from "./db";
import { PeriodStateSchema, type PeriodState } from "./period";
import { ensureReady } from "./schema";
import type { DashboardRecord } from "./widgets";

/**
 * Share links. A link is a random key that opens one dashboard to look at: a fixed period and
 * market, the summary or everything. The page behind it never learns the dashboard's own address,
 * and the only data it can ask for is the answer to a box that is on that dashboard, for the
 * link's period (see /api/shared/[token]/data). A link can be switched off without touching the
 * dashboard.
 */
const DDL = `CREATE TABLE IF NOT EXISTS share_links (
  token text PRIMARY KEY,
  dashboard_id text NOT NULL,
  period jsonb,
  view text NOT NULL DEFAULT 'summary',
  leader text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
)`;
const g = globalThis as unknown as { __siShareReady?: Promise<void> };
async function ensure() {
  await ensureReady();
  g.__siShareReady ??= (async () => { await (await getDb()).exec(DDL); })().catch((e) => { g.__siShareReady = undefined; throw e; });
  return g.__siShareReady;
}

export interface ShareSettings { period: PeriodState | null; view: "summary" | "full"; leader: string | null }
export type ShareLink = ShareSettings & { token: string; createdAt: string };
type LinkRow = { token: string; dashboard_id: string; period: unknown; view: string; leader: string | null; created_at: string };

function settingsOf(r: LinkRow): ShareSettings {
  const raw = typeof r.period === "string" ? JSON.parse(r.period) : r.period;
  const parsed = raw == null ? null : PeriodStateSchema.safeParse(raw);
  return { period: parsed?.success ? parsed.data : null, view: r.view === "full" ? "full" : "summary", leader: r.leader };
}
const same = (a: ShareSettings, b: ShareSettings) => JSON.stringify([a.period, a.view, a.leader]) === JSON.stringify([b.period, b.view, b.leader]);

/** A link to this view of the dashboard. Asking twice for the same view gives the same link. */
export async function createShareLink(dashboardId: string, settings: ShareSettings): Promise<ShareLink> {
  await ensure();
  const existing = (await listShareLinks(dashboardId)).find((l) => same(l, settings));
  if (existing) return existing;
  const db = await getDb();
  const token = randomBytes(24).toString("base64url");
  const [row] = await db.query<LinkRow>(
    `INSERT INTO share_links (token, dashboard_id, period, view, leader) VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING token, dashboard_id, period, view, leader, created_at`,
    [token, dashboardId, settings.period ? JSON.stringify(settings.period) : null, settings.view, settings.leader],
  );
  return { token: row.token, createdAt: new Date(row.created_at).toISOString(), ...settingsOf(row) };
}

/** The links that are switched on for a dashboard, newest first. */
export async function listShareLinks(dashboardId: string): Promise<ShareLink[]> {
  await ensure();
  const rows = await (await getDb()).query<LinkRow>(`SELECT token, dashboard_id, period, view, leader, created_at FROM share_links WHERE dashboard_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`, [dashboardId]);
  return rows.map((r) => ({ token: r.token, createdAt: new Date(r.created_at).toISOString(), ...settingsOf(r) }));
}

/** Switches a link off. It stops working at once. */
export async function revokeShareLink(dashboardId: string, token: string): Promise<void> {
  await ensure();
  await (await getDb()).query(`UPDATE share_links SET revoked_at = now() WHERE dashboard_id = $1 AND token = $2 AND revoked_at IS NULL`, [dashboardId, token]);
}

/** What a link opens: the dashboard as it is now, with the link's period and view. Null when the link is unknown or switched off. */
export async function getSharedView(token: string): Promise<{ dashboard: DashboardRecord; settings: ShareSettings } | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  await ensure();
  const [row] = await (await getDb()).query<LinkRow>(`SELECT token, dashboard_id, period, view, leader, created_at FROM share_links WHERE token = $1 AND revoked_at IS NULL`, [token]);
  if (!row) return null;
  const dashboard = await getDashboard(row.dashboard_id);
  return dashboard ? { dashboard, settings: settingsOf(row) } : null;
}
