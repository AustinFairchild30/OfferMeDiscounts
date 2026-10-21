const pool = require("../db/pool");

// The only steps the public endpoint will record. An allowlist rather than
// free text, because /api/track has to be open to anonymous visitors — the
// whole point is measuring people who haven't registered — so it's the one
// write path a stranger can reach without a phone number or a password.
// Without this, that's an open pipe into the database.
const STEPS = [
  "page_view",      // landed on the site
  "deal_view",      // opened a deal's detail modal
  "phone_submit",   // entered a number and asked for a code
  "otp_verified",   // proved the number was theirs
  "code_revealed",  // reached the payoff
  "code_copied",    // took the coupon code
  "outbound_click"  // clicked through to the retailer — the affiliate event
];

// The order above is also the funnel's order, which report() relies on.
const FUNNEL_ORDER = STEPS.filter(s => s !== "code_copied" && s !== "outbound_click");

function isValidStep(step) {
  return STEPS.includes(step);
}

// Visitor ids are generated in the browser, so treat them as untrusted input:
// bound the length and character set rather than storing whatever arrives.
function cleanId(value, max = 64) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : null;
}

// UTM values are typed by hand into an ad platform, usually by more than one
// person over the life of a campaign, so "Performance_TV", "performance_tv"
// and "performance tv " all turn up meaning the same thing. Stored verbatim
// they become three separate rows in the campaign report and each one shows a
// third of the real number. Folding case and spaces here keeps a tagging slip
// from quietly splitting a campaign's results.
function cleanTag(value, max = 120) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_").slice(0, max);
  return normalized || null;
}

// The page the event happened on, which for a visitor's first event is the
// page search sent them to. Deliberately path only: the query string is
// attacker-controlled free text on an endpoint open to anonymous visitors,
// and on this site it also carries deal ids, so storing it would put
// arbitrary input and a little PII surface into the analytics table for no
// analytical gain. A path that doesn't look like one of ours is dropped
// rather than stored.
function cleanPath(value, max = 200) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().split(/[?#]/)[0].slice(0, max);
  if (!trimmed.startsWith("/")) return null;
  return /^[A-Za-z0-9/._-]+$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

// Whether the database has caught up with this file yet. Postgres answers
// 42703 (undefined_column) when it hasn't, and the alternative to handling
// that is what actually happened: the deploy shipped before the migration,
// every INSERT threw, /api/track swallows errors by design so the browser
// never notices, and the result is analytics silently recording nothing while
// looking perfectly healthy. The same ordering bit us once before, on
// deals.awin_promotion_id, where it crashed the server instead — louder, and
// in hindsight preferable.
//
// So: try the full insert, and on a missing column fall back rather than
// losing the event — then try again a few minutes later.
//
// The retry is the part worth keeping. The first version latched off until
// the process restarted, on the reasoning that a migration arrives with a
// deploy. It doesn't always: the column was created by hand against a running
// server, and the flag stayed off for hours afterwards, so every event
// recorded a null path against a database that could by then store one. A
// latch that never re-checks turns a temporary condition into a permanent one
// and says nothing while it does.
const MISSING_COLUMN = "42703";
const RECHECK_AFTER_MS = 5 * 60 * 1000;
let landingPathUnavailableSince = null;

function shouldTryLandingPath() {
  if (landingPathUnavailableSince === null) return true;
  return Date.now() - landingPathUnavailableSince >= RECHECK_AFTER_MS;
}

async function recordEvent({ visitorId, phone, step, dealId, source, medium, campaign, landingPath }) {
  const visitor = cleanId(visitorId);
  if (!visitor || !isValidStep(step)) return false;

  const base = [
    visitor,
    phone || null,
    step,
    cleanId(dealId, 40),
    cleanTag(source),
    cleanTag(medium),
    cleanTag(campaign)
  ];

  if (shouldTryLandingPath()) {
    try {
      await pool.query(
        `INSERT INTO funnel_events (visitor_id, phone, step, deal_id, source, medium, campaign, landing_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        base.concat([cleanPath(landingPath)])
      );
      if (landingPathUnavailableSince !== null) {
        landingPathUnavailableSince = null;
        console.log("funnel_events.landing_path is available again; recording landing pages.");
      }
      return true;
    } catch (err) {
      if (err.code !== MISSING_COLUMN) throw err;
      if (landingPathUnavailableSince === null) {
        console.warn(
          "funnel_events.landing_path is missing — run `npm run schema`. " +
          "Recording events without the landing page, and re-checking every " +
          `${RECHECK_AFTER_MS / 60000} minutes.`
        );
      }
      landingPathUnavailableSince = Date.now();
    }
  }

  await pool.query(
    `INSERT INTO funnel_events (visitor_id, phone, step, deal_id, source, medium, campaign)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    base
  );
  return true;
}

// Ties a visitor's earlier anonymous events to the number they just verified,
// so their whole session reads as one attributable journey instead of a pile
// of anonymous steps plus an unexplained registration.
async function attachPhoneToVisitor(visitorId, phone) {
  const visitor = cleanId(visitorId);
  if (!visitor || !phone) return;
  await pool.query(
    "UPDATE funnel_events SET phone = $2 WHERE visitor_id = $1 AND phone IS NULL",
    [visitor, phone]
  );
}

// Counts DISTINCT visitors per step, not raw events: someone who opens six
// deals is one visitor who reached deal_view, and counting events would make
// the funnel look wider at the middle than at the top.
async function report(days = 30) {
  const { rows: stepRows } = await pool.query(
    `SELECT step, count(DISTINCT visitor_id)::int AS visitors, count(*)::int AS events
       FROM funnel_events
      WHERE at >= now() - ($1 || ' days')::interval
      GROUP BY step`,
    [String(days)]
  );
  const byStep = Object.fromEntries(stepRows.map(r => [r.step, r]));

  const top = byStep.page_view?.visitors || 0;
  const funnel = FUNNEL_ORDER.map((step, i) => {
    const visitors = byStep[step]?.visitors || 0;
    const prev = i === 0 ? visitors : byStep[FUNNEL_ORDER[i - 1]]?.visitors || 0;
    return {
      step,
      visitors,
      ofTop: top ? Math.round((visitors / top) * 1000) / 10 : 0,
      ofPrevious: prev ? Math.round((visitors / prev) * 1000) / 10 : 0
    };
  });

  // Attribute each visitor once, to their FIRST event's campaign, rather than
  // grouping events. Grouping events puts a visitor in every campaign row any
  // of their events happened to carry, so the visitor column summed to more
  // than the real audience (17 across three rows for 10 people in testing) —
  // which would in turn inflate the denominator of every CPA calculation this
  // table exists to support.
  const { rows: campaigns } = await pool.query(
    `WITH windowed AS (
       SELECT * FROM funnel_events WHERE at >= now() - ($1 || ' days')::interval
     ),
     first_touch AS (
       SELECT DISTINCT ON (visitor_id)
              visitor_id,
              coalesce(source, 'direct') AS source,
              medium,
              campaign
         FROM windowed
        ORDER BY visitor_id, at ASC, id ASC
     ),
     converted AS (
       SELECT DISTINCT visitor_id FROM windowed WHERE phone IS NOT NULL
     ),
     clicks AS (
       SELECT visitor_id, count(*)::int AS n
         FROM windowed WHERE step = 'outbound_click' GROUP BY visitor_id
     )
     SELECT f.source,
            f.medium,
            f.campaign,
            count(*)::int AS visitors,
            count(*) FILTER (WHERE c.visitor_id IS NOT NULL)::int AS registered,
            coalesce(sum(k.n), 0)::int AS outbound_clicks
       FROM first_touch f
       LEFT JOIN converted c ON c.visitor_id = f.visitor_id
       LEFT JOIN clicks k ON k.visitor_id = f.visitor_id
      GROUP BY f.source, f.medium, f.campaign
      ORDER BY visitors DESC
      LIMIT 25`,
    [String(days)]
  );

  // Which page each visitor arrived on, taken from their first event the same
  // way the campaign table is, and for the same reason: a visitor who lands on
  // /tech-deals and then browses the homepage arrived once, from search.
  //
  // This is the table that answers whether the SEO work is landing. Store and
  // category pages exist to be entry points, so the number that matters is
  // how many sessions START on one, not how many pages got viewed.
  // Same guard as recordEvent, for the same reason: without it a missing
  // column takes down the entire funnel report — campaigns, deals and all —
  // over the one table that happens to be new.
  const landingPages = await (async () => {
    try {
      const { rows } = await pool.query(
    `WITH windowed AS (
       SELECT * FROM funnel_events
        WHERE at >= now() - ($1 || ' days')::interval
          AND landing_path IS NOT NULL
     ),
     first_touch AS (
       SELECT DISTINCT ON (visitor_id) visitor_id, landing_path, coalesce(source, 'direct') AS source
         FROM windowed
        ORDER BY visitor_id, at ASC, id ASC
     ),
     engaged AS (
       SELECT DISTINCT visitor_id FROM windowed WHERE step <> 'page_view'
     )
     SELECT f.landing_path,
            count(*)::int AS visitors,
            count(*) FILTER (WHERE e.visitor_id IS NOT NULL)::int AS went_further
       FROM first_touch f
       LEFT JOIN engaged e ON e.visitor_id = f.visitor_id
      GROUP BY f.landing_path
      ORDER BY visitors DESC
      LIMIT 30`,
        [String(days)]
      );
      return rows;
    } catch (err) {
      if (err.code !== MISSING_COLUMN) throw err;
      return [];
    }
  })();

  const { rows: deals } = await pool.query(
    `SELECT f.deal_id,
            -- A deal deleted since the event (expired, curated out, or caught
            -- by the advertiser blocklist) leaves the join null, which shows
            -- as a blank row in the report rather than telling you which deal
            -- it was.
            coalesce(d.store, '(deleted deal ' || f.deal_id || ')') AS store,
            d.discount,
            count(*) FILTER (WHERE f.step = 'deal_view')::int AS views,
            count(*) FILTER (WHERE f.step = 'code_copied')::int AS copies,
            count(*) FILTER (WHERE f.step = 'outbound_click')::int AS clicks
       FROM funnel_events f
       LEFT JOIN deals d ON d.id = f.deal_id
      WHERE f.deal_id IS NOT NULL
        AND f.at >= now() - ($1 || ' days')::interval
      GROUP BY f.deal_id, d.store, d.discount
      ORDER BY views DESC
      LIMIT 25`,
    [String(days)]
  );

  return {
    days,
    funnel,
    outboundClicks: byStep.outbound_click?.events || 0,
    codeCopies: byStep.code_copied?.events || 0,
    campaigns,
    landingPages,
    deals
  };
}

// Kept alongside the funnel rather than in its own module: it answers the
// same question from the other end — the funnel says where people leave,
// this says what they couldn't find.
// Deliberately not cleanTag: that folds spaces into underscores, which is
// right for a utm value and wrong for a sentence someone typed. Lowercasing
// still earns its place — it groups "Coffee" with "coffee" in the report.
function cleanQuery(value, max = 120) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, max);
  return normalized || null;
}

async function recordSearch(query, resultCount, mode) {
  const text = cleanQuery(query, 120);
  if (!text) return;
  await pool.query(
    "INSERT INTO search_queries (query, result_count, mode) VALUES ($1,$2,$3)",
    [text, Number(resultCount) || 0, cleanTag(mode, 20)]
  );
}

// Splits deliberately on whether we had anything: the misses are the list to
// act on, the hits just confirm the catalog is pulling its weight.
async function searchReport(days = 30) {
  const { rows: misses } = await pool.query(
    `SELECT query, count(*)::int AS times, max(at) AS last_seen
       FROM search_queries
      WHERE result_count = 0 AND at >= now() - ($1 || ' days')::interval
      GROUP BY query ORDER BY times DESC, last_seen DESC LIMIT 25`,
    [String(days)]
  );
  const { rows: hits } = await pool.query(
    `SELECT query, count(*)::int AS times, round(avg(result_count))::int AS avg_results
       FROM search_queries
      WHERE result_count > 0 AND at >= now() - ($1 || ' days')::interval
      GROUP BY query ORDER BY times DESC LIMIT 25`,
    [String(days)]
  );
  const { rows: totals } = await pool.query(
    `SELECT count(*)::int AS searches,
            count(*) FILTER (WHERE result_count = 0)::int AS empty
       FROM search_queries WHERE at >= now() - ($1 || ' days')::interval`,
    [String(days)]
  );
  return { misses, hits, ...totals[0] };
}

module.exports = { recordEvent, attachPhoneToVisitor, report, recordSearch, searchReport, STEPS };
