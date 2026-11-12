/**
 * Defensive checks for SQL written by the model. The database transaction is
 * already READ ONLY with a statement timeout; this layer rejects obvious
 * non-SELECT statements early and caps the row count.
 */
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|analyze|reindex|cluster|lock|listen|notify|refresh|security|pg_sleep|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink|set_config|reset|set\s+role|set\s+session|set\s+local|set\s+transaction)\b/i;

/** Replaces string literals and quoted identifiers with placeholders so keywords inside them are not flagged. */
export function stripLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

export const MAX_ROWS = 500;

export function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function guardSql(raw: string): { ok: true; sql: string } | { ok: false; reason: string } {
  const cleaned = stripComments(raw).trim().replace(/;+\s*$/, "");
  if (!cleaned) return { ok: false, reason: "Empty query." };
  if (cleaned.includes(";")) return { ok: false, reason: "Only a single statement is allowed." };
  if (!/^(select|with)\b/i.test(cleaned)) return { ok: false, reason: "Only SELECT queries are allowed." };
  const m = stripLiterals(cleaned).match(FORBIDDEN);
  if (m) return { ok: false, reason: `Query contains a forbidden keyword: ${m[1]}.` };
  if (cleaned.length > 12000) return { ok: false, reason: "Query is too long." };
  return { ok: true, sql: cleaned };
}

/** Wrap a query so the row count is bounded regardless of what the model wrote. */
export function capRows(sql: string, limit = MAX_ROWS): string {
  return `SELECT * FROM (\n${sql}\n) AS __q LIMIT ${Math.max(1, Math.min(limit, MAX_ROWS))}`;
}
