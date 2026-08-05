// API routes implementing the "week 1 core loop" from the project plan:
//   1. User taps "Text Me the Code" on the site -> POST /api/register
//   2. User enters the code they received -> POST /api/confirm
//   3. (Alternate entry point) user texts the Twilio number directly ->
//      POST /api/sms-inbound (Twilio webhook)

const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const twilio = require("twilio");
const { sendVerificationCode, checkVerificationCode, sendSms } = require("../lib/twilioClient");
const { pickBestDeal, writeSmsCopy, parseInboundIntent } = require("../lib/claudeClient");
const { readDeals, getDealById, addDeal, updateDeal, removeDeal, resetToSeed } = require("../lib/dealsStore");
const { getUser, upsertUser, logEngagement, markLastEngagementDisliked } = require("../lib/userStore");
const { COOKIE_NAME, SESSION_TTL_MS, createSessionToken, checkPassword, requireAdmin } = require("../lib/adminAuth");

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

// Admin CRUD — backs admin.html's add/edit/delete instead of localStorage.
// Protected: requires a valid admin session (see /admin/login above).
router.post("/deals", requireAdmin, async (req, res) => {
  const payload = req.body || {};
  if (!payload.title || !payload.store || !payload.code || !payload.expires) {
    return res.status(400).json({ success: false, error: "Title, store, code, and expiration date are required." });
  }
  const deal = await addDeal(payload);
  res.json({ success: true, deal });
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

router.post("/deals/reset", requireAdmin, async (req, res) => {
  const deals = await resetToSeed();
  res.json({ success: true, deals });
});

router.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Saves a user's declared category interests (one-time preference survey
// shown right after their first OTP confirmation) so pickBestDeal/writeSmsCopy
// in claudeClient.js can actually personalize future deal picks/copy.
router.post("/preferences", async (req, res) => {
  const phone = toE164(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: "Missing phone." });
  }
  const interests = Array.isArray(req.body.interests) ? req.body.interests.filter(x => typeof x === "string") : [];
  const favoriteBrands = Array.isArray(req.body.favoriteBrands)
    ? req.body.favoriteBrands.filter(x => typeof x === "string" && x.trim()).map(x => x.trim())
    : [];
  await upsertUser(phone, { interests, favoriteBrands });
  res.json({ success: true });
});

// Step 1: web visitor requests a code for a specific deal.
router.post("/register", registerIpLimiter, registerPhoneLimiter, async (req, res) => {
  const phone = toE164(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: "Enter a valid 10-digit US phone number." });
  }

  try {
    await sendVerificationCode(phone);
    await upsertUser(phone, {}); // ensure a record exists even before verification completes
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

    res.json({ success: true, code: deal.code, message: smsText, smsSent, optedOut: !!existing?.optedOut });
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
        twiml.message("Welcome to OfferMeDiscounts! Reply with the code we just texted you to unlock your first deal.");
      }
    }
  } catch (err) {
    console.error("sms-inbound error:", err.message);
    twiml.message("Something went wrong on our end — please try again in a minute.");
  }

  res.type("text/xml").send(twiml.toString());
});

module.exports = router;
