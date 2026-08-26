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

function mapLinkToDeal(link) {
  const store = link["advertiser-name"] || "";
  const description = link.description || link["ad-content"] || "";
  const couponCode = link["coupon-code"];
  const promotionType = link["promotion-type"];
  const title = cleanTitle(link["link-name"] || description || store, store);

  return {
    cjLinkId: String(link["link-id"]),
    title,
    brand: store,
    store,
    category: link.category || "Other",
    discount: deriveDiscount(promotionType, title, description),
    code: couponCode && couponCode.trim() ? couponCode.trim() : null,
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
    .map(mapLinkToDeal);
}

module.exports = { fetchCjDeals };
