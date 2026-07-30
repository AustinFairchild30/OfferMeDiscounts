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

const router = express.Router();

function toE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(raw).trim().startsWith("+")) return String(raw).trim();
  return null;
}

router.get("/deals", (req, res) => {
  res.json(readDeals());
});

// Admin CRUD — backs admin.html's add/edit/delete instead of localStorage.
router.post("/deals", (req, res) => {
  const payload = req.body || {};
  if (!payload.title || !payload.store || !payload.code || !payload.expires) {
    return res.status(400).json({ success: false, error: "Title, store, code, and expiration date are required." });
  }
  const deal = addDeal(payload);
  res.json({ success: true, deal });
});

router.put("/deals/:id", (req, res) => {
  const deal = updateDeal(req.params.id, req.body || {});
  if (!deal) return res.status(404).json({ success: false, error: "Deal not found." });
  res.json({ success: true, deal });
});

router.delete("/deals/:id", (req, res) => {
  const removed = removeDeal(req.params.id);
  if (!removed) return res.status(404).json({ success: false, error: "Deal not found." });
  res.json({ success: true });
});

router.post("/deals/reset", (req, res) => {
  const deals = resetToSeed();
  res.json({ success: true, deals });
});

router.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Step 1: web visitor requests a code for a specific deal.
router.post("/register", async (req, res) => {
  const phone = toE164(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: "Enter a valid 10-digit US phone number." });
  }

  try {
    await sendVerificationCode(phone);
    upsertUser(phone, {}); // ensure a record exists even before verification completes
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

    const deals = readDeals();
    const deal = getDealById(dealId) || (await pickBestDeal(deals, getUser(phone)));

    const existing = getUser(phone);
    upsertUser(phone, {
      verified: true,
      registeredAt: existing?.registeredAt || new Date().toISOString()
    });

    const smsText = await writeSmsCopy(getUser(phone), deal);

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

    logEngagement(phone, { dealId: deal.id, category: deal.category, smsSent });

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
        const deals = readDeals();
        const user = getUser(from);
        const sentIds = (user?.engagement || []).map(e => e.dealId);
        const candidates = deals.filter(d => !sentIds.includes(d.id));
        const deal = await pickBestDeal(candidates.length ? candidates : deals, user);

        upsertUser(from, {
          verified: true,
          registeredAt: user?.registeredAt || new Date().toISOString()
        });
        const smsText = await writeSmsCopy(getUser(from), deal);
        logEngagement(from, { dealId: deal.id, category: deal.category, smsSent: true, via: "inbound" });

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
        upsertUser(from, {});
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
