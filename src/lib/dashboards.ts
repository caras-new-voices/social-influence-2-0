import { getDb } from "./db";
import { ensureReady } from "./schema";
import { DEFAULT_WIDGETS, newId, type DashboardRecord, type WidgetSpec } from "./widgets";

function rowToRecord(r: Record<string, unknown>): DashboardRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    widgets: (typeof r.widgets === "string" ? JSON.parse(r.widgets) : r.widgets) as WidgetSpec[],
    created_at: new Date(r.created_at as string).toISOString(),
    updated_at: new Date(r.updated_at as string).toISOString(),
  };
}

export async function listDashboards(): Promise<DashboardRecord[]> {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query(`SELECT * FROM dashboards ORDER BY updated_at DESC`);
  return rows.map(rowToRecord);
}

export async function getDashboard(id: string): Promise<DashboardRecord | null> {
  await ensureReady();
  const db = await getDb();
  const rows = await db.query(`SELECT * FROM dashboards WHERE id = $1`, [id]);
  return rows[0] ? rowToRecord(rows[0]) : null;
}

/** Lays the default catalog out as a sensible starting grid. */
export function buildDefaultWidgets(): WidgetSpec[] {
  const out: WidgetSpec[] = [];
  let y = 0;
  const place = (idx: number, x: number, w: number, h: number, yy: number) => {
    const d = DEFAULT_WIDGETS[idx];
    out.push({ ...d, id: newId(), layout: { x, y: yy, w, h } });
  };
  const section = (title: string) => {
    out.push({ id: newId(), type: "section", title, layout: { x: 0, y, w: 12, h: 1 } });
    y += 1;
  };
  section("Overview");
  place(0, 0, 12, 3, y); y += 3;
  place(1, 0, 5, 5, y); place(2, 5, 7, 5, y); y += 5;
  section("What audiences say");
  place(3, 0, 6, 5, y); place(4, 6, 6, 5, y); y += 5;
  place(5, 0, 6, 5, y); place(6, 6, 6, 5, y); y += 5;
  section("Creators and markets");
  place(7, 0, 6, 5, y); place(8, 6, 6, 5, y); y += 5;
  place(9, 0, 12, 6, y); y += 6;
  section("Risk and strategy");
  place(10, 0, 6, 5, y); place(11, 6, 6, 5, y); y += 5;
  return out;
}

export async function createDashboard(input: { name: string; description?: string; template: "default" | "blank" }): Promise<DashboardRecord> {
  await ensureReady();
  const db = await getDb();
  const id = newId("d");
  const widgets = input.template === "default" ? buildDefaultWidgets() : [];
  const rows = await db.query(
    `INSERT INTO dashboards (id, name, description, widgets) VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
    [id, input.name, input.description ?? null, JSON.stringify(widgets)],
  );
  return rowToRecord(rows[0]);
}

export async function updateDashboard(
  id: string,
  patch: { name?: string; description?: string | null; widgets?: WidgetSpec[] },
): Promise<DashboardRecord | null> {
  await ensureReady();
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    params.push(patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description);
    sets.push(`description = $${params.length}`);
  }
  if (patch.widgets !== undefined) {
    params.push(JSON.stringify(patch.widgets));
    sets.push(`widgets = $${params.length}::jsonb`);
  }
  if (!sets.length) return getDashboard(id);
  params.push(id);
  const rows = await db.query(
    `UPDATE dashboards SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] ? rowToRecord(rows[0]) : null;
}

export async function deleteDashboard(id: string): Promise<void> {
  await ensureReady();
  const db = await getDb();
  await db.query(`DELETE FROM chat_messages WHERE dashboard_id = $1`, [id]);
  await db.query(`DELETE FROM dashboards WHERE id = $1`, [id]);
}

export async function duplicateDashboard(id: string): Promise<DashboardRecord | null> {
  const src = await getDashboard(id);
  if (!src) return null;
  const db = await getDb();
  const copyId = newId("d");
  const widgets = src.widgets.map((w) => ({ ...w, id: newId() }));
  const rows = await db.query(
    `INSERT INTO dashboards (id, name, description, widgets) VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
    [copyId, `${src.name} (copy)`, src.description, JSON.stringify(widgets)],
  );
  return rowToRecord(rows[0]);
}
