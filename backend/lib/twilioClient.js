// Twilio integration: phone verification (Twilio Verify) + outbound SMS.
//
// Verify handles the "text your number to unlock a code" OTP flow without
// you having to manage your own 6-digit-code generation/expiry logic.
// Docs: https://www.twilio.com/docs/verify/api

const twilio = require("twilio");

function getClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    throw new Error(
      "Missing TWILIO_ACCOUNT_SID / TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET. Copy .env.example to .env and fill in your Twilio credentials."
    );
  }
  // API Key auth (Twilio's recommended approach over the account Auth Token):
  // a key can be individually revoked/rotated without affecting the Auth
  // Token, which limits blast radius if one leaks.
  return twilio(apiKeySid, apiKeySecret, { accountSid });
}

// Sends a one-time code to `phone` (E.164 format, e.g. +15551234567).
async function sendVerificationCode(phone) {
  const client = getClient();
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!serviceSid) {
    throw new Error("Missing TWILIO_VERIFY_SERVICE_SID. Create a Verify Service in the Twilio console.");
  }
  return client.verify.v2
    .services(serviceSid)
    .verifications.create({ to: phone, channel: "sms" });
}

// Checks a code the user submitted. Returns true if approved.
async function checkVerificationCode(phone, code) {
  const client = getClient();
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  const result = await client.verify.v2
    .services(serviceSid)
    .verificationChecks.create({ to: phone, code });
  return result.status === "approved";
}

// Sends a plain SMS (used for the personalized deal message, and for
// re-engagement texts once V2 profiling exists).
async function sendSms(to, body) {
  const client = getClient();
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) {
    throw new Error("Missing TWILIO_FROM_NUMBER in .env.");
  }
  return client.messages.create({ to, from, body });
}

module.exports = { sendVerificationCode, checkVerificationCode, sendSms };
