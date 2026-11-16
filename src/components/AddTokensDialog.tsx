"use client";
import { useEffect, useState } from "react";
import { announceUsage, formatTokens, MAX_TOP_UP, TOKEN_PACKS, type BalanceInfo } from "@/lib/usage-shared";
import { useToast } from "./Toast";

/** Demo top-up: pick a pack or type an amount. No payment is taken. */
export function AddTokensDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState<number>(TOKEN_PACKS[1]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const value = custom.trim() ? Number(custom.replace(/[,\s]/g, "")) : amount;
  const valid = Number.isFinite(value) && value > 0 && value <= MAX_TOP_UP;

  const add = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/usage/top-up", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokens: value }) });
      const j = (await r.json()) as BalanceInfo & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Could not add tokens");
      announceUsage(j.balance);
      toast(`Added ${formatTokens(value)} tokens. Balance: ${formatTokens(j.balance)}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Add tokens" style={{ width: "min(520px, 100%)" }}>
        <div className="modal__head"><h3 className="im-text-header">Add tokens</h3><button className="im-btn im-btn-ghost im-btn-sm" onClick={onClose}>Close</button></div>
        <div className="modal__body">
          <p className="im-text-description">Tokens are what the analyst uses to answer, propose elements and write reviews. Pick an amount to add to the account.</p>
          <div className="tok-packs" role="radiogroup" aria-label="Amount">
            {TOKEN_PACKS.map((p) => (
              <button key={p} className={`tok-pack ${!custom.trim() && amount === p ? "is-active" : ""}`} role="radio" aria-checked={!custom.trim() && amount === p} onClick={() => { setAmount(p); setCustom(""); }}>
                <b>{formatTokens(p)}</b><small>tokens</small>
              </button>
            ))}
          </div>
          <label><span className="im-label">Or another amount</span>
            <input className="im-input" inputMode="numeric" placeholder="For example 2,000,000" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          </label>
          {custom.trim() && !valid && <span className="im-badge im-badge-error">Enter a number between 1 and {MAX_TOP_UP.toLocaleString("en-US")}</span>}
          {error && <span className="im-badge im-badge-error">{error}</span>}
          <p className="tok-demo">Demo: no payment is taken.</p>
        </div>
        <div className="modal__foot">
          <button className="im-btn im-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="im-btn im-btn-primary" onClick={() => void add()} disabled={busy || !valid}>{busy ? "Adding…" : `Add ${valid ? formatTokens(value) : ""} tokens`}</button>
        </div>
      </div>
    </div>
  );
}
