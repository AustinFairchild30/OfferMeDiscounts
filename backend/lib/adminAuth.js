// Minimal single-admin session auth. No user accounts, no DB session
// table — just a signed, time-limited cookie backed by SESSION_SECRET.
// Good enough for a solo-admin dashboard; swap for real auth (accounts,
// roles) before letting more than one person manage deals.

const crypto = require("crypto");

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const COOKIE_NAME = "omd_admin_session";

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

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return false;
  const idx = token.lastIndexOf(".");
  if (idx === -1) return false;
  const value = token.slice(0, idx);
  const providedHmac = token.slice(idx + 1);
  const expectedHmac = crypto.createHmac("sha256", getSecret()).update(value).digest("hex");

  const a = Buffer.from(providedHmac);
  const b = Buffer.from(expectedHmac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const expiresAt = Number(value.split("|")[1]);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function createSessionToken() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return sign(`admin|${expiresAt}`);
}

function checkPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password || typeof password !== "string") return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (!verifySessionToken(req.cookies?.[COOKIE_NAME])) {
    return res.status(401).json({ success: false, error: "Not authenticated." });
  }
  next();
}

module.exports = { COOKIE_NAME, SESSION_TTL_MS, createSessionToken, verifySessionToken, checkPassword, requireAdmin };
