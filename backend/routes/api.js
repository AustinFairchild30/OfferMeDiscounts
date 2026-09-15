// API routes implementing the "week 1 core loop" from the project plan:
//   1. User taps "Text Me the Code" on the site -> POST /api/register
//   2. User enters the code they received -> POST /api/confirm
//   3. (Alternate entry point) user texts the Twilio number directly ->
//      POST /api/sms-inbound (Twilio webhook)

const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const twilio = require("twilio");
const { sendVerificationCode, checkVerificationCode, sendSms } = require("../lib/twilioClient");
const { pickBestDeal, writeSmsCopy, parseInboundIntent, scoreDealsForUser } = require("../lib/claudeClient");
const { readDeals, getDealById, addDeal, updateDeal, removeDeal, upsertCjDeals, upsertImpactDeals, purgeExpiredDeals } = require("../lib/dealsStore");
const { fetchCjDeals } = require("../lib/cjClient");
const { fetchImpactDeals, resolveCategories } = require("../lib/impactClient");
const { CATEGORY_TAGS, CATEGORY_LABELS, CATEGORY_GROUPS } = require("../lib/categoryTags");
const { checkAndPruneDeadLinks } = require("../lib/linkChecker");
const { getUser, getAllUsers, upsertUser, logEngagement, markLastEngagementDisliked, markLastEngagementCopied } = require("../lib/userStore");
const { recordEvent, attachPhoneToVisitor, report: funnelReport, recordSearch, searchReport } = require("../lib/funnelStore");
const { searchDeals, MAX_QUERY_LENGTH } = require("../lib/dealSearch");
const { COOKIE_NAME, SESSION_TTL_MS, createSessionToken, checkPassword, requireAdmin, requireCronSecret } = require("../lib/adminAuth");

const router = express.Router();

const rateLimitedJson = (req, res) => {
  res.status(429).json({ success: false, error: "Too many requests. Please wait a bit and try again." });
};

// Render's requests to this app pass through Cloudflare in front of
// Render's own proxy — two hops, not the one `trust proxy` accounts for.
// Guessing a hop count left req.ip resolving inconsistently (verified live:
// the same caller got a different "remaining" count on every request).
// Cloudflare's CF-Connecting-IP header is its own authoritative, non-spoofable
// record of the real client IP, so prefer it over hop-counting entirely.
// Falls back to req.ip for local dev, where there's no Cloudflare in front.
function clientIp(req) {
  const cfIp = req.headers["cf-connecting-ip"];
  return cfIp ? ipKeyGenerator(cfIp) : ipKeyGenerator(req.ip);
}

// Real Twilio Verify sends cost money per call, so /api/register is the
// main abuse target: an attacker could either burn through your Twilio
// balance by spamming many numbers, or harass one specific number with
// repeated verification texts. Two independent limiters cover both.
const registerIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  handler: rateLimitedJson
});
const registerPhoneLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => toE164(req.body?.phone) || clientIp(req),
  handler: rateLimitedJson
});

// Defense-in-depth against OTP brute-forcing — Twilio Verify already
// locks a verification after too many wrong attempts, but this also
// keeps someone from just hammering our own endpoint.
const confirmIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  handler: rateLimitedJson
});

// No lockout previously existed on admin password attempts.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  handler: rateLimitedJson
});

// /api/track is open to anonymous visitors by design, so it needs its own
// ceiling. Generous, because one ordinary session legitimately fires a
// handful of events, but bounded so a script can't use it to inflate the
// numbers the launch will be judged on or just fill the table.
const trackLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  handler: rateLimitedJson
});

// Unlike every other public endpoint, a search costs real money: each one is
// an Anthropic call. Without a ceiling this is the cheapest way for someone
// to run up the API bill, so it gets a tighter limit than /api/track, which
// only costs a row.
const searchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  handler: rateLimitedJson
});

router.post("/admin/login", adminLoginLimiter, (req, res) => {
  if (!checkPassword(req.body?.password)) {
    return res.status(401).json({ success: false, error: "Incorrect password." });
  }
  res.cookie(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    maxAge: SESSION_TTL_MS
  });
  res.json({ success: true });
});

router.post("/admin/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

// Deliberately loose. Real address validation is delivery, not a regex, and
// a strict pattern mostly rejects valid addresses; this only catches obvious
// nonsense so the column doesn't fill with junk.
function isPlausibleEmail(value) {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(value);
}

function toE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(raw).trim().startsWith("+")) return String(raw).trim();
  return null;
}

router.get("/deals", async (req, res) => {
  res.json(await readDeals());
});

// Source of truth for the preference survey's fine-grained sub-tags per
// category — see backend/lib/categoryTags.js for why this is shared with
// the personalized-scoring match logic instead of a separate client copy.
router.get("/category-tags", (req, res) => {
  res.json(CATEGORY_TAGS);
});

// Natural-language deal search. Returns ids in relevance order rather than
// deal objects — the browser already has the catalog from GET /api/deals, so
// sending it back would double the payload for nothing.
router.post("/deals/search", searchLimiter, async (req, res) => {
  const query = String(req.body?.query || "").trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) return res.json({ success: true, dealIds: [], mode: "all" });

  try {
    const today = new Date().toISOString().slice(0, 10);
    // Search only what the grid can actually show, or it would return ids
    // the front-end then silently drops, making the count disagree.
    const deals = (await readDeals()).filter(d => d.discount && d.expires >= today);
    const { deals: matched, mode } = await searchDeals(deals, query);

    // Fire-and-forget: what people search for is worth keeping, but not at
    // the cost of making them wait for the answer.
    recordSearch(query, matched.length, mode).catch(err =>
      console.error("Search logging error:", err.message)
    );

    res.json({ success: true, dealIds: matched.map(d => d.id), mode });
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ success: false, error: "Search is unavailable right now." });
  }
});

router.get("/admin/searches", requireAdmin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  try {
    res.json({ success: true, report: await searchReport(days) });
  } catch (err) {
    console.error("Search report error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Display-side taxonomy: what to call a category, and which browse group it
// belongs to. Served separately from /category-tags rather than folded into
// it, so a browser holding a cached copy of the old app.js doesn't lose the
// survey's sub-tags while it waits to pick up the new one.
router.get("/taxonomy", (req, res) => {
  res.json({ labels: CATEGORY_LABELS, groups: CATEGORY_GROUPS });
});

// Lets the browse grid put a returning, verified visitor's best-matching
// deals first instead of a purely anonymous shuffle — phone in the POST
// body (not a query string) per the same pattern as /api/preferences and
// /api/track-copy. No rate limit: read-only, no SMS/OTP cost.
router.post("/deals/personalized-order", async (req, res) => {
  const phone = toE164(req.body.phone);
  if (!phone) return res.status(400).json({ success: false, error: "Missing phone." });
  const user = await getUser(phone);
  const deals = await readDeals();
  const scores = scoreDealsForUser(user, deals);
  res.json({ success: true, scores });
});

// When a new deal matches something a user explicitly told us they like
// (a favorite brand/store), text them right away instead of waiting for
// them to come back and ask. Deliberately conservative: only an explicit
// favorite match qualifies, not a broad category interest, since "we
// texted you about every Electronics deal" would wear out its welcome
// fast. Failures for one user don't stop the rest.
async function notifyMatchingUsers(deal) {
  let users;
  try {
    users = await getAllUsers();
  } catch (err) {
    console.error("notifyMatchingUsers: could not load users:", err.message);
    return 0;
  }

  const store = (deal.store || "").toLowerCase();
  const brand = (deal.brand || "").toLowerCase();
  let notified = 0;

  for (const user of users) {
    if (!user.verified || user.optedOut) continue;
    const isMatch = (user.favoriteBrands || []).some(fav => {
      const f = fav.toLowerCase().trim();
      if (!f) return false;
      return store.includes(f) || f.includes(store) || (brand && (brand.includes(f) || f.includes(brand)));
    });
    if (!isMatch) continue;

    try {
      const smsText = await writeSmsCopy(user, deal);
      await sendSms(user.phone, smsText);
      await logEngagement(user.phone, { dealId: deal.id, category: deal.category, smsSent: true, via: "new_deal_alert" });
      notified++;
    } catch (err) {
      console.warn(`notifyMatchingUsers: alert failed for ${user.phone}:`, err.message);
    }
  }

  return notified;
}

// Admin CRUD — backs admin.html's add/edit/delete instead of localStorage.
// Protected: requires a valid admin session (see /admin/login above).
router.post("/deals", requireAdmin, async (req, res) => {
  const payload = req.body || {};
  if (!payload.title || !payload.store || !payload.expires) {
    return res.status(400).json({ success: false, error: "Title, store, and expiration date are required." });
  }
  if (!payload.code && !payload.link) {
    return res.status(400).json({ success: false, error: "A coupon code, a tracking link, or both are required." });
  }
  const deal = await addDeal(payload);
  const notified = await notifyMatchingUsers(deal);
  res.json({ success: true, deal, notified });
});

router.put("/deals/:id", requireAdmin, async (req, res) => {
  const deal = await updateDeal(req.params.id, req.body || {});
  if (!deal) return res.status(404).json({ success: false, error: "Deal not found." });
  res.json({ success: true, deal });
});

router.delete("/deals/:id", requireAdmin, async (req, res) => {
  const removed = await removeDeal(req.params.id);
  if (!removed) return res.status(404).json({ success: false, error: "Deal not found." });
  res.json({ success: true });
});

// One network failing must not take the other down with it — they're
// independent sources and a bad token or an outage on one side shouldn't
// stop the catalog refreshing from the other.
async function runImpactSync() {
  if (!process.env.IMPACT_ACCOUNT_SID || !process.env.IMPACT_AUTH_TOKEN) {
    return { skipped: "not configured" };
  }
  try {
    const deals = await resolveCategories(await fetchImpactDeals());
    return await upsertImpactDeals(deals);
  } catch (err) {
    console.error("Impact sync error:", err.message);
    return { error: err.message };
  }
}

async function runCjSync(res) {
  try {
    const cjDeals = await fetchCjDeals();
    const result = await upsertCjDeals(cjDeals);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("CJ sync error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

router.post("/deals/sync-cj", requireAdmin, async (req, res) => {
  await runCjSync(res);
});

router.post("/deals/sync-impact", requireAdmin, async (req, res) => {
  const result = await runImpactSync();
  res.json({ success: !result.error, ...result });
});

// Same sync, plus a dead-link sweep, triggered by a scheduled job instead
// of the admin dashboard — see .github/workflows/sync-cj.yml. The link
// check can take a while (network round-trips to every merchant site), so
// it only runs here, not on the admin button, which should stay snappy.
router.post("/cron/sync-cj", requireCronSecret, async (req, res) => {
  try {
    const cjDeals = await fetchCjDeals();
    const syncResult = await upsertCjDeals(cjDeals);
    const impactResult = await runImpactSync();
    // Link checking runs after both syncs so newly-arrived deals from either
    // network are covered by the same sweep.
    const linkCheckResult = await checkAndPruneDeadLinks();
    const expiredResult = await purgeExpiredDeals();
    res.json({ success: true, ...syncResult, impact: impactResult, linkCheck: linkCheckResult, expired: expiredResult });
  } catch (err) {
    console.error("Cron sync error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Impact serves each brand's real logo, but only to an authenticated caller,
// so the browser can't request it directly. This holds the credentials and
// caches aggressively: brand logos change roughly never, they're tiny (under
// 10KB, all of them), and the alternative — Hunter.io — silently returns a
// placeholder for brands it doesn't know, which is how SoccerGarage's logo
// vanished between two sessions.
//
// Cached in memory rather than in Postgres: the whole working set is a few
// hundred KB, and a long Cache-Control means Cloudflare and the browser
// absorb nearly all of the traffic anyway.
const LOGO_CACHE = new Map();
const LOGO_TTL_MS = 24 * 60 * 60 * 1000;
const LOGO_CACHE_MAX = 200;

router.get("/logo/impact/:campaignId", async (req, res) => {
  const id = String(req.params.campaignId || "");
  // Campaign ids are numeric; anything else is someone probing, and this
  // value goes into an outbound URL.
  if (!/^\d{1,12}$/.test(id)) return res.status(404).end();

  const cached = LOGO_CACHE.get(id);
  if (cached && Date.now() - cached.at < LOGO_TTL_MS) {
    res.set("Content-Type", cached.type);
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(cached.body);
  }

  const sid = process.env.IMPACT_ACCOUNT_SID;
  const token = process.env.IMPACT_AUTH_TOKEN;
  if (!sid || !token) return res.status(404).end();

  try {
    const upstream = await fetch(`https://api.impact.com/Mediapartners/${sid}/Campaigns/${id}/Logo`, {
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") },
      signal: AbortSignal.timeout(8000)
    });
    if (!upstream.ok) return res.status(404).end();

    const type = upstream.headers.get("content-type") || "image/png";
    // Refuse anything that isn't an image — an error page rendered into an
    // <img> is worse than no logo, because the frontend's fallback never fires.
    if (!type.startsWith("image/")) return res.status(404).end();

    const body = Buffer.from(await upstream.arrayBuffer());
    if (LOGO_CACHE.size >= LOGO_CACHE_MAX) LOGO_CACHE.delete(LOGO_CACHE.keys().next().value);
    LOGO_CACHE.set(id, { body, type, at: Date.now() });

    res.set("Content-Type", type);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(body);
  } catch (err) {
    // 404 rather than 500: the frontend treats a failed image as "no logo"
    // and falls back to the emoji, which is the right outcome either way.
    console.error("Logo proxy error:", err.message);
    res.status(404).end();
  }
});

router.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Records one funnel step. Fire-and-forget from the browser, so it always
// answers 200 and never blocks or surfaces an error to the visitor —
// analytics failing is not a reason for the site to misbehave. Invalid steps
// and malformed visitor ids are dropped silently by funnelStore.
router.post("/track", trackLimiter, async (req, res) => {
  try {
    await recordEvent({
      visitorId: req.body?.visitorId,
      phone: toE164(req.body?.phone) || null,
      step: req.body?.step,
      dealId: req.body?.dealId,
      source: req.body?.source,
      medium: req.body?.medium,
      campaign: req.body?.campaign
    });
  } catch (err) {
    console.error("Track error:", err.message);
  }
  res.json({ ok: true });
});

router.get("/admin/funnel", requireAdmin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  try {
    res.json({ success: true, report: await funnelReport(days) });
  } catch (err) {
    console.error("Funnel report error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Saves a user's declared category interests (one-time preference survey
// shown right after their first OTP confirmation) so pickBestDeal/writeSmsCopy
// in claudeClient.js can actually personalize future deal picks/copy.
router.post("/preferences", async (req, res) => {
  const phone = toE164(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: "Missing phone." });
  }
  // This route now serves two different callers (the survey step, and the
  // reveal-step consent checkbox), each sending a different subset of
  // fields — so every field is independently optional and only touched
  // when actually present, instead of defaulting absent ones to empty/
  // false and silently wiping out what the other caller already saved.
  const patch = {};
  if (Array.isArray(req.body.interests)) {
    patch.interests = req.body.interests.filter(x => typeof x === "string");
  }
  if (Array.isArray(req.body.favoriteBrands)) {
    patch.favoriteBrands = req.body.favoriteBrands.filter(x => typeof x === "string" && x.trim()).map(x => x.trim());
  }
  if (typeof req.body.marketingConsent === "boolean") {
    patch.optedOut = !req.body.marketingConsent;
  }
  // Optional throughout. An empty string clears a previously saved address
  // (so someone can take it back), but an unparseable one is dropped rather
  // than rejected — this arrives alongside the preferences someone just
  // filled in, and failing the whole save over a typo'd address would lose
  // the survey answers too, which are the more valuable half.
  if (typeof req.body.email === "string") {
    const email = req.body.email.trim().slice(0, 254);
    if (!email) patch.email = null;
    else if (isPlausibleEmail(email)) patch.email = email.toLowerCase();
  }
  await upsertUser(phone, patch);
  res.json({ success: true });
});

// Fired when a user clicks "Copy code" on the reveal step — a real
// intent-to-redeem signal, not just "we sent it." Best-effort: the
// front end doesn't wait on this before copying to the clipboard.
router.post("/track-copy", async (req, res) => {
  const phone = toE164(req.body.phone);
  const { dealId } = req.body;
  if (!phone || !dealId) {
    return res.status(400).json({ success: false, error: "Missing phone or dealId." });
  }
  const marked = await markLastEngagementCopied(phone, dealId);
  res.json({ success: true, marked });
});

// Step 1: web visitor requests a code for a specific deal.
router.post("/register", registerIpLimiter, registerPhoneLimiter, async (req, res) => {
  const phone = toE164(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: "Enter a valid 10-digit US phone number." });
  }

  try {
    await sendVerificationCode(phone);
    const existing = await getUser(phone);
    if (existing) {
      await upsertUser(phone, {}); // ensure a record exists (no-op for existing state)
    } else {
      // First time we've seen this number. Recurring marketing texts must be
      // an active opt-in, not a default — Twilio rejection 30505 ("Agreeing
      // to Receive Messages Must Be Optional") — so only mark them opted in
      // if they checked the consent box. The OTP verification text itself
      // isn't a marketing message and is sent either way.
      await upsertUser(phone, { optedOut: !req.body.marketingConsent });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("register error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Step 2: web visitor submits the code they received, unlocking a deal.
router.post("/confirm", confirmIpLimiter, async (req, res) => {
  const phone = toE164(req.body.phone);
  const { code, dealId } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ success: false, error: "Missing phone or code." });
  }

  try {
    const approved = await checkVerificationCode(phone, code);
    if (!approved) {
      return res.status(400).json({ success: false, error: "That code didn't match. Try again." });
    }

    const deals = await readDeals();
    // A dealId means the user picked this specific deal on the site (a real
    // buying-intent signal) rather than us guessing via pickBestDeal.
    const requestedDeal = dealId ? await getDealById(dealId) : null;
    const deal = requestedDeal || (await pickBestDeal(deals, await getUser(phone)));

    const existing = await getUser(phone);
    await upsertUser(phone, {
      verified: true,
      registeredAt: existing?.registeredAt || new Date().toISOString()
    });

    // Claim this visitor's earlier anonymous steps for the number they just
    // proved, so the session reads as one attributable journey. Never let an
    // analytics failure break a verification the user has already passed.
    try {
      await attachPhoneToVisitor(req.body.visitorId, phone);
    } catch (err) {
      console.error("Funnel attribution error:", err.message);
    }

    const smsText = await writeSmsCopy(await getUser(phone), deal);

    // Respect a prior STOP: never send the marketing text to an opted-out
    // number, even if they've re-verified via the website. The code still
    // shows on-screen either way — opting out of texts isn't a punishment.
    let smsSent = false;
    if (existing?.optedOut) {
      console.log(`Skipping SMS to ${phone}: opted out.`);
    } else {
      try {
        await sendSms(phone, smsText);
        smsSent = true;
      } catch (smsErr) {
        console.warn("SMS send skipped/failed:", smsErr.message);
      }
    }

    await logEngagement(phone, { dealId: deal.id, category: deal.category, smsSent, explicit: !!requestedDeal });

    res.json({ success: true, code: deal.code, link: deal.link, message: smsText, smsSent, optedOut: !!existing?.optedOut });
  } catch (err) {
    console.error("confirm error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Alternate entry point: user texts the Twilio number directly.
// Configure this URL as the "A message comes in" webhook on your Twilio
// number (see README.md).
router.post("/sms-inbound", express.urlencoded({ extended: false }), async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || "").trim();
  const { MessagingResponse } = twilio.twiml;
  const twiml = new MessagingResponse();

  try {
    if (/^\d{4,8}$/.test(body)) {
      // Looks like an OTP the user is texting back.
      const approved = await checkVerificationCode(from, body);
      if (approved) {
        const deals = await readDeals();
        const user = await getUser(from);

        if (user?.optedOut) {
          // Shouldn't normally reach here — the "start"/else branch below
          // clears optedOut before a code is ever sent — but guard anyway
          // in case someone replays an old code after opting out mid-flow.
          twiml.message("You're opted out of texts from OfferMeDiscounts. Text START to opt back in first.");
        } else {
          const sentIds = (user?.engagement || []).map(e => e.dealId);
          const candidates = deals.filter(d => !sentIds.includes(d.id));
          const deal = await pickBestDeal(candidates.length ? candidates : deals, user);

          await upsertUser(from, {
            verified: true,
            registeredAt: user?.registeredAt || new Date().toISOString()
          });
          const smsText = await writeSmsCopy(await getUser(from), deal);
          await logEngagement(from, { dealId: deal.id, category: deal.category, smsSent: true, via: "inbound" });

          twiml.message(smsText);
        }
      } else {
        twiml.message("That code didn't match. Text START to get a new one.");
      }
    } else if (/^help$/i.test(body)) {
      // Deterministic, not routed through the AI classifier — HELP is a
      // CTIA-required keyword and shouldn't depend on model output.
      twiml.message(
        "OfferMeDiscounts: Text/data rates may apply. Reply STOP to unsubscribe. " +
          "Support: fairchildaustin0@gmail.com"
      );
    } else {
      const intent = await parseInboundIntent(body);
      if (intent === "stop") {
        // Persist the opt-out so nothing texts this number again — the
        // web confirm flow and the inbound deal-send above both check it.
        // The confirmation reply itself is still sent: CTIA/TCPA guidance
        // requires acknowledging STOP, that's the one exception.
        await upsertUser(from, { optedOut: true });
        twiml.message("You're unsubscribed from OfferMeDiscounts texts. Text START anytime to rejoin.");
      } else if (intent === "not_interested") {
        // A real negative signal (unlike engagement_events' default rows,
        // which only mean "we sent this," not "they liked it") — attaches
        // to whichever deal we most recently sent this phone.
        const marked = await markLastEngagementDisliked(from);
        twiml.message(
          marked
            ? "Got it — we'll steer away from deals like that. Text us anytime for a new one, or STOP to opt out entirely."
            : "Thanks for the feedback! Text us anytime to get a deal."
        );
      } else {
        // Treat "start" and anything unrecognized as the registration gate,
        // matching the plan's "text number to begin" flow. Also clears any
        // prior opt-out, since texting in at all is a fresh opt-in signal.
        await upsertUser(from, { optedOut: false });
        await sendVerificationCode(from);
        twiml.message(
          "OfferMeDiscounts: You're opted in! Reply with the code we just texted you to unlock your first deal. " +
            "Msg & data rates may apply. Reply HELP for help, STOP to opt out."
        );
      }
    }
  } catch (err) {
    console.error("sms-inbound error:", err.message);
    twiml.message("Something went wrong on our end — please try again in a minute.");
  }

  res.type("text/xml").send(twiml.toString());
});

module.exports = router;
