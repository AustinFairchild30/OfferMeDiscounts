// Proof that a phone number passed Twilio Verify, held in a signed cookie.
//
// Before this existed, "is this visitor verified?" was answered by a
// localStorage flag in the browser and nothing else, while /api/deals handed
// every coupon code to anyone who asked. The gate was a UI step, not a gate:
// the reveal read the code out of memory and never consulted the server, so
// opening devtools — or curling the API — skipped it entirely. Since the
// verified, opted-in audience IS the product being sold to brands, the check
// has to live on the server.
//
// Deliberately separate from adminAuth.js rather than generalising it. That
// file guards the dashboard with a 12-hour session and one shared password;
// this one identifies an ordinary visitor for 90 days and carries a phone
// number in the payload. They authenticate different things with different
// lifetimes, and folding them into one helper invites a change made for the
// admin side to quietly widen what a visitor's cookie can do. The ~15 lines
// of HMAC they have in common is a cheaper price than that coupling.

const crypto = require("crypto");

// Long-lived on purpose. The verification's job is to prove a real person
// with a real number is behind the request; making them re-verify every few
// days would mean paying Twilio again to learn something we already know,
// and would train people to expect repeated code requests — which is exactly
// the habit that makes OTP phishing work.
const USER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90; // 90 days
const USER_COOKIE_NAME = "omd_session";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing SESSION_SECRET. Copy .env.example to .env and set one.");
  }
  return secret;
}

function sign(value) {
  const hmac = crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
  return `${value}.${hmac}`;
}

function createUserSessionToken(phone) {
  const expiresAt = Date.now() + USER_SESSION_TTL_MS;
  return sign(`user|${phone}|${expiresAt}`);
}

// Returns the verified phone number, or null. Never throws on malformed
// input — a junk or tampered cookie is just an unverified visitor.
function readUserSession(token) {
  if (!token || typeof token !== "string") return null;
  const idx = token.lastIndexOf(".");
  if (idx === -1) return null;

  const value = token.slice(0, idx);
  const providedHmac = token.slice(idx + 1);
  const expectedHmac = crypto.createHmac("sha256", getSecret()).update(value).digest("hex");

  const a = Buffer.from(providedHmac);
  const b = Buffer.from(expectedHmac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Prefix-checked so an admin token can never be presented as a user one.
  const [kind, phone, expiresAt] = value.split("|");
  if (kind !== "user" || !phone) return null;
  if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) <= Date.now()) return null;

  return phone;
}

function requireVerifiedUser(req, res, next) {
  const phone = readUserSession(req.cookies?.[USER_COOKIE_NAME]);
  if (!phone) {
    // 401 specifically, so the frontend can tell "verify again" apart from a
    // deal that doesn't exist and send the visitor back to the phone step.
    return res.status(401).json({ success: false, error: "Verify your number to view this code." });
  }
  req.verifiedPhone = phone;
  next();
}

function userCookieOptions(req) {
  return {
    httpOnly: true, // not readable from JS, so an XSS can't lift the session
    sameSite: "lax",
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    maxAge: USER_SESSION_TTL_MS
  };
}

module.exports = {
  USER_COOKIE_NAME,
  USER_SESSION_TTL_MS,
  createUserSessionToken,
  readUserSession,
  requireVerifiedUser,
  userCookieOptions
};
