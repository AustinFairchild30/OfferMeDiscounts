// Awin — the third affiliate network, alongside CJ and Impact.
//
// What the live API actually does, found by probing account 3105418 rather
// than by reading the docs. Most of this contradicts the first draft of this
// file, which is the whole reason scripts/probe-awin.js exists:
//
//  - Promotions are POST /publisher/{id}/promotions — SINGULAR "publisher",
//    and POST, not GET. The plural path 404s and the GET 405s. The body is
//    { filters, pagination }.
//  - Programmes are GET /publishers/{id}/programmes — PLURAL. Opposite of
//    the promotions path. ?relationship=joined narrows it to yours; without
//    that it returns the entire 21,000-programme directory.
//  - The tracking link is `urlTracking`. `url` is the merchant's own bare
//    URL with no affiliate parameters, so sending traffic there earns
//    nothing. The first draft preferred `url` and would have silently
//    produced a catalog of unmonetised links.
//  - The coupon code is nested at `voucher.code`, and it is frequently null
//    on rows whose description plainly contains the code ("12% off with
//    Coupon Code FALL12"). Same as Impact — so the same text extraction is
//    needed, not the structured read the docs imply.
//  - `type` is "voucher" or "promotion". Both are real offers; a promotion
//    is a sale with no code.
//  - `advertiser` is nested: { id, name, joined }. That `joined` flag is the
//    only reliable way to tell your programmes from the other 32,000
//    promotions in the feed, because every server-side filter shape tried
//    returned 400 or 500.
//  - regions is { all: true } or { all: false, list: [{ countryCode }] }.
//  - pageSize maxes out at 200; 500 and 1000 are rejected.
//  - The endpoint 500s intermittently under rapid successive calls — the
//    identical request that succeeded moments earlier can fail — so every
//    call retries with backoff. Treat a single 500 as noise, not an answer.

const {
  deriveDiscount, isNonUsTargeted, stripHtmlTags, cleanStoreName,
  dedupeIdenticalOffers, capPerAdvertiser, isBlockedAdvertiser,
  extractCodeFromText, redactCodes
} = require("./cjClient");

const BASE = "https://api.awin.com";
const PAGE_SIZE = 200;              // hard ceiling; larger is rejected
const MAX_PAGES = 250;              // 50k rows, well clear of the ~32k live
const NO_EXPIRY = "2099-12-31";     // matches impactClient's sentinel

const ENDPOINTS = {
  programmes: id => `/publishers/${id}/programmes?relationship=joined`,
  promotions: id => `/publisher/${id}/promotions`
};

function credentials() {
  const token = process.env.AWIN_API_TOKEN;
  const publisherId = process.env.AWIN_PUBLISHER_ID;
  if (!token || !publisherId) {
    throw new Error("AWIN_API_TOKEN and AWIN_PUBLISHER_ID must be set to sync from Awin.");
  }
  return { token, publisherId };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retries 5xx and network errors, not 4xx: a 400 means the request is wrong
// and will stay wrong, while a 500 here is usually the endpoint being flaky.
async function awinFetch(path, token, { method = "GET", body } = {}, attempt = 1) {
  const MAX_ATTEMPTS = 4;
  let res;
  try {
    res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err;
    await sleep(500 * 2 ** (attempt - 1));
    return awinFetch(path, token, { method, body }, attempt + 1);
  }

  if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
    await sleep(500 * 2 ** (attempt - 1));
    return awinFetch(path, token, { method, body }, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`Awin ${method} ${path} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Awin is UK-headquartered and the feed is mostly European — the sample this
// was written against was a French scooter listing — so this filter carries
// more weight here than on CJ. { all: true } means unrestricted, which
// includes the US.
function servesUs(promotion) {
  const regions = promotion.regions;
  if (!regions || regions.all) return true;
  return (regions.list || []).some(r => String(r.countryCode).toUpperCase() === "US");
}

function discountFor(title, description) {
  return deriveDiscount(null, title, description);
}

function mapPromotionToDeal(promotion, programmesById) {
  const programme = programmesById.get(String(promotion.advertiser?.id)) || {};
  const store = cleanStoreName(String(promotion.advertiser?.name || programme.name || "").trim());

  const rawTitle = stripHtmlTags(String(promotion.title || ""));
  const rawDescription = stripHtmlTags(String(promotion.description || ""));

  // voucher.code is the structured field and it's often null on rows that
  // spell the code out in the description, so fall back to reading it out of
  // the text — then scrub both strings either way, so no code can reach a
  // page ahead of the SMS gate.
  const code =
    (String(promotion.voucher?.code || "").trim() || null) ||
    extractCodeFromText(`${rawTitle} ${rawDescription}`);

  return {
    awinPromotionId: String(promotion.promotionId),
    title: redactCodes(rawTitle || rawDescription, code) || store,
    brand: store,
    store,
    category: null, // resolved per-advertiser by the caller
    discount: discountFor(rawTitle, rawDescription),
    code,
    description: redactCodes(rawDescription, code),
    expires: toIsoDate(promotion.endDate) || NO_EXPIRY,
    // urlTracking, never url — see the header. url earns nothing.
    link: promotion.urlTracking || null,
    logoDomain: domainOf(programme.displayUrl || promotion.url || ""),
    // Sector is Awin's own classification. It doesn't map onto our taxonomy,
    // but it's a useful hint for the one-off Haiku classification.
    programmeDescription: [programme.primarySector, programme.description]
      .filter(Boolean)
      .join(" — ")
  };
}

// Returns null — not [] — when the call itself fails, so the caller can tell
// "you have joined nothing" apart from "we couldn't find out". They lead to
// opposite decisions: the first means there is nothing to sync, the second
// means sync anyway and lean on advertiser.joined.
async function fetchJoinedProgrammes({ token, publisherId }) {
  try {
    const rows = await awinFetch(ENDPOINTS.programmes(publisherId), token);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.warn("Awin programmes unavailable, continuing without them:", err.message);
    return null;
  }
}

// Every server-side filter shape tried came back 400 or 500, so the whole
// feed gets paged and filtered here. ~32k rows at 200 a page is ~160 requests
// on a nightly job, which is acceptable; what isn't acceptable is importing
// 32,000 promotions from programmes we haven't joined and can't earn on.
async function fetchAllPromotions({ token, publisherId }) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = await awinFetch(ENDPOINTS.promotions(publisherId), token, {
      method: "POST",
      body: { filters: {}, pagination: { page, pageSize: PAGE_SIZE } }
    });
    const batch = payload?.data || [];
    rows.push(...batch);

    const total = payload?.pagination?.total;
    if (batch.length < PAGE_SIZE) break;
    if (Number.isFinite(total) && rows.length >= total) break;
  }
  return rows;
}

async function fetchAwinDeals() {
  const creds = credentials();

  const programmes = await fetchJoinedProgrammes(creds);

  // Paging the whole feed costs ~160 requests against an endpoint that
  // already 500s under load. When we know for certain that no programme has
  // been joined, every one of those requests would be spent confirming that
  // nothing matches — so don't make them.
  if (programmes && programmes.length === 0) {
    console.log("Awin: no joined programmes yet, skipping the promotions feed.");
    return [];
  }

  const programmesById = new Map((programmes || []).map(p => [String(p.id), p]));
  const promotions = await fetchAllPromotions(creds);

  const deals = promotions
    // joined is the whole filter: without it this imports the entire network.
    .filter(p => p?.advertiser?.joined === true)
    .filter(p => p.status === "active" && p.promotionId && p.urlTracking)
    .filter(servesUs)
    .filter(p => !isNonUsTargeted(`${p.title || ""} ${p.description || ""}`))
    .map(p => mapPromotionToDeal(p, programmesById))
    .filter(d => d.store)
    // Same bar as the other two networks: no discount and no code means
    // there's nothing for a visitor to act on.
    .filter(d => d.discount || d.code)
    .filter(d => !isBlockedAdvertiser(d.store, `${d.title} ${d.description}`));

  return capPerAdvertiser(dedupeIdenticalOffers(deals));
}

module.exports = { fetchAwinDeals, mapPromotionToDeal, servesUs, ENDPOINTS, NO_EXPIRY };
