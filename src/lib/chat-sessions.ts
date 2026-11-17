import { getDb } from "./db";
import { ensureReady } from "./schema";
import { newId } from "./widgets";

/**
 * Chat sessions: separate conversations with the analyst on one dashboard. The analyst only sees
 * the open session's messages. A session is created when its first message is sent, so an empty
 * "New chat" never fills the history.
 *
 * Kinds: "chat" (an ordinary conversation), "setup" (the note written when a template was built),
 * "element" (questions asked in the full-screen view of one element).
 */
export type SessionKind = "chat" | "setup" | "element";

export interface ChatSession {
  id: string;
  dashboardId: string;
  title: string;
  kind: SessionKind;
  widgetId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Questions asked in the session. */
  questions: number;
  /** Tokens the session's turns used. */
  tokens: number;
}

const TITLE_MAX = 60;

/** A session title from the first question: one line, cut at a word near 60 characters. */
export function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= TITLE_MAX) return one || "New chat";
  const cut = one.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

type SessionRow = {
  id: string;
  dashboard_id: string;
  title: string;
  kind: string;
  widget_id: string | null;
  created_at: string;
  updated_at: string;
  questions?: number;
  tokens?: number | string;
};

function toSession(r: SessionRow): ChatSession {
  return {
    id: r.id,
    dashboardId: r.dashboard_id,
    title: r.title,
    kind: (r.kind as SessionKind) ?? "chat",
    widgetId: r.widget_id,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    questions: Number(r.questions ?? 0),
    tokens: Number(r.tokens ?? 0),
  };
}

export async function createSession(dashboardId: string, opts: { title: string; kind?: SessionKind; widgetId?: string | null }): Promise<ChatSession> {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query<SessionRow>(
    `INSERT INTO chat_sessions (id, dashboard_id, title, kind, widget_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [newId("s"), dashboardId, titleFrom(opts.title), opts.kind ?? "chat", opts.widgetId ?? null],
  );
  return toSession(rows[0]);
}

/** The dashboard's sessions, most recently used first, with question and token counts. */
export async function listSessions(dashboardId: string): Promise<ChatSession[]> {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query<SessionRow>(
    `SELECT s.*,
            (SELECT count(*)::int FROM chat_messages m WHERE m.session_id = s.id AND m.role = 'user' AND m.content <> '') AS questions,
            (SELECT coalesce(sum((m.usage ->> 'total')::bigint), 0) FROM chat_messages m WHERE m.session_id = s.id AND m.usage IS NOT NULL) AS tokens
       FROM chat_sessions s WHERE s.dashboard_id = $1 ORDER BY s.updated_at DESC, s.created_at DESC`,
    [dashboardId],
  );
  return rows.map(toSession);
}

export async function getSession(id: string): Promise<ChatSession | null> {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query<SessionRow>(`SELECT * FROM chat_sessions WHERE id = $1`, [id]);
  return rows[0] ? toSession(rows[0]) : null;
}

/** The dashboard's setup chat with this title (guided setup writes every step into one), created when missing. */
export async function setupSession(dashboardId: string, title: string): Promise<ChatSession> {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query<SessionRow>(
    `SELECT * FROM chat_sessions WHERE dashboard_id = $1 AND kind = 'setup' AND title = $2 ORDER BY created_at LIMIT 1`,
    [dashboardId, title],
  );
  return rows[0] ? toSession(rows[0]) : createSession(dashboardId, { title, kind: "setup" });
}

/** Marks the session as just used, so it moves to the top of the history. */
export async function touchSession(id: string): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE chat_sessions SET updated_at = now() WHERE id = $1`, [id]);
}

export async function renameSession(id: string, title: string): Promise<ChatSession | null> {
  await ensureReady();
  const db = await getDb();
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) return getSession(id);
  const rows = await db.query<SessionRow>(`UPDATE chat_sessions SET title = $2 WHERE id = $1 RETURNING *`, [id, clean]);
  return rows[0] ? toSession(rows[0]) : null;
}

export async function deleteSession(id: string): Promise<void> {
  await ensureReady();
  const db = await getDb();
  await db.query(`DELETE FROM chat_messages WHERE session_id = $1`, [id]);
  await db.query(`DELETE FROM chat_sessions WHERE id = $1`, [id]);
}

/** Removes every session of a dashboard (when the dashboard is deleted). */
export async function deleteDashboardSessions(dashboardId: string): Promise<void> {
  const db = await getDb();
  await db.query(`DELETE FROM chat_messages WHERE dashboard_id = $1`, [dashboardId]);
  await db.query(`DELETE FROM chat_sessions WHERE dashboard_id = $1`, [dashboardId]);
}
