// CJ Affiliate Link Search API — pulls live tracking links/coupons for
// advertisers we've joined so real deals can replace the seed catalog.
// https://developers.cj.com/docs/rest-apis/link-search

const { XMLParser } = require("fast-xml-parser");

const LINK_SEARCH_URL = "https://link-search.api.cj.com/v2/link-search";
const CATEGORY_EMOJI = {
  Electronics: "💻",
  "Fashion & Apparel": "👕",
  "Beauty & Personal Care": "💄",
  "Food & Dining": "🍽️",
  Travel: "✈️",
  "Home & Garden": "🏡",
  "Fitness & Outdoors": "🏋️",
  Pets: "🐾",
  "Books & Media": "📚",
  "Baby & Kids": "🧸",
  Automotive: "🚗",
  "Entertainment & Streaming": "🎬"
};

function sixtyDaysOut() {
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 60);
  return fallback.toISOString().slice(0, 10);
}

// CJ's docs say this field is MM/DD/YYYY, but the live API actually returns
// a full timestamp like "2026-09-01 04:59:00.0" — handle both rather than
// trusting the docs.
function parseExpires(promotionEndDate) {
  if (!promotionEndDate || promotionEndDate === "ongoing") return sixtyDaysOut();

  const isoMatch = String(promotionEndDate).match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const [month, day, year] = String(promotionEndDate).split("/");
  if (!month || !day || !year) return sixtyDaysOut();
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// CJ's promotion-type ("Sale/Discount", "Seasonal Link", "Product", ...) is
// an internal category, not an actual discount amount — showing it as the
// deal's discount badge looks specific but says nothing real. Pull an
// actual figure out of the advertiser's own text when there is one, and
// only fall back to a category label for "Free Shipping" (informative on
// its own). Otherwise leave it blank rather than show a vague label.
function deriveDiscount(promotionType, title, description) {
  const text = `${description} ${title}`;

  const percentMatch = text.match(/(\d{1,3})\s*%/);
  if (percentMatch) return `${percentMatch[1]}% OFF`;

  const dollarMatch = text.match(/\$(\d+(?:\.\d{2})?)\s*(?:off|discount)/i);
  if (dollarMatch) return `$${dollarMatch[1]} OFF`;

  if (promotionType === "Free Shipping") return "Free Shipping";

  return null;
}

// Site is US-only for the foreseeable future. CJ's structured
// `targeted-countries` field is unreliable (often blank even when the title
// clearly says "Mexico only"), so this matches on the title/description
// text instead. Excludes only on a clear non-US signal rather than
// requiring an explicit "US" tag, since most links have no country marker
// at all and are presumably fine as the default/US case.
function isNonUsTargeted(text) {
  if (/^ca[:.]?\s/i.test(text)) return true; // "CA: ..." — this advertiser's Canada prefix convention
  if (/\b(mexico|canada|latam)\b/i.test(text)) return true;
  if (/\bmx\b/i.test(text)) return true;
  if (/\bfor\s+(mexico|latam|canada|uk|eu|australia)\s+only\b/i.test(text)) return true;
  return false;
}

// Advertisers often name links "<Offer> | <Property> | <Advertiser Name>" —
// the trailing advertiser-name segment just repeats what the card already
// shows on the store line below the title, and the raw "|" reads as a
// formatting glitch rather than a real separator.
function cleanTitle(rawTitle, store) {
  if (!rawTitle.includes("|")) return rawTitle;
  const segments = rawTitle.split("|").map(s => s.trim()).filter(Boolean);
  const storeLower = (store || "").trim().toLowerCase();
  while (segments.length > 1 && segments[segments.length - 1].toLowerCase() === storeLower) {
    segments.pop();
  }
  return segments.join(" – ") || rawTitle;
}

// "Stylevana Affiliate Program" etc. — that's CJ's registered advertiser
// name, not a consumer-facing brand name. Strip the business-relationship
// suffix so the card just shows the actual brand.
function cleanStoreName(store) {
  return (store || "").replace(/\s*Affiliate\s*(Program)?\s*$/i, "").trim() || store;
}

// Now-redundant since every deal is US-only (see isNonUsTargeted) — was
// only ever there to distinguish from the Mexico/Canada/LATAM variants
// that get filtered out before this point.
function stripUsPrefix(title) {
  return title.replace(/^US(\s+only)?\s*[:.]\s*/i, "").trim();
}

// Some advertisers write the real coupon code straight into the title
// ("...with Code SVBTSLC"). That defeats the whole point of the SMS gate —
// a visitor could read the working code off the card without ever
// verifying their number — so strip any mention of the deal's own code.
function stripCodeMention(title, code) {
  if (!code) return title;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withCodeWord = new RegExp(`\\s*(?:with|use|using|enter|apply)?\\s*(?:coupon|promo)?\\s*code[:\\s]+["']?${escaped}["']?`, "i");
  let cleaned = title.replace(withCodeWord, "").trim();

  // Fallback for phrasing that doesn't fit the "...code XXXX" shape (e.g.
  // "CPT10 coupon code provides..." or the code leading the title outright).
  // Prioritizes not leaking the code over a perfectly-worded title.
  const bareCode = new RegExp(`\\b${escaped}\\b`, "i");
  if (bareCode.test(cleaned)) {
    cleaned = cleaned.replace(bareCode, "").replace(/\s{2,}/g, " ").trim();
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

// Real brand logos come from a free lookup-by-domain service (Hunter.io's
// Logo API), so all we need to store is the advertiser's own domain —
// the actual image URL is built at render time on the frontend.
function extractLogoDomain(destination) {
  try {
    return new URL(destination).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Some advertisers occasionally leave stray markup in their description
// text (CJ's own feed, not us rendering anything) — e.g. a real Herbspro
// entry whose description was literally "<link>Special Affiliate
// Offer</link>". Strip it before this text is ever shown to a visitor.
function stripHtmlTags(text) {
  return (text || "").replace(/<\/?[^>]+>/g, "").trim();
}

// CJ's link-name is sometimes just the bare advertiser name ("Herbspro.com")
// even when the description has the actual offer ("Get 40% off all your
// orders..."). A link-name that's just a repeat of the store name is worse
// than useless as a title — it looks like a broken/placeholder card — so
// treat that the same as it being blank and fall back to the description.
function pickBestTitle(linkName, description, store) {
  const nameTrimmed = (linkName || "").trim();
  const isRedundant = !nameTrimmed || nameTrimmed.toLowerCase() === (store || "").trim().toLowerCase();
  if (!isRedundant) return nameTrimmed;
  return description || store;
}

function mapLinkToDeal(link) {
  const rawStore = link["advertiser-name"] || "";
  const store = cleanStoreName(rawStore);
  const description = stripHtmlTags(link.description || link["ad-content"] || "");
  const couponCode = link["coupon-code"];
  const code = couponCode && couponCode.trim() ? couponCode.trim() : null;
  const promotionType = link["promotion-type"];
  let title = cleanTitle(pickBestTitle(link["link-name"], description, rawStore), rawStore);
  title = stripUsPrefix(title);
  title = stripCodeMention(title, code);

  return {
    cjLinkId: String(link["link-id"]),
    title,
    brand: store,
    store,
    category: link.category || "Other",
    discount: deriveDiscount(promotionType, title, description),
    code,
    description,
    expires: parseExpires(link["promotion-end-date"]),
    link: link.clickUrl || link.clickURL,
    emoji: CATEGORY_EMOJI[link.category] || "🏷️",
    logoDomain: extractLogoDomain(link.destination)
  };
}

const RECORDS_PER_PAGE = 100;
const MAX_PAGES = 50; // safety cap — 5,000 links; avoids a runaway loop if total-matched is ever wrong

async function fetchAllCjLinks(token, websiteId) {
  const parser = new XMLParser({ ignoreAttributes: false });
  const allLinks = [];
  let page = 1;
  let totalMatched = Infinity;

  while ((page - 1) * RECORDS_PER_PAGE < totalMatched && page <= MAX_PAGES) {
    const url = `${LINK_SEARCH_URL}?website-id=${encodeURIComponent(websiteId)}&advertiser-ids=joined&records-per-page=${RECORDS_PER_PAGE}&page-number=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`CJ Link Search API returned ${res.status}: ${body.slice(0, 300)}`);
    }

    const linksNode = parser.parse(body)?.["cj-api"]?.links;
    totalMatched = Number(linksNode?.["@_total-matched"] ?? 0);
    let links = linksNode?.link || [];
    if (!Array.isArray(links)) links = [links];
    allLinks.push(...links);
    page++;
  }

  return allLinks;
}

async function fetchCjDeals() {
  const token = process.env.CJ_PERSONAL_ACCESS_TOKEN;
  const websiteId = process.env.CJ_WEBSITE_ID;
  if (!token || !websiteId) {
    throw new Error("CJ_PERSONAL_ACCESS_TOKEN and CJ_WEBSITE_ID must be set in .env to sync from CJ.");
  }

  // CJ only returns 100 links per page and joined advertisers can easily have
  // 1,000+ links between them (mostly banners/product links, not deals) — has
  // to page through everything or real promotions from other advertisers get
  // silently missed once one advertiser's catalog is large.
  const allLinks = await fetchAllCjLinks(token, websiteId);

  // CJ's Link Search returns every link an advertiser has registered — banners,
  // plain product pages, tracking sub-IDs, homepage links — not just discounts.
  // promotion-type is "N/A" (or blank) on all of those; only keep links the
  // advertiser actually tagged as a real promotion.
  return allLinks
    .filter(link => link && (link.clickUrl || link.clickURL) && link.destination)
    .filter(link => link["promotion-type"] && link["promotion-type"] !== "N/A")
    .filter(link => !isNonUsTargeted(link["link-name"] || link.description || ""))
    .map(mapLinkToDeal)
    // A promotion-type tag alone isn't enough — some advertisers (Marmot:
    // 23 of its 28 links) tag plain category/collection pages ("Shop Men's
    // Rain Jackets", "New Minimalist Collection") as promotional even
    // though there's no actual discount or code attached. Without either,
    // it's just a product link, not a deal.
    .filter(d => d.discount || d.code);
}

module.exports = { fetchCjDeals };
