"use client";
import { useEffect, useState } from "react";
import { AGE_BANDS, type TargetAudience as Target } from "@/lib/scope-shared";

/**
 * The audience the brand wants to reach: gender, age bands and markets. Any part may be left
 * empty. The creator score matches each creator's audience against the parts that are set.
 */
export function TargetAudience({ value, scope, onChange }: { value: Target | null | undefined; scope: unknown; onChange: (next: Target) => void }) {
  const t: Target = value ?? {};
  const [markets, setMarkets] = useState<string[]>([]);
  const scopeJson = JSON.stringify(scope ?? null);
  useEffect(() => {
    let live = true;
    fetch(`/api/coverage?scope=${encodeURIComponent(scopeJson)}`)
      .then((r) => r.json())
      .then((c: { markets?: Array<{ country: string }> }) => { if (live) setMarkets((c.markets ?? []).slice(0, 12).map((m) => m.country)); })
      .catch(() => {});
    return () => { live = false; };
  }, [scopeJson]);
  const toggle = (list: string[] | undefined, item: string) => ((list ?? []).includes(item) ? (list ?? []).filter((x) => x !== item) : [...(list ?? []), item]);
  // Markets saved earlier stay selectable even if they are no longer among the largest.
  const marketOptions = [...new Set([...(t.markets ?? []), ...markets])];
  return (
    <section className="target" aria-label="Target audience">
      <h4 className="im-text-sub-header">Target audience</h4>
      <p className="im-text-description">Who the brand wants to reach. The creator score then counts how much of each creator&apos;s audience is inside it. Leave a part empty to ignore it.</p>
      <div className="target__row">
        <span className="im-micro-label">Gender</span>
        <select className="im-select" value={t.gender ?? ""} onChange={(e) => onChange({ ...t, gender: (e.target.value || null) as Target["gender"] })} aria-label="Target gender">
          <option value="">Any</option>
          <option value="women">Women</option>
          <option value="men">Men</option>
        </select>
      </div>
      <div className="target__row">
        <span className="im-micro-label">Ages</span>
        <div className="target__chips">
          {AGE_BANDS.map((a) => (
            <label key={a} className={`target__chip ${(t.ages ?? []).includes(a) ? "is-on" : ""}`}>
              <input type="checkbox" checked={(t.ages ?? []).includes(a)} onChange={() => onChange({ ...t, ages: toggle(t.ages, a) })} />{a === "65-" ? "65+" : a}
            </label>
          ))}
        </div>
      </div>
      <div className="target__row">
        <span className="im-micro-label">Markets</span>
        <div className="target__chips">
          {marketOptions.length === 0 && <span className="im-text-description">Loading markets…</span>}
          {marketOptions.map((m) => (
            <label key={m} className={`target__chip ${(t.markets ?? []).includes(m) ? "is-on" : ""}`}>
              <input type="checkbox" checked={(t.markets ?? []).includes(m)} onChange={() => onChange({ ...t, markets: toggle(t.markets, m) })} />{m}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
