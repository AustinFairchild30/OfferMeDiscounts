// Shared Postgres connection pool (Neon or any standard Postgres URL).
// Replaces the fs.readFileSync/writeFileSync JSON-file stores.

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to backend/.env — see backend/README.md.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;
