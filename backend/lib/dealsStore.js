// Deal storage, backed by Postgres (see backend/db/schema.sql). Replaces
// the old JSON-file store (backend/data/deals.json) — same function
// names/shapes as before so routes/api.js only needed `await` added.

const pool = require("../db/pool");

const COLUMNS = "id, title, brand, store, category, discount, code, description, expires, featured, emoji";

function rowToDeal(row) {
  return {
    ...row,
    expires: row.expires instanceof Date ? row.expires.toISOString().slice(0, 10) : row.expires
  };
}

async function readDeals() {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM deals ORDER BY id`);
  return rows.map(rowToDeal);
}

async function getDealById(id) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM deals WHERE id = $1`, [id]);
  return rows[0] ? rowToDeal(rows[0]) : null;
}

async function makeDealId() {
  const { rows } = await pool.query("SELECT id FROM deals");
  const existing = new Set(rows.map(r => r.id));
  let n = rows.length + 1;
  let id = `d${String(n).padStart(3, "0")}`;
  while (existing.has(id)) {
    n += 1;
    id = `d${String(n).padStart(3, "0")}`;
  }
  return id;
}

async function addDeal(payload) {
  const id = await makeDealId();
  const { rows } = await pool.query(
    `INSERT INTO deals (id, title, brand, store, category, discount, code, description, expires, featured, emoji)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${COLUMNS}`,
    [id, payload.title, payload.brand, payload.store, payload.category, payload.discount, payload.code,
      payload.description, payload.expires, !!payload.featured, payload.emoji]
  );
  return rowToDeal(rows[0]);
}

async function updateDeal(id, payload) {
  const existing = await getDealById(id);
  if (!existing) return null;
  const merged = { ...existing, ...payload, id };
  const { rows } = await pool.query(
    `UPDATE deals SET title=$2, brand=$3, store=$4, category=$5, discount=$6, code=$7,
       description=$8, expires=$9, featured=$10, emoji=$11
     WHERE id=$1
     RETURNING ${COLUMNS}`,
    [id, merged.title, merged.brand, merged.store, merged.category, merged.discount, merged.code,
      merged.description, merged.expires, !!merged.featured, merged.emoji]
  );
  return rowToDeal(rows[0]);
}

async function removeDeal(id) {
  const { rowCount } = await pool.query("DELETE FROM deals WHERE id = $1", [id]);
  return rowCount > 0;
}

async function resetToSeed() {
  const fs = require("fs");
  const path = require("path");
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "deals.seed.json"), "utf8"));
  await pool.query("TRUNCATE deals");
  for (const d of seed) {
    await pool.query(
      `INSERT INTO deals (id, title, brand, store, category, discount, code, description, expires, featured, emoji)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [d.id, d.title, d.brand, d.store, d.category, d.discount, d.code, d.description, d.expires, !!d.featured, d.emoji]
    );
  }
  return readDeals();
}

module.exports = { readDeals, getDealById, addDeal, updateDeal, removeDeal, resetToSeed };
