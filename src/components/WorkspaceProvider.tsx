"use client";
import { createContext, useContext, type ReactNode } from "react";
import { setWorkspace, type Workspace } from "@/lib/brands";

const Ctx = createContext<Workspace>({ brands: [], company: null, category: null, aliases: [] });

/** Makes the workspace (tracked brands, focal brand, company, category) available to client code. */
export function WorkspaceProvider({ workspace, children }: { workspace: Workspace; children: ReactNode }) {
  // Also fill the module registry so plain functions (chart colours, template builders) see it.
  setWorkspace(workspace);
  return <Ctx.Provider value={workspace}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Workspace & { focal: string; competitors: string[] } {
  const ws = useContext(Ctx);
  return {
    ...ws,
    focal: ws.brands.find((b) => b.role === "focal")?.name ?? "our brand",
    competitors: ws.brands.filter((b) => b.role === "competitor").map((b) => b.name),
  };
}
