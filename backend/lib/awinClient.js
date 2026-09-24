// Awin — the third affiliate network, alongside CJ and Impact.
//
// STATUS: written against Awin's documented API, NOT against a live account.
// Nothing here has been verified against real responses yet. Run
// `node scripts/probe-awin.js` once credentials exist and correct the two
// blocks marked ADJUST AFTER PROBE below. That ordering is deliberate: the
// Impact client was written from the docs and most of it was wrong for the
// real account (see the header of impactClient.js), so the endpoints and
// field names here are treated as guesses until something proves otherwise.
//
// Two defences against that uncertainty:
//
//  - Endpoints live in ENDPOINTS, so a probe result is a one-line change
//    rather than a hunt through the file.
//  - Field reads go through pick(), which accepts the several names Awin has
//    plausibly used, so a mapping that guesses wrong on one name still works
//    if any of the alternatives is right. Fixing it means editing a list.
//
// Awin may not expose vouchers over REST at all on a given account — they're
// also published through Toolbox > Create-a-Feed. If the probe finds no
// working promotions endpoint, set AWIN_PROMOTIONS_URL to that feed's JSON
// URL and this client reads it instead, with no other changes.

const {
  deriveDiscount, isNonUsTargeted, stripHtmlTags, cleanStoreName,
  dedupeIdenticalOffers, capPerAdvertiser, isBlockedAdvertiser,
  extractCodeFromText, redactCodes
} = require("./cjClient");

const BASE = "https://api.awin.com";

// Matches impactClient's sentinel so the two networks agree on what "no
// stated end date" looks like, and expiryLabel on the frontend keeps treating
// it as "don't invent a deadline".
const NO_EXPIRY = "2099-12-31";

// ---- ADJUST AFTER PROBE (1/2): endpoints -------------------------------
const ENDPOINTS = {
  programmes: id => `/publishers/${id}/programmes?relationship=joined`,
  promotions: id => `/publishers/${id}/promotions`
};

function credentials() {
  const token = process.env.AWIN_API_TOKEN;
  const publisherId = process.env.AWIN_PUBLISHER_ID;
  if (!token || !publisherId) {
    throw new Error("AWIN_API_TOKEN and AWIN_PUBLISHER_ID must be set to sync from Awin.");
  }
  return { token, publisherId };
}

async function awinGet(path, token) {
  const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Awin ${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Awin returns bare arrays on some endpoints and an envelope on others.
function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "promotions", "programmes", "results", "items"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

// ---- ADJUST AFTER PROBE (2/2): field names -----------------------------
// Each list is "the names this value might arrive under". First hit wins.
const FIELDS = {
  promotionId: ["promotionId", "id", "voucherId"],
  programmeId: ["advertiserId", "programmeId", "programId", "merchantId"],
  advertiser: ["advertiserName", "programmeName", "programName", "merchantName", "name"],
  title: ["title", "description", "name", "voucherTitle"],
  description: ["description", "terms", "details", "summary"],
  code: ["voucherCode", "code", "promotionCode", "discountCode"],
  startDate: ["startDate", "validFrom", "startsAt"],
  endDate: ["endDate", "validTo", "expiryDate", "expiresAt", "endsAt"],
  link: ["url", "clickThroughUrl", "trackingUrl", "deepLink", "awinLink"],
  destination: ["destinationUrl", "landingPage", "merchantUrl"],
  region: ["regions", "region", "primaryRegion", "countryCode"],
  discountPercent: ["percentage", "discountPercent", "percentageDiscount"],
  discountAmount: ["amount", "discountAmount", "fixedDiscount"]
};

function pick(obj, names) {
  for (const name of names) {
    const value = obj?.[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function logoDomainFrom(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Same order of preference as Impact: trust a structured discount when one is
// actually present, otherwise read the offer out of the free text. Impact
// taught that the structured fields are the exception, not the rule.
function discountFor(promotion, title, description) {
  const pct = parseFloat(pick(promotion, FIELDS.discountPercent));
  if (Number.isFinite(pct) && pct > 0) return `${Math.round(pct)}% OFF`;
  const amt = parseFloat(pick(promotion, FIELDS.discountAmount));
  if (Number.isFinite(amt) && amt > 0) return `$${Math.round(amt)} OFF`;
  return deriveDiscount(null, title, description);
}

// Awin is a UK-headquartered network with a large European membership, so the
// US filter matters more here than on CJ. Uses the programme's own region
// when one is present — a declared region beats guessing from text — and
// falls back to the shared text heuristic when it isn't.
function shipsToUs(programme) {
  const region = pick(programme || {}, FIELDS.region);
  if (!region) return true; // unknown: let the text filter decide
  const values = (Array.isArray(region) ? region : [region]).map(r =>
    String(typeof r === "object" ? r.countryCode || r.name || "" : r).toUpperCase()
  );
  return values.some(v => v === "US" || v === "USA" || v === "UNITED STATES");
}

function mapPromotionToDeal(promotion, programmesById) {
  const programme = programmesById.get(String(pick(promotion, FIELDS.programmeId))) || {};
  const store = cleanStoreName(
    String(pick(promotion, FIELDS.advertiser) || pick(programme, FIELDS.advertiser) || "").trim()
  );

  const rawTitle = stripHtmlTags(String(pick(promotion, FIELDS.title) || ""));
  const rawDescription = stripHtmlTags(String(pick(promotion, FIELDS.description) || ""));

  // Same three-step as the other networks: prefer the structured code, then
  // recover one written into the text, then scrub the text either way so a
  // code can't reach the page ahead of the SMS gate.
  const code =
    (String(pick(promotion, FIELDS.code) || "").trim() || null) ||
    extractCodeFromText(`${rawTitle} ${rawDescription}`);

  const title = redactCodes(rawTitle || rawDescription, code);
  const description = redactCodes(rawDescription, code);
  const link = pick(promotion, FIELDS.link);

  return {
    awinPromotionId: String(pick(promotion, FIELDS.promotionId) || ""),
    title: title || store,
    brand: store,
    store,
    category: null, // resolved per-advertiser by the caller, same as Impact
    discount: discountFor(promotion, rawTitle, rawDescription),
    code,
    description,
    expires: toIsoDate(pick(promotion, FIELDS.endDate)) || NO_EXPIRY,
    link: link ? String(link) : null,
    logoDomain: logoDomainFrom(
      pick(programme, FIELDS.destination) || pick(promotion, FIELDS.destination) || ""
    ),
    programmeDescription: String(pick(programme, FIELDS.description) || "")
  };
}

async function fetchJoinedProgrammes({ token, publisherId }) {
  try {
    return rowsOf(await awinGet(ENDPOINTS.programmes(publisherId), token));
  } catch (err) {
    // Not fatal. Programmes only enrich the promotions (region, logo domain,
    // description for categorisation); the deals themselves come from the
    // promotions call, and losing the enrichment is better than losing them.
    console.warn("Awin programmes unavailable, continuing without them:", err.message);
    return [];
  }
}

async function fetchPromotions({ token, publisherId }) {
  // A generated feed wins when it's configured: if the probe found no REST
  // promotions endpoint on this account, this is the supported route.
  const feedUrl = process.env.AWIN_PROMOTIONS_URL;
  if (feedUrl) return rowsOf(await awinGet(feedUrl, token));
  return rowsOf(await awinGet(ENDPOINTS.promotions(publisherId), token));
}

async function fetchAwinDeals() {
  const creds = credentials();

  const programmes = await fetchJoinedProgrammes(creds);
  const programmesById = new Map(
    programmes.map(p => [String(pick(p, FIELDS.programmeId) ?? pick(p, ["id"])), p])
  );

  const promotions = await fetchPromotions(creds);

  const deals = promotions
    .filter(p => p && pick(p, FIELDS.promotionId) && pick(p, FIELDS.link))
    .filter(p => shipsToUs(programmesById.get(String(pick(p, FIELDS.programmeId)))))
    .filter(p => !isNonUsTargeted(`${pick(p, FIELDS.title) || ""} ${pick(p, FIELDS.description) || ""}`))
    .map(p => mapPromotionToDeal(p, programmesById))
    .filter(d => d.store && d.awinPromotionId)
    // Same bar as the other two: without a discount or a code there's nothing
    // for a visitor to act on, whatever the advertiser tagged it as.
    .filter(d => d.discount || d.code)
    .filter(d => !isBlockedAdvertiser(d.store, `${d.title} ${d.description}`));

  return capPerAdvertiser(dedupeIdenticalOffers(deals));
}

module.exports = { fetchAwinDeals, mapPromotionToDeal, pick, FIELDS, ENDPOINTS, NO_EXPIRY };
