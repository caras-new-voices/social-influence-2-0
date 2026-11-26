export const dynamic = "force-dynamic";

/** The passcode form shown when the site is locked. */
export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string; wrong?: string }> }) {
  const { next, wrong } = await searchParams;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "1.5rem" }}>
      <form method="post" action="/api/unlock" className="im-card" style={{ width: "min(380px, 100%)", padding: "1.5rem", display: "grid", gap: "0.75rem" }}>
        <h1 className="im-text-header">This site is locked</h1>
        <p className="im-text-description">Enter the passcode to open the dashboards. A shared link opens without it.</p>
        <input type="hidden" name="next" value={next ?? "/"} />
        <input className="im-input" type="password" name="passcode" aria-label="Passcode" placeholder="Passcode" autoFocus required />
        {wrong && <p role="alert" style={{ color: "var(--Danger-600, #c0392b)", fontSize: 13 }}>That passcode is not right.</p>}
        <button className="im-btn im-btn-primary" type="submit">Open</button>
      </form>
    </main>
  );
}
