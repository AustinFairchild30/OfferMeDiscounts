// Removes user rows that never came from a real registration.
//
// The users table holds 8 rows and 6 of them have no registered_at at all.
// Those are the data/users.json import in migrate.js — a one-time cutover
// from the old JSON file store, carrying prototype-era records. The flow that
// creates a genuine user always stamps registered_at, so a NULL there means
// the row arrived by import rather than by anyone signing up.
//
// They matter because they are the denominator of every metric about
// subscribers. Eight "users" against zero phone submissions in six weeks
// reads as a broken funnel; two is just an honest early number.
//
// engagement_events references users(phone) ON DELETE CASCADE, so their
// engagement rows go with them. That is correct: the events describe people
// who were never real subscribers.
//
// Prints what it would delete and exits. Pass --confirm to actually delete.
// Phone numbers are shown as the last four digits only — there is no reason
// for this script to print them in full.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("./pool");

const CONFIRMED = process.argv.includes("--confirm");

function mask(phone) {
  const s = String(phone || "");
  return s.length > 4 ? `…${s.slice(-4)}` : "(none)";
}

async function run() {
  const { rows: doomed } = await pool.query(
    `SELECT u.phone, u.verified, u.opted_out,
            (SELECT count(*)::int FROM engagement_events e WHERE e.phone = u.phone) AS engagement_rows
       FROM users u
      WHERE u.registered_at IS NULL
      ORDER BY u.phone`
  );

  const { rows: keeping } = await pool.query(
    `SELECT to_char(registered_at, 'YYYY-MM-DD') AS registered, verified
       FROM users WHERE registered_at IS NOT NULL ORDER BY registered_at`
  );

  console.log(`Would delete ${doomed.length} user row(s) with no registered_at:`);
  for (const r of doomed) {
    console.log(
      `  ${mask(r.phone)}  verified=${r.verified}  opted_out=${r.opted_out}  ` +
      `engagement rows that cascade: ${r.engagement_rows}`
    );
  }

  console.log(`\nKeeping ${keeping.length} row(s) that record a real registration date:`);
  for (const r of keeping) console.log(`  registered ${r.registered}  verified=${r.verified}`);

  if (!doomed.length) {
    console.log("\nNothing to do.");
    return pool.end();
  }

  if (!CONFIRMED) {
    console.log("\nDry run. Re-run with --confirm to delete these rows.");
    return pool.end();
  }

  const { rowCount } = await pool.query("DELETE FROM users WHERE registered_at IS NULL");
  const { rows: after } = await pool.query(
    "SELECT count(*)::int AS users FROM users"
  );
  const { rows: eng } = await pool.query(
    "SELECT count(*)::int AS events FROM engagement_events"
  );
  console.log(`\nDeleted ${rowCount} user(s).`);
  console.log(`  users remaining:             ${after[0].users}`);
  console.log(`  engagement_events remaining: ${eng[0].events}`);
  await pool.end();
}

run().catch(err => {
  console.error("Failed:", err.message);
  process.exit(1);
});
