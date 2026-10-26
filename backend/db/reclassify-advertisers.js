// Clears an advertiser's cached category so the next sync classifies it
// again, or pins one outright.
//
// resolveCategories caches one answer per advertiser and only ever re-asks
// about "Other". That is deliberate — it heals a missing answer without
// paying for a Haiku call per advertiser per sync — but it means a confident
// wrong answer is permanent. Adding a category to CATEGORY_TAGS fixes the
// next advertiser and does nothing for the ones already filed under the
// nearest thing that existed at the time.
//
// SizeGlasses is the worked example for clearing: with no Eyewear category,
// prescription glasses were classified Consumer Electronics and landed in
// the Tech browse group. Adding Eyewear doesn't move them; clearing the row
// does, because the next classification picks from a better menu.
//
// Triple Bristle is the worked example for pinning, and the reason --set
// exists. It is a sonic toothbrush whose only offer reads "Take 10% off your
// entire order", so the classifier sees the words "Triple Bristle" and
// nothing else, and answers Hair Care — wrong, but entirely reasonable from
// those inputs. Clearing the row asks the same question and gets the same
// answer. --set writes the category directly, and because resolveCategories
// skips any cached non-"Other" value, it stays put.
//
// Usage:
//   node db/reclassify-advertisers.js                        # list what's cached
//   node db/reclassify-advertisers.js "SizeGlasses"          # dry run
//   node db/reclassify-advertisers.js --confirm "SizeGlasses"
//   node db/reclassify-advertisers.js --set "Bath & Body" --confirm "Triple Bristle"
//
// Matching is case-insensitive and exact on the stored advertiser name, which
// is the cleaned store name — "SizeGlasses", not "SizeGlasses (US)". Prints
// what it would do and exits unless --confirm is passed.
//
// A pin is a manual override that never self-corrects, so it is the escape
// hatch and not the habit: use it for stores the classifier cannot read, and
// prefer clearing everywhere else. Lean on it too often and the category map
// becomes hand-maintained and drifts from what the networks actually send.
// Pins are stored with source = 'manual' so the listing can tell them apart
// from the classifier's own answers.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("./pool");
const { CATEGORY_TAGS, groupForCategory } = require("../lib/categoryTags");

// The classifier's own menu. A category off this list is not a stricter
// version of the same thing — it is a category nothing else in the codebase
// knows about.
const ALLOWED = Object.keys(CATEGORY_TAGS);

// Unknown flags are errors, not advertiser names. The previous version built
// its name list with args.filter(a => a !== "--confirm"), so any other flag
// fell straight through and was treated as a store to clear: running --set
// before it existed meant "clear Triple Bristle", with the category argument
// dropped on the floor and nothing said about it.
function parseArgs(argv) {
  const names = [];
  let confirmed = false;
  let setCategory = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirm") {
      confirmed = true;
    } else if (arg === "--set") {
      setCategory = argv[++i];
      if (setCategory === undefined || setCategory.startsWith("--")) {
        throw new Error('--set needs a category, e.g. --set "Bath & Body"');
      }
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      names.push(arg);
    }
  }
  return { names, confirmed, setCategory };
}

// groupForCategory falls back to "More" for anything it has no group for, and
// More has no browse page — so an unrecognised category would not fail, it
// would quietly strand this advertiser's deals outside browse entirely. That
// is the Pets failure again: a category present in one map, absent from
// another, unreachable by construction. Checking here turns a typo into a
// message instead of a silent hole.
function resolveCategoryName(category) {
  if (ALLOWED.includes(category)) return category;

  const cased = ALLOWED.find(c => c.toLowerCase() === category.toLowerCase());
  if (cased) {
    throw new Error(`Category is spelled "${cased}" — case has to match exactly.`);
  }
  throw new Error(
    `"${category}" is not on the classifier's menu, so nothing would group it.\n` +
    `Valid categories:\n${ALLOWED.map(c => `  ${c.padEnd(26)} → ${groupForCategory(c)}`).join("\n")}`
  );
}

async function list() {
  console.log("Name at least one advertiser. Current cached categories:\n");
  const { rows } = await pool.query(
    `SELECT a.advertiser, a.category, a.source, count(d.id)::int AS live_deals
       FROM advertiser_categories a
       LEFT JOIN deals d ON d.store = a.advertiser
      GROUP BY a.advertiser, a.category, a.source
      ORDER BY a.category, a.advertiser`
  );
  for (const r of rows) {
    const pinned = r.source === "manual" ? "  (pinned)" : "";
    console.log(
      `  ${r.advertiser.padEnd(28)} ${String(r.category).padEnd(24)} ` +
      `${String(groupForCategory(r.category)).padEnd(18)} ${r.live_deals} live deal(s)${pinned}`
    );
  }
}

async function pin(names, category, confirmed) {
  const { rows: current } = await pool.query(
    `SELECT advertiser, category, source FROM advertiser_categories
      WHERE lower(advertiser) = ANY($1::text[])`,
    [names.map(n => n.toLowerCase())]
  );
  const existing = new Map(current.map(r => [r.advertiser.toLowerCase(), r]));

  console.log(`Would pin ${names.length} advertiser(s) to ${category} (${groupForCategory(category)}):`);
  for (const n of names) {
    const row = existing.get(n.toLowerCase());
    // An advertiser with no cached row is still worth pinning: it fixes the
    // answer before the first sync ever asks for one.
    const from = row ? `currently ${row.category}${row.source === "manual" ? " (pinned)" : ""}` : "not cached yet";
    console.log(`  ${n.padEnd(28)} ${from} → ${category}`);
  }

  if (!confirmed) {
    console.log("\nDry run. Re-run with --confirm, then run a sync to pick it up.");
    return;
  }

  // Pinning an advertiser that was never cached inserts the row, so the name
  // is written as given rather than taken from an existing row.
  for (const n of names) {
    const row = existing.get(n.toLowerCase());
    await pool.query(
      `INSERT INTO advertiser_categories (advertiser, category, source, decided_at)
       VALUES ($1, $2, 'manual', now())
       ON CONFLICT (advertiser) DO UPDATE
         SET category = EXCLUDED.category, source = 'manual', decided_at = now()`,
      [row ? row.advertiser : n, category]
    );
  }
  console.log(`\nPinned ${names.length} advertiser(s) to ${category}. Run a sync to apply it to their deals.`);
}

async function clear(names, confirmed) {
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
    return;
  }

  console.log(`Would clear ${matched.length} cached classification(s):`);
  for (const r of matched) console.log(`  ${r.advertiser.padEnd(28)} currently ${r.category}`);

  if (!confirmed) {
    console.log("\nDry run. Re-run with --confirm, then run a sync to reclassify.");
    return;
  }

  const { rowCount } = await pool.query(
    `DELETE FROM advertiser_categories WHERE lower(advertiser) = ANY($1::text[])`,
    [names.map(n => n.toLowerCase())]
  );
  console.log(`\nCleared ${rowCount}. They will be reclassified on the next sync.`);
}

async function run() {
  const { names, confirmed, setCategory } = parseArgs(process.argv.slice(2));

  if (!names.length) {
    await list();
  } else if (setCategory !== null) {
    await pin(names, resolveCategoryName(setCategory), confirmed);
  } else {
    await clear(names, confirmed);
  }

  await pool.end();
}

run().catch(err => {
  console.error("Failed:", err.message);
  process.exit(1);
});
