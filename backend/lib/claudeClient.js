// Claude integration: deal matching + SMS copywriting + inbound-text
// intent parsing, per "What Claude handles in this app" in the project
// plan doc.
//
// Model note: the plan doc referenced "claude-sonnet-4-6" as a placeholder.
// The current real model IDs (as of this build) are:
//   - claude-sonnet-5   -> used here for reasoning/matching tasks
//   - claude-haiku-4-5-20251001 -> used here for cheap, high-volume SMS copy
// Check https://docs.claude.com for the latest available models before
// you deploy this for real.

const Anthropic = require("@anthropic-ai/sdk");

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key from console.anthropic.com."
    );
  }
  return new Anthropic({ apiKey });
}

const MATCHING_MODEL = "claude-sonnet-5";
const COPY_MODEL = "claude-haiku-4-5-20251001";

// Derives an implicit brand signal from a user's past engagement — the
// stores behind deals they've already unlocked — without needing any
// extra input from them. Cross-references against the current deals
// list since engagement_events only stores a deal_id.
function engagedStores(user, deals) {
  const dealIds = new Set((user?.engagement || []).map(e => e.dealId));
  if (!dealIds.size) return [];
  return [...new Set(deals.filter(d => dealIds.has(d.id)).map(d => d.store))];
}

// Ranks a list of deals against a user's declared interests, explicit
// favorite brands, and implicit engagement history, and returns the best
// match. Falls back to the first deal if Claude's pick can't be parsed.
async function pickBestDeal(deals, user) {
  const client = getClient();
  const interests = user?.interests?.length ? user.interests.join(", ") : "no declared interests yet";
  const favoriteBrands = user?.favoriteBrands?.length ? user.favoriteBrands.join(", ") : "none declared";
  const pastStores = engagedStores(user, deals);
  const engagementNote = pastStores.length ? pastStores.join(", ") : "no prior engagement yet";

  const dealList = deals
    .map(d => `${d.id} | ${d.category} | ${d.store} | ${d.title} | expires ${d.expires}`)
    .join("\n");

  const msg = await client.messages.create({
    model: MATCHING_MODEL,
    max_tokens: 20,
    system:
      "You are a discount-matching agent for a coupon platform. Given a user's interests, their explicitly " +
      "declared favorite brands/stores, the stores they've previously engaged with, and a list of candidate " +
      "deals, respond with ONLY the id of the single best deal for that user. Prioritize an exact or close " +
      "match on favorite brands/stores first, then category interests, then past engagement, then general " +
      "appeal. No explanation, just the id (e.g. d004).",
    messages: [
      {
        role: "user",
        content:
          `User category interests: ${interests}\n` +
          `User declared favorite brands/stores: ${favoriteBrands}\n` +
          `Stores user has engaged with before: ${engagementNote}\n\n` +
          `Candidate deals:\n${dealList}\n\nBest deal id:`
      }
    ]
  });

  const text = msg.content?.[0]?.text?.trim() || "";
  const match = deals.find(d => text.includes(d.id));
  return match || deals[0];
}

// Writes a short, personalized SMS for a specific deal.
async function writeSmsCopy(user, deal) {
  const client = getClient();
  const interestNote = user?.interests?.length ? `They've shown interest in: ${user.interests.join(", ")}.` : "";
  const brandNote = user?.favoriteBrands?.length ? ` Their favorite brands/stores: ${user.favoriteBrands.join(", ")}.` : "";

  const msg = await client.messages.create({
    model: COPY_MODEL,
    max_tokens: 100,
    system:
      "You write short SMS marketing copy for a discount platform called OfferMeDiscounts. " +
      "Rules: max 160 characters, tone is urgent but not pushy, always include the coupon code exactly as given, " +
      "no emojis, no hashtags, sign off isn't needed. Output ONLY the SMS text, nothing else.",
    messages: [
      {
        role: "user",
        content:
          `Write the SMS for this deal.\n` +
          `Store: ${deal.store}\nOffer: ${deal.title} (${deal.discount})\nCode: ${deal.code}\n` +
          `Expires: ${deal.expires}\n${interestNote}${brandNote}`
      }
    ]
  });

  return msg.content?.[0]?.text?.trim() || `${deal.store}: ${deal.title}. Code ${deal.code}. Exp ${deal.expires}.`;
}

// Parses an inbound text (from the Twilio webhook) into a simple intent
// so the server knows how to reply. Keeps the set of intents small and
// explicit rather than letting the model free-form the whole reply.
async function parseInboundIntent(messageBody) {
  const client = getClient();

  const msg = await client.messages.create({
    model: COPY_MODEL,
    max_tokens: 20,
    system:
      'Classify the incoming SMS into exactly one label: "start" (wants to join / get deals / says hi), ' +
      '"stop" (wants to unsubscribe), or "other". Respond with only the label, lowercase, no punctuation.',
    messages: [{ role: "user", content: messageBody }]
  });

  const label = (msg.content?.[0]?.text || "").trim().toLowerCase();
  if (label.includes("stop")) return "stop";
  if (label.includes("start")) return "start";
  return "other";
}

module.exports = { pickBestDeal, writeSmsCopy, parseInboundIntent };
