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

function mapLinkToDeal(link) {
  const store = link["advertiser-name"] || "";
  const description = link.description || link["ad-content"] || "";
  const couponCode = link["coupon-code"];
  const promotionType = link["promotion-type"];

  return {
    cjLinkId: String(link["link-id"]),
    title: link["link-name"] || description || store,
    brand: store,
    store,
    category: link.category || "Other",
    discount: promotionType && promotionType !== "N/A" ? promotionType : null,
    code: couponCode && couponCode.trim() ? couponCode.trim() : null,
    description,
    expires: parseExpires(link["promotion-end-date"]),
    link: link.clickUrl || link.clickURL,
    emoji: CATEGORY_EMOJI[link.category] || "🏷️"
  };
}

async function fetchCjDeals() {
  const token = process.env.CJ_PERSONAL_ACCESS_TOKEN;
  const websiteId = process.env.CJ_WEBSITE_ID;
  if (!token || !websiteId) {
    throw new Error("CJ_PERSONAL_ACCESS_TOKEN and CJ_WEBSITE_ID must be set in .env to sync from CJ.");
  }

  const url = `${LINK_SEARCH_URL}?website-id=${encodeURIComponent(websiteId)}&advertiser-ids=joined&records-per-page=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`CJ Link Search API returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const parser = new XMLParser();
  const parsed = parser.parse(body);
  let links = parsed?.["cj-api"]?.links?.link || [];
  if (!Array.isArray(links)) links = [links];

  // CJ's Link Search returns every link an advertiser has registered — banners,
  // plain product pages, tracking sub-IDs, homepage links — not just discounts.
  // promotion-type is "N/A" (or blank) on all of those; only keep links the
  // advertiser actually tagged as a real promotion.
  return links
    .filter(link => link && (link.clickUrl || link.clickURL) && link.destination)
    .filter(link => link["promotion-type"] && link["promotion-type"] !== "N/A")
    .map(mapLinkToDeal);
}

module.exports = { fetchCjDeals };
