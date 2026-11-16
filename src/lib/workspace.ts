import type { Workspace } from "./brands";
import { getWorkspace } from "./brands";
import { loadCatalog } from "./catalog";
import type { Db } from "./db";

/**
 * Reloads the brand catalogue from the data (industries, brands, volumes) and returns the default
 * workspace. Called after every import, because new or changed segments change the tracked brands.
 */
export async function loadWorkspace(db: Db): Promise<Workspace> {
  await loadCatalog(db);
  return getWorkspace();
}
