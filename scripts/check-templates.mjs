#!/usr/bin/env node
/**
 * Rotation test for dashboard templates, against a running app:
 *   npm run check:templates                      (starter, http://localhost:3000)
 *   BASE_URL=https://… IMPORT_TOKEN=… npm run check:templates -- eran
 * Each tracked brand takes a turn as the focal brand; every element runs over all time and each
 * month. Exits 1 on any failing element or any brand/category word found in the template.
 */
const base = process.env.BASE_URL ?? "http://localhost:3000";
const template = process.argv[2] ?? "starter";
const headers = process.env.IMPORT_TOKEN ? { Authorization: `Bearer ${process.env.IMPORT_TOKEN}` } : {};
const res = await fetch(`${base}/api/templates/check?template=${encodeURIComponent(template)}`, { headers });
const r = await res.json();
if (r.error) { console.error(`check failed: ${r.error}`); process.exit(1); }
console.log(`Template "${r.template}": ${r.queries} queries in ${(r.ms / 1000).toFixed(1)} s\n`);
for (const b of r.brands) {
  console.log(`${b.focal.padEnd(18)} ${String(b.elements).padStart(2)} elements, ${b.skipped.length} left out, ${b.emptyInPeriod} empty-in-period states${b.emptyAllTime.length ? `, empty over all time: ${b.emptyAllTime.join("; ")}` : ""}`);
  if (b.skipped.length) console.log(`${" ".repeat(18)} left out: ${b.skipped.join("; ")}`);
}
if (r.neutrality.length) console.log(`\nBrand or category words in the template:\n  ${r.neutrality.join("\n  ")}`);
if (r.failures.length) {
  console.log(`\n${r.failures.length} failures:`);
  for (const f of r.failures.slice(0, 40)) console.log(`  [${f.focal} · ${f.window}] ${f.element}: ${f.problem}`);
}
console.log(r.ok ? "\nPASS" : "\nFAIL");
process.exit(r.ok ? 0 : 1);
