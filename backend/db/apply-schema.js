// Applies schema.sql and nothing else.
//
// `npm run migrate` also seeds deals from deals.seed.json and imports users
// from data/users.json. Both are guarded by row counts, so in practice they
// skip — but the users import is the one that "already bit us once" (see the
// comment in migrate.js), and that is a poor thing to have attached to a
// routine "add a column" command. Having no safe way to apply a schema change
// is why landing_path sat uncreated while the deployed code referenced it and
// analytics silently recorded nothing.
//
// schema.sql is written to be idempotent throughout — CREATE TABLE IF NOT
// EXISTS, CREATE INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS — so this is
// safe to run repeatedly and safe to run against a database that is already
// up to date.
//
// Usage: cd backend && npm run schema

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const pool = require("./pool");

async function run() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  const before = await columns();
  await pool.query(schema);
  const after = await columns();

  const added = [...after].filter(c => !before.has(c));
  if (added.length) {
    console.log(`Schema applied. ${added.length} column(s) added:`);
    for (const c of added.sort()) console.log(`  + ${c}`);
  } else {
    console.log("Schema applied. Nothing to change — the database was already up to date.");
  }

  await pool.end();
}

// Every column in the public schema, so the script can report what it actually
// changed rather than just claiming success.
async function columns() {
  const { rows } = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'`
  );
  return new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
}

run().catch(err => {
  console.error("Could not apply the schema:", err.message);
  process.exit(1);
});
