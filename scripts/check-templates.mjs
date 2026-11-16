#!/usr/bin/env node
/**
 * Rotation test for dashboard templates, against a running app:
 *   npm run check:templates                      (starter, http://localhost:3000)
 *   BASE_URL=https://… IMPORT_TOKEN=… npm run check:templates -- eran
 *   npm run check:templates -- starter spirits   (one industry)
 * In every industry each brand takes a turn as "us"; every element runs over all time and each
 * month. Exits 1 on any failing element or any brand/category word found in the template.
 */
const base = process.env.BASE_URL ?? "http://localhost:3000";
const template = process.argv[2] ?? "starter";
const industry = process.argv[3];
const headers = process.env.IMPORT_TOKEN ? { Authorization: `Bearer ${process.env.IMPORT_TOKEN}` } : {};
const res = await fetch(`${base}/api/templates/check?template=${encodeURIComponent(template)}${industry ? `&industry=${encodeURIComponent(industry)}` : ""}`, { headers });
const r = await res.json();
if (r.error) { console.error(`check failed: ${r.error}`); process.exit(1); }
console.log(`Template "${r.template}": ${r.brands.length} brands, ${r.queries} queries in ${(r.ms / 1000).toFixed(1)} s`);
let last = "";
for (const b of r.brands) {
  if (b.industry !== last) { last = b.industry; console.log(`\n${b.industry}`); }
  console.log(`  ${b.focal.padEnd(26)} ${String(b.posts).padStart(5)} posts  ${String(b.elements).padStart(2)} elements, ${b.skipped.length} left out, ${b.emptyInPeriod} empty-in-period states${b.emptyAllTime.length ? `, empty over all time: ${b.emptyAllTime.join("; ")}` : ""}`);
}
const left = new Map();
for (const b of r.brands) for (const s of b.skipped) left.set(s, (left.get(s) ?? 0) + 1);
if (left.size) console.log(`\nLeft out (brands affected):\n${[...left].map(([s, n]) => `  ${String(n).padStart(3)}  ${s}`).join("\n")}`);
if (r.neutrality.length) console.log(`\nBrand or category words in the template:\n  ${r.neutrality.join("\n  ")}`);
if (r.failures.length) {
  console.log(`\n${r.failures.length} failures:`);
  for (const f of r.failures.slice(0, 60)) console.log(`  [${f.industry} · ${f.focal} · ${f.window}] ${f.element}: ${f.problem}`);
}
console.log(r.ok ? "\nPASS" : "\nFAIL");
process.exit(r.ok ? 0 : 1);
