/**
 * The passcode gate. When SITE_PASSCODE is set, every page and address of the site except share
 * links asks for it once and remembers the browser with a cookie (see src/proxy.ts). Without it
 * the site is open, as a proof of concept with no sign-in is.
 */
export const GATE_COOKIE = "si_gate";

export function sitePasscode(): string | null {
  return process.env.SITE_PASSCODE?.trim() || null;
}
export function siteLocked(): boolean {
  return !!sitePasscode();
}

/** What the cookie holds for a passcode: a hash, so the passcode itself is never stored in the browser. */
export async function gateValue(passcode: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`si-gate:${passcode}`));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Addresses that stay open when the site is locked: share links and the data behind them, the
 * unlock form, and the machine addresses that have their own token check (imports, cron) or say
 * nothing private (status).
 */
export function openPath(path: string): boolean {
  return path === "/unlock" || path === "/api/unlock" || path.startsWith("/shared/") || path.startsWith("/api/shared/")
    || path.startsWith("/api/cron/") || path === "/api/imports" || path === "/api/status";
}
