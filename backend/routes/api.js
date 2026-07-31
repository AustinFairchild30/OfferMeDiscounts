// API routes implementing the "week 1 core loop" from the project plan:
//   1. User taps "Text Me the Code" on the site -> POST /api/register
//   2. User enters the code they received -> POST /api/confirm
//   3. (Alternate entry point) user texts the Twilio number directly ->
//      POST /api/sms-inbound (Twilio webhook)

const express = require("express");
const twilio = require("twilio");
const { sendVerificationCode, checkVerificationCode, sendSms } = require("../lib/twilioClient");
const { pickBestDeal, writeSmsCopy, parseInboundIntent } = require("../lib/claudeClient");
const { readDeals, getDealById, addDeal, updateDeal, removeDeal, resetToSeed } = require("../lib/dealsStore");
const { getUser, upsertUser, logEngagement } = require("../lib/userStore");
const { COOKIE_NAME, SESSION_TTL_MS, createSessionToken, checkPassword, requireAdmin } = require("../lib/adminAuth");

const router = express.Router();

router.post("/admin/login", (req, res) => {
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
router.post("/register", async (req, res) => {
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
router.post("/confirm", async (req, res) => {
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
    const deal = (await getDealById(dealId)) || (await pickBestDeal(deals, await getUser(phone)));

    const existing = await getUser(phone);
    await upsertUser(phone, {
      verified: true,
      registeredAt: existing?.registeredAt || new Date().toISOString()
    });

    const smsText = await writeSmsCopy(await getUser(phone), deal);

    // Best-effort SMS send — if TWILIO_FROM_NUMBER isn't configured yet
    // (e.g. still on a Verify-only trial setup), don't fail the whole
    // request; the code still gets shown on-screen.
    let smsSent = false;
    try {
      await sendSms(phone, smsText);
      smsSent = true;
    } catch (smsErr) {
      console.warn("SMS send skipped/failed:", smsErr.message);
    }

    await logEngagement(phone, { dealId: deal.id, category: deal.category, smsSent });

    res.json({ success: true, code: deal.code, message: smsText, smsSent });
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
      } else {
        twiml.message("That code didn't match. Text START to get a new one.");
      }
    } else {
      const intent = await parseInboundIntent(body);
      if (intent === "stop") {
        twiml.message("You're unsubscribed from OfferMeDiscounts texts. Text START anytime to rejoin.");
      } else {
        // Treat "start" and anything unrecognized as the registration gate,
        // matching the plan's "text number to begin" flow.
        await upsertUser(from, {});
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
