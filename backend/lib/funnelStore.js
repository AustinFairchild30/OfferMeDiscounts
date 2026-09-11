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

async function recordEvent({ visitorId, phone, step, dealId, source, medium, campaign }) {
  const visitor = cleanId(visitorId);
  if (!visitor || !isValidStep(step)) return false;

  await pool.query(
    `INSERT INTO funnel_events (visitor_id, phone, step, deal_id, source, medium, campaign)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      visitor,
      phone || null,
      step,
      cleanId(dealId, 40),
      cleanTag(source),
      cleanTag(medium),
      cleanTag(campaign)
    ]
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

  const { rows: deals } = await pool.query(
    `SELECT f.deal_id,
            d.store,
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
