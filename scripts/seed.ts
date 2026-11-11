/** CLI: npm run db:seed  (uses DATABASE_URL when set, otherwise local PGlite) */
import { getDb } from "../src/lib/db";
import { seedDatabase } from "../src/lib/schema";

async function main() {
  const db = await getDb();
  console.log(`Seeding ${db.kind} database...`);
  await seedDatabase(db, (m) => console.log(m));
  const [p] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM posts");
  const [c] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM comments");
  console.log(`Done. posts=${p.n} comments=${c.n}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
