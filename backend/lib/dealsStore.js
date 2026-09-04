// Deal storage, backed by Postgres (see backend/db/schema.sql). Replaces
// the old JSON-file store (backend/data/deals.json) — same function
// names/shapes as before so routes/api.js only needed `await` added.

const pool = require("../db/pool");

const COLUMNS = "id, title, brand, store, category, discount, code, description, expires, featured, emoji, link, source, logo_domain";

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
    `INSERT INTO deals (id, title, brand, store, category, discount, code, description, expires, featured, emoji, link, logo_domain)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING ${COLUMNS}`,
    [id, payload.title, payload.brand, payload.store, payload.category, payload.discount, payload.code,
      payload.description, payload.expires, !!payload.featured, payload.emoji, payload.link || null, payload.logoDomain || null]
  );
  return rowToDeal(rows[0]);
}

async function updateDeal(id, payload) {
  const existing = await getDealById(id);
  if (!existing) return null;
  const merged = { ...existing, ...payload, id };
  const { rows } = await pool.query(
    `UPDATE deals SET title=$2, brand=$3, store=$4, category=$5, discount=$6, code=$7,
       description=$8, expires=$9, featured=$10, emoji=$11, link=$12, logo_domain=$13
     WHERE id=$1
     RETURNING ${COLUMNS}`,
    [id, merged.title, merged.brand, merged.store, merged.category, merged.discount, merged.code,
      merged.description, merged.expires, !!merged.featured, merged.emoji, merged.link || null, merged.logoDomain || merged.logo_domain || null]
  );
  return rowToDeal(rows[0]);
}

// Upserts deals pulled from CJ's Link Search API, keyed on cj_link_id so
// re-syncing updates the same rows instead of duplicating them. Manually
// added deals (source='manual') are never touched by this. emoji/featured
// are admin-curated cosmetic fields, so they're only set on first insert
// and left alone on subsequent syncs.
async function upsertCjDeals(cjDeals) {
  const { rows: excludedRows } = await pool.query("SELECT cj_link_id FROM cj_excluded_links");
  const excluded = new Set(excludedRows.map(r => r.cj_link_id));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const d of cjDeals) {
    if (excluded.has(d.cjLinkId)) {
      skipped++;
      continue;
    }
    const { rows: existingRows } = await pool.query("SELECT id FROM deals WHERE cj_link_id = $1", [d.cjLinkId]);
    if (existingRows[0]) {
      await pool.query(
        `UPDATE deals SET title=$2, brand=$3, store=$4, category=$5, discount=$6, code=$7,
           description=$8, expires=$9, link=$10, logo_domain=$11
         WHERE cj_link_id=$1`,
        [d.cjLinkId, d.title, d.brand, d.store, d.category, d.discount, d.code, d.description, d.expires, d.link, d.logoDomain]
      );
      updated++;
    } else {
      const id = await makeDealId();
      await pool.query(
        `INSERT INTO deals (id, title, brand, store, category, discount, code, description, expires, featured, emoji, link, source, cj_link_id, logo_domain)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,$11,'cj',$12,$13)`,
        [id, d.title, d.brand, d.store, d.category, d.discount, d.code, d.description, d.expires, d.emoji, d.link, d.cjLinkId, d.logoDomain]
      );
      created++;
    }
  }
  return { created, updated, skipped, total: cjDeals.length };
}

// Deleting a CJ-sourced deal also excludes its link-id, so it doesn't come
// back on the next sync — deleting is how an admin says "not a real deal"
// or "don't want this one," and a resync shouldn't silently override that.
async function removeDeal(id) {
  const existing = await getDealById(id);
  if (!existing) return false;
  if (existing.source === "cj") {
    const { rows } = await pool.query("SELECT cj_link_id FROM deals WHERE id = $1", [id]);
    const cjLinkId = rows[0]?.cj_link_id;
    if (cjLinkId) {
      await pool.query("INSERT INTO cj_excluded_links (cj_link_id) VALUES ($1) ON CONFLICT DO NOTHING", [cjLinkId]);
    }
  }
  const { rowCount } = await pool.query("DELETE FROM deals WHERE id = $1", [id]);
  return rowCount > 0;
}

// Plain delete, no cj_excluded_links entry — expiring is a normal lifecycle
// event, not a quality judgment. If the same advertiser link comes back
// with a fresh future expiration on a later sync (a renewed promotion),
// it should be free to reappear as a new row, not stay permanently
// excluded the way a curated-out or dead-linked deal does.
async function purgeExpiredDeals() {
  const { rowCount } = await pool.query("DELETE FROM deals WHERE expires < CURRENT_DATE");
  return { removed: rowCount };
}

module.exports = { readDeals, getDealById, addDeal, updateDeal, removeDeal, upsertCjDeals, purgeExpiredDeals };
