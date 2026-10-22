// Clears an advertiser's cached category so the next sync classifies it again.
//
// resolveCategories caches one answer per advertiser and only ever re-asks
// about "Other". That is deliberate — it heals a missing answer without
// paying for a Haiku call per advertiser per sync — but it means a confident
// wrong answer is permanent. Adding a category to CATEGORY_TAGS fixes the
// next advertiser and does nothing for the ones already filed under the
// nearest thing that existed at the time.
//
// SizeGlasses is the worked example: with no Eyewear category, prescription
// glasses were classified Consumer Electronics and put in the Tech browse
// group. Adding Eyewear doesn't move them; clearing the row does.
//
// Usage:
//   node db/reclassify-advertisers.js "SizeGlasses" "Eydology"
//   node db/reclassify-advertisers.js --confirm "SizeGlasses"
//
// Matching is case-insensitive and exact on the stored advertiser name, which
// is the cleaned store name — "SizeGlasses", not "SizeGlasses (US)". Prints
// what it would clear and exits unless --confirm is passed.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("./pool");

const args = process.argv.slice(2);
const CONFIRMED = args.includes("--confirm");
const names = args.filter(a => a !== "--confirm");

async function run() {
  if (!names.length) {
    console.log("Name at least one advertiser. Current cached categories:\n");
    const { rows } = await pool.query(
      `SELECT a.advertiser, a.category, count(d.id)::int AS live_deals
         FROM advertiser_categories a
         LEFT JOIN deals d ON d.store = a.advertiser
        GROUP BY a.advertiser, a.category
        ORDER BY a.category, a.advertiser`
    );
    for (const r of rows) {
      console.log(`  ${r.advertiser.padEnd(28)} ${String(r.category).padEnd(24)} ${r.live_deals} live deal(s)`);
    }
    return pool.end();
  }

  const { rows: matched } = await pool.query(
    `SELECT advertiser, category FROM advertiser_categories
      WHERE lower(advertiser) = ANY($1::text[])`,
    [names.map(n => n.toLowerCase())]
  );

  const found = new Set(matched.map(r => r.advertiser.toLowerCase()));
  for (const n of names) {
    if (!found.has(n.toLowerCase())) console.log(`  not cached, nothing to clear: ${n}`);
  }
  if (!matched.length) {
    console.log("\nNothing to do.");
    return pool.end();
  }

  console.log(`Would clear ${matched.length} cached classification(s):`);
  for (const r of matched) console.log(`  ${r.advertiser.padEnd(28)} currently ${r.category}`);

  if (!CONFIRMED) {
    console.log("\nDry run. Re-run with --confirm, then run a sync to reclassify.");
    return pool.end();
  }

  const { rowCount } = await pool.query(
    `DELETE FROM advertiser_categories WHERE lower(advertiser) = ANY($1::text[])`,
    [names.map(n => n.toLowerCase())]
  );
  console.log(`\nCleared ${rowCount}. They will be reclassified on the next sync.`);
  await pool.end();
}

run().catch(err => {
  console.error("Failed:", err.message);
  process.exit(1);
});
