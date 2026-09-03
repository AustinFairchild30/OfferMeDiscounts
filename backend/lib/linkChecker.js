// Checks every deal's destination for a dead page — CJ's own API has no
// way to tell us when a merchant takes down the landing page a tracking
// link points to (this happened for real: a Tech For Less "MacBooks on
// sale" link kept passing CJ's own feed as active while 404ing on their
// actual site). Runs as part of the daily cron sync so this gets caught
// automatically instead of waiting for a user to report a dead link.

const pool = require("../db/pool");

const CONCURRENCY = 10;
const TIMEOUT_MS = 10000;
// Require 2 consecutive failed checks (not 1) before removing a deal —
// a single failure could just be the merchant's site having a bad moment,
// and a wrongly-deleted real deal is worse than a stale one lasting one
// extra day.
const FAILURE_THRESHOLD = 2;

async function isDead(url) {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    // Drain the body so the connection can close cleanly; we only need the status.
    await res.body?.cancel?.().catch(() => {});
    return res.status === 404 || res.status === 410;
  } catch {
    // Network error, timeout, etc. — treat the same as a dead link; a
    // consistently unreachable merchant page isn't usable either way.
    return true;
  }
}

async function runInBatches(items, worker, size) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(worker));
  }
}

async function checkAndPruneDeadLinks() {
  const { rows: deals } = await pool.query(
    "SELECT id, link, cj_link_id, link_check_failures FROM deals WHERE link IS NOT NULL"
  );

  let checked = 0;
  let removed = 0;
  const removedTitles = [];

  await runInBatches(
    deals,
    async d => {
      checked++;
      const dead = await isDead(d.link);
      if (!dead) {
        if (d.link_check_failures > 0) {
          await pool.query("UPDATE deals SET link_check_failures = 0 WHERE id = $1", [d.id]);
        }
        return;
      }

      const failures = d.link_check_failures + 1;
      if (failures >= FAILURE_THRESHOLD) {
        if (d.cj_link_id) {
          await pool.query("INSERT INTO cj_excluded_links (cj_link_id) VALUES ($1) ON CONFLICT DO NOTHING", [d.cj_link_id]);
        }
        const { rows } = await pool.query("DELETE FROM deals WHERE id = $1 RETURNING title", [d.id]);
        if (rows[0]) removedTitles.push(rows[0].title);
        removed++;
      } else {
        await pool.query("UPDATE deals SET link_check_failures = $1 WHERE id = $2", [failures, d.id]);
      }
    },
    CONCURRENCY
  );

  return { checked, removed, removedTitles };
}

module.exports = { checkAndPruneDeadLinks };
