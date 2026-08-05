// One-time migration: creates the schema (if missing) and imports the
// existing JSON-file data (deals.seed.json + data/users.json) into
// Postgres. Safe to re-run — deals/users are upserted by primary key.
//
// Usage: node backend/db/migrate.js

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const pool = require("./pool");

const SEED_DEALS_PATH = path.join(__dirname, "..", "data", "deals.seed.json");
const USERS_PATH = path.join(__dirname, "..", "data", "users.json");

async function run() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Schema ready.");

  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM deals");
  if (rows[0].n === 0) {
    const deals = JSON.parse(fs.readFileSync(SEED_DEALS_PATH, "utf8"));
    for (const d of deals) {
      await pool.query(
        `INSERT INTO deals (id, title, brand, store, category, discount, code, description, expires, featured, emoji)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [d.id, d.title, d.brand, d.store, d.category, d.discount, d.code, d.description, d.expires, !!d.featured, d.emoji]
      );
    }
    console.log(`Seeded ${deals.length} deals.`);
  } else {
    console.log(`Deals table already has ${rows[0].n} rows, skipping seed.`);
  }

  const { rows: userRows } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (userRows[0].n === 0 && fs.existsSync(USERS_PATH)) {
    // Only runs against a genuinely empty users table — this was a one-time
    // cutover step from the old JSON-file store. Postgres has been the real
    // system of record since, so re-running this on every migrate (e.g. for
    // routine schema changes) would silently overwrite live interests/
    // engagement history with this stale snapshot and duplicate every
    // engagement row on each run. It already bit us once.
    const raw = fs.readFileSync(USERS_PATH, "utf8").trim();
    const users = raw ? JSON.parse(raw) : {};
    for (const [phone, u] of Object.entries(users)) {
      await pool.query(
        `INSERT INTO users (phone, registered_at, verified, interests)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (phone) DO UPDATE SET registered_at = EXCLUDED.registered_at, verified = EXCLUDED.verified, interests = EXCLUDED.interests`,
        [phone, u.registeredAt, !!u.verified, JSON.stringify(u.interests || [])]
      );
      for (const e of u.engagement || []) {
        await pool.query(
          `INSERT INTO engagement_events (phone, deal_id, category, sms_sent, via, at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [phone, e.dealId, e.category, !!e.smsSent, e.via || null, e.at]
        );
      }
    }
    console.log(`Imported ${Object.keys(users).length} user(s) from users.json.`);
  } else if (fs.existsSync(USERS_PATH)) {
    console.log("Users table already has data, skipping users.json import.");
  }

  await pool.end();
  console.log("Migration complete.");
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
