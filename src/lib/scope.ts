import { AsyncLocalStorage } from "node:async_hooks";
import type { Workspace } from "./brands";
import { defaultScope, normalizeScope, scopeOrDefault, workspaceFor } from "./catalog";
import { scopeBrands, type DashboardScope } from "./scope-shared";

/**
 * The brand scope of the work in progress. A request that belongs to a dashboard runs inside
 * runInScope(dashboard scope); from there every dataset read is limited to the dashboard's brands
 * (see scopeSettings and query.ts) and getWorkspace() describes those brands. Work that runs
 * outside any scope sees the default selection of the live industry.
 */
interface Store {
  scope: DashboardScope;
  workspace: Workspace;
}

const g = globalThis as unknown as { __siScopeAls?: AsyncLocalStorage<Store>; __siScopedWorkspace?: () => Workspace | undefined };
const als = (g.__siScopeAls ??= new AsyncLocalStorage<Store>());
g.__siScopedWorkspace = () => als.getStore()?.workspace;

export function runInScope<T>(scope: DashboardScope | null | undefined, fn: () => T): T {
  if (!scope) return fn();
  return als.run({ scope, workspace: workspaceFor(scope) }, fn);
}

/** Runs `fn` in a dashboard's scope (its stored selection, or the default when it has none). */
export function runForDashboard<T>(dashboard: { scope?: DashboardScope | null } | null | undefined, fn: () => T): T {
  return runInScope(scopeOrDefault(dashboard?.scope), fn);
}

/** Iterates an async generator with every step inside the scope (a generator body runs in the context of whoever calls next()). */
export async function* iterateInScope<T>(scope: DashboardScope | null | undefined, make: () => AsyncGenerator<T>): AsyncGenerator<T> {
  const it = runInScope(scope, make);
  for (;;) {
    const r = await runInScope(scope, () => it.next());
    if (r.done) return;
    yield r.value;
  }
}

export function currentScope(): DashboardScope | null {
  return als.getStore()?.scope ?? defaultScope();
}

/** Transaction-local settings that limit the dataset views to the current scope's brands. */
export function scopeSettings(): Record<string, string> {
  const scope = currentScope();
  if (!scope) return {};
  const t = scope.target;
  return {
    "app.brands": scopeBrands(scope).join("\u001f"), "app.focal_brand": scope.focal,
    // The target audience, for audience match in the creator score. Empty means not set.
    "app.target_gender": t?.gender ?? "", "app.target_ages": (t?.ages ?? []).join("\u001f"), "app.target_markets": (t?.markets ?? []).join("\u001f"),
  };
}

/** The scope a request asked for (a JSON string or an object), or the default when it is missing or not valid. Call after ensureReady(). */
export function resolveScope(input: unknown): DashboardScope | null {
  return (input ? normalizeScope(input) : null) ?? defaultScope();
}
