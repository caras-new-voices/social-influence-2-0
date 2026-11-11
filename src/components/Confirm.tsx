"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn>(async () => false);

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/** In-app replacement for window.confirm: a small modal in the workspace style. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback<ConfirmFn>((opts) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })), []);
  const value = useMemo(() => confirm, [confirm]);
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pending) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return (
    <ConfirmCtx.Provider value={value}>
      {children}
      {pending && (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="confirm__body">
              <h3 id="confirm-title" className="im-text-sub-header">{pending.title}</h3>
              {pending.message && <p className="im-text-description" style={{ marginTop: "0.35rem" }}>{pending.message}</p>}
            </div>
            <div className="modal__foot">
              <button className="im-btn im-btn-secondary" onClick={() => close(false)}>{pending.cancelLabel ?? "Cancel"}</button>
              <button ref={okRef} className={`im-btn ${pending.danger ? "im-btn-danger" : "im-btn-primary"}`} onClick={() => close(true)}>
                {pending.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}
