// Twilio integration: phone verification (Twilio Verify) + outbound SMS.
//
// Verify handles the "text your number to unlock a code" OTP flow without
// you having to manage your own 6-digit-code generation/expiry logic.
// Docs: https://www.twilio.com/docs/verify/api

const twilio = require("twilio");

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error(
      "Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN. Copy .env.example to .env and fill in your Twilio credentials."
    );
  }
  return twilio(sid, token);
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
