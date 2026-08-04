// User storage, backed by Postgres (see backend/db/schema.sql). Replaces
// the old JSON-file store (backend/data/users.json) — same function
// names/shapes as before so routes/api.js only needed `await` added.

const pool = require("../db/pool");

function rowToUser(userRow, engagementRows) {
  return {
    phone: userRow.phone,
    registeredAt: userRow.registered_at,
    verified: userRow.verified,
    interests: userRow.interests || [],
    favoriteBrands: userRow.favorite_brands || [],
    optedOut: !!userRow.opted_out,
    engagement: engagementRows.map(e => ({
      dealId: e.deal_id,
      category: e.category,
      smsSent: e.sms_sent,
      via: e.via || undefined,
      disliked: !!e.disliked,
      at: e.at
    }))
  };
}

async function getUser(phone) {
  const { rows } = await pool.query("SELECT * FROM users WHERE phone = $1", [phone]);
  if (!rows[0]) return null;
  const { rows: engagement } = await pool.query(
    "SELECT * FROM engagement_events WHERE phone = $1 ORDER BY at",
    [phone]
  );
  return rowToUser(rows[0], engagement);
}

async function upsertUser(phone, patch) {
  const existing = await getUser(phone);
  const merged = {
    phone,
    registeredAt: existing?.registeredAt ?? null,
    verified: existing?.verified ?? false,
    interests: existing?.interests ?? [],
    favoriteBrands: existing?.favoriteBrands ?? [],
    optedOut: existing?.optedOut ?? false,
    ...patch
  };
  await pool.query(
    `INSERT INTO users (phone, registered_at, verified, interests, favorite_brands, opted_out)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (phone) DO UPDATE SET
       registered_at = EXCLUDED.registered_at,
       verified = EXCLUDED.verified,
       interests = EXCLUDED.interests,
       favorite_brands = EXCLUDED.favorite_brands,
       opted_out = EXCLUDED.opted_out`,
    [phone, merged.registeredAt, merged.verified, JSON.stringify(merged.interests), JSON.stringify(merged.favoriteBrands), merged.optedOut]
  );
  return getUser(phone);
}

async function logEngagement(phone, entry) {
  const user = await getUser(phone);
  if (!user) return;
  await pool.query(
    `INSERT INTO engagement_events (phone, deal_id, category, sms_sent, via)
     VALUES ($1,$2,$3,$4,$5)`,
    [phone, entry.dealId, entry.category, !!entry.smsSent, entry.via || null]
  );
}

// Marks the most recent deal sent to this phone as disliked, so pickBestDeal
// can steer away from that store/category next time. Returns false if the
// user has no prior engagement to attach the feedback to.
async function markLastEngagementDisliked(phone) {
  const { rows } = await pool.query(
    `UPDATE engagement_events SET disliked = TRUE
     WHERE id = (
       SELECT id FROM engagement_events WHERE phone = $1 ORDER BY at DESC LIMIT 1
     )
     RETURNING id`,
    [phone]
  );
  return rows.length > 0;
}

module.exports = { getUser, upsertUser, logEngagement, markLastEngagementDisliked };
