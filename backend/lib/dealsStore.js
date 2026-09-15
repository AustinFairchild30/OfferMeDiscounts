// Deal storage, backed by Postgres (see backend/db/schema.sql). Replaces
// the old JSON-file store (backend/data/deals.json) — same function
// names/shapes as before so routes/api.js only needed `await` added.

const pool = require("../db/pool");

const COLUMNS = "id, title, brand, store, category, discount, code, description, expires, featured, emoji, link, source, logo_domain, logo_url, updated_at, impact_ad_id";

function rowToDeal(row) {
  return {
    ...row,
    expires: row.expires instanceof Date ? row.expires.toISOString().slice(0, 10) : row.expires,
    // Camel-cased for the sitemap's lastMod derivation; the raw column stays
    // on the object too, so nothing reading row shape directly breaks.
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
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
       description=$8, expires=$9, featured=$10, emoji=$11, link=$12, logo_domain=$13,
       updated_at=now()
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
  let unchanged = 0;
  let skipped = 0;
  for (const d of cjDeals) {
    if (excluded.has(d.cjLinkId)) {
      skipped++;
      continue;
    }
    const { rows: existingRows } = await pool.query("SELECT id FROM deals WHERE cj_link_id = $1", [d.cjLinkId]);
    if (existingRows[0]) {
      // The IS DISTINCT FROM guard is the point: this sync runs daily over
      // every row, so an unconditional UPDATE would stamp updated_at with
      // today's date on the whole catalog every morning and make the
      // sitemap's lastmod meaningless. Rows whose values haven't moved
      // aren't written at all. IS DISTINCT FROM (not <>) so NULLs compare
      // correctly — a null code staying null must not read as a change.
      const { rowCount } = await pool.query(
        `UPDATE deals SET title=$2, brand=$3, store=$4, category=$5, discount=$6, code=$7,
           description=$8, expires=$9, link=$10, logo_domain=$11, updated_at=now()
         WHERE cj_link_id=$1
           AND (title, brand, store, category, discount, code, description, expires, link, logo_domain)
               IS DISTINCT FROM ($2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11)`,
        [d.cjLinkId, d.title, d.brand, d.store, d.category, d.discount, d.code, d.description, d.expires, d.link, d.logoDomain]
      );
      if (rowCount) updated++;
      else unchanged++;
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
  return { created, updated, unchanged, skipped, total: cjDeals.length };
}

// Deleting a CJ-sourced deal also excludes its link-id, so it doesn't come
// back on the next sync — deleting is how an admin says "not a real deal"
// or "don't want this one," and a resync shouldn't silently override that.
// Mirrors upsertCjDeals, including the IS DISTINCT FROM guard that keeps
// updated_at (and therefore sitemap lastmod) honest across a daily sync that
// touches every row. Keyed on impact_ad_id so the two networks never collide.
async function upsertImpactDeals(impactDeals) {
  const { rows: excludedRows } = await pool.query("SELECT impact_ad_id FROM impact_excluded_ads");
  const excluded = new Set(excludedRows.map(r => r.impact_ad_id));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const d of impactDeals) {
    if (excluded.has(d.impactAdId)) {
      skipped++;
      continue;
    }
    const { rows: existingRows } = await pool.query("SELECT id FROM deals WHERE impact_ad_id = $1", [d.impactAdId]);
    if (existingRows[0]) {
      const { rowCount } = await pool.query(
        `UPDATE deals SET title=$2, brand=$3, store=$4, category=$5, discount=$6, code=$7,
           description=$8, expires=$9, link=$10, logo_domain=$11, logo_url=$12, updated_at=now()
         WHERE impact_ad_id=$1
           AND (title, brand, store, category, discount, code, description, expires, link, logo_domain, logo_url)
               IS DISTINCT FROM ($2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12)`,
        [d.impactAdId, d.title, d.brand, d.store, d.category, d.discount, d.code, d.description, d.expires, d.link, d.logoDomain, d.logoUrl]
      );
      if (rowCount) updated++;
      else unchanged++;
    } else {
      const id = await makeDealId();
      await pool.query(
        `INSERT INTO deals (id, title, brand, store, category, discount, code, description, expires, featured, emoji, link, source, impact_ad_id, logo_domain, logo_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,$11,'impact',$12,$13,$14)`,
        [id, d.title, d.brand, d.store, d.category, d.discount, d.code, d.description, d.expires, d.emoji || null, d.link, d.impactAdId, d.logoDomain, d.logoUrl]
      );
      created++;
    }
  }
  return { created, updated, unchanged, skipped, total: impactDeals.length };
}

async function removeDeal(id) {
  const existing = await getDealById(id);
  if (!existing) return false;
  if (existing.source === "impact" && existing.impact_ad_id) {
    await pool.query(
      "INSERT INTO impact_excluded_ads (impact_ad_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [existing.impact_ad_id]
    );
  }
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

module.exports = { readDeals, getDealById, addDeal, updateDeal, removeDeal, upsertCjDeals, upsertImpactDeals, purgeExpiredDeals };
