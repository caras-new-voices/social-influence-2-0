import { getDb } from "./db";
import { ensureReady } from "./schema";
import { buildTemplate, type TemplateId } from "./templates";
import { newId, type DashboardRecord, type WidgetSpec } from "./widgets";

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

export async function createDashboard(input: { name: string; description?: string; template: TemplateId }): Promise<DashboardRecord> {
  await ensureReady();
  const db = await getDb();
  const id = newId("d");
  const widgets = buildTemplate(input.template);
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
