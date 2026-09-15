// Impact.com — the second affiliate network, alongside CJ.
//
// What live exploration of the real account actually showed, because most of
// it contradicts the published docs and shaped every decision here:
//
//  - /Programs 404s ("No handler found"). Only the LEGACY /Campaigns path
//    works on this account, so that's what this uses.
//  - Deals live on /Ads?Type=COUPON, not on /Deals. Of 498 ads, 446 are
//    banners and 28 are text links pointing at collection pages ("Halloween
//    Collection", "Monthly Best Sellers") — the same category-page-dressed-
//    as-a-promotion pattern that was deliberately excluded from CJ. Only the
//    24 Type=COUPON ads are real offers.
//  - The structured discount fields are essentially unpopulated:
//    DiscountPercent on 2 of 24, DiscountAmount on 1. Advertisers put the
//    offer in free text, so this needs the same text extraction as CJ rather
//    than the clean structured read the docs imply.
//  - Ad.Name is the coupon code for some advertisers ("MAD5", "AV20") and a
//    truncated label for others ("Free Shipping"), so it can only be treated
//    as a code when it looks like one.
//  - EndDate is set on only 6 of 24.
//  - CampaignName is the brand ("Missacc"); AdvertiserName is the legal
//    entity ("Xi'an Zuan Ge La Fu Network Technology Co., Ltd.").

const { deriveDiscount, isNonUsTargeted, stripCodeMention, stripHtmlTags } = require("./cjClient");

function logoDomainFrom(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const BASE = "https://api.impact.com/Mediapartners";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

// Impact gives no expiry on most coupon ads. The schema requires one and the
// grid filters on it, so an open-ended offer gets a far-future sentinel
// rather than an invented date. The daily dead-link check is what actually
// retires these, same as any other deal.
const NO_EXPIRY = "2099-12-31";

function credentials() {
  const sid = process.env.IMPACT_ACCOUNT_SID;
  const token = process.env.IMPACT_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("IMPACT_ACCOUNT_SID and IMPACT_AUTH_TOKEN must be set to sync from Impact.");
  }
  return { sid, auth: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") };
}

async function getJson(path) {
  const { sid, auth } = credentials();
  const res = await fetch(`${BASE}/${sid}${path}`, {
    headers: { Authorization: auth, Accept: "application/json" }
  });
  if (!res.ok) {
    // Never echo the URL — it carries the account id in its path.
    throw new Error(`Impact API ${res.status} on ${path.split("?")[0]}`);
  }
  return res.json();
}

async function getAllPages(path, arrayKey) {
  const joiner = path.includes("?") ? "&" : "?";
  let page = 1;
  let pages = 1;
  const all = [];
  do {
    const body = await getJson(`${path}${joiner}PageSize=${PAGE_SIZE}&Page=${page}`);
    all.push(...(body[arrayKey] || []));
    pages = parseInt(body["@numpages"] || "1", 10);
    page++;
  } while (page <= pages && page <= MAX_PAGES);
  return all;
}

// A code, or a label? "MAD5" and "AV20" are codes; "Free Shipping" and
// "30%off Plus Size Bodysuit..." are not. Codes are short, unspaced and
// carry no sentence punctuation.
function looksLikeCode(value) {
  const v = String(value || "").trim();
  return Boolean(v) && v.length <= 20 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v);
}

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Prefer Impact's structured fields on the rare ads that populate them, then
// fall back to reading the offer out of the text like the CJ client does.
function discountFor(ad) {
  const pct = parseFloat(ad.DiscountPercent);
  if (Number.isFinite(pct) && pct > 0) return `${Math.round(pct)}% OFF`;
  const amt = parseFloat(ad.DiscountAmount);
  if (Number.isFinite(amt) && amt > 0) return `$${Math.round(amt)} OFF`;
  return deriveDiscount(null, ad.Name || "", ad.Description || "");
}

function mapAdToDeal(ad, campaignsById) {
  const campaign = campaignsById.get(String(ad.CampaignId)) || {};
  const store = (ad.CampaignName || campaign.CampaignName || ad.AdvertiserName || "").trim();

  const structuredCode = (ad.DealDefaultPromoCode || "").trim();
  const code = structuredCode || (looksLikeCode(ad.Name) ? String(ad.Name).trim() : null);

  const description = stripHtmlTags(ad.Description || "");
  // Name is often just the code, which makes a useless title — prefer the
  // description and only fall back to Name when there's nothing else.
  let title = description || String(ad.Name || "").trim();
  title = stripCodeMention(title, code);

  return {
    impactAdId: String(ad.Id),
    title: title || store,
    brand: store,
    store,
    category: null, // resolved per-advertiser by the caller
    discount: discountFor(ad),
    code,
    description,
    expires: toIsoDate(ad.EndDate) || NO_EXPIRY,
    link: ad.TrackingLink || null,
    // Impact does expose the brand's own logo at CampaignLogoUri, which would
    // beat Hunter.io's guesswork — but that URL needs the API credentials, so
    // using it means proxying and caching it through our own server. Left as
    // a follow-up; for now the brand's domain feeds the existing Hunter.io
    // path exactly as CJ deals do.
    logoDomain: logoDomainFrom(campaign.CampaignUrl || ad.LandingPageUrl),
    campaignId: String(ad.CampaignId || ""),
    campaignDescription: campaign.CampaignDescription || ""
  };
}

// Impact lists a shipping region per campaign, which is a far better US
// signal than CJ's text-matching guesswork — use it where present.
function shipsToUs(campaign) {
  const regions = campaign?.ShippingRegions;
  if (!regions) return true; // unstated: assume yes, same default as the CJ filter
  const text = Array.isArray(regions) ? regions.join(",") : String(regions);
  return /\bUS\b|UNITEDSTATES/i.test(text);
}

async function fetchImpactDeals() {
  const campaigns = await getAllPages("/Campaigns", "Campaigns");
  const campaignsById = new Map(campaigns.map(c => [String(c.CampaignId), c]));

  const ads = await getAllPages("/Ads?Type=COUPON", "Ads");

  return ads
    .filter(ad => ad && ad.Id && ad.TrackingLink)
    .filter(ad => shipsToUs(campaignsById.get(String(ad.CampaignId))))
    .filter(ad => !isNonUsTargeted(`${ad.Name || ""} ${ad.Description || ""}`))
    .map(ad => mapAdToDeal(ad, campaignsById))
    .filter(d => d.store)
    // Same bar as CJ: a promotional label alone isn't a deal. Without a real
    // discount or a code there's nothing for a visitor to act on.
    .filter(d => d.discount || d.code);
}

// --- Category resolution -------------------------------------------------
// Impact returns no category anywhere, so each advertiser is classified once
// from its own CampaignDescription and cached in advertiser_categories. One
// Haiku call per NEW advertiser, never per deal and never per sync — with 19
// approved brands that's a one-off cost that then stays at zero.
const pool = require("../db/pool");
const { classifyAdvertiser } = require("./claudeClient");
const { CATEGORY_TAGS } = require("./categoryTags");

async function resolveCategories(deals) {
  const { rows } = await pool.query("SELECT advertiser, category FROM advertiser_categories");
  const known = new Map(rows.map(r => [r.advertiser, r.category]));
  const allowed = Object.keys(CATEGORY_TAGS);

  for (const deal of deals) {
    if (known.has(deal.store)) continue;
    let category = "Other";
    try {
      category = await classifyAdvertiser(deal.store, deal.campaignDescription, allowed);
    } catch (err) {
      // A classification failure must not cost us the deal — "Other" still
      // shows, it just lands in the "More" browse group until reclassified.
      console.error(`Could not classify ${deal.store}:`, err.message);
    }
    await pool.query(
      `INSERT INTO advertiser_categories (advertiser, category) VALUES ($1,$2)
       ON CONFLICT (advertiser) DO UPDATE SET category = EXCLUDED.category`,
      [deal.store, category]
    );
    known.set(deal.store, category);
  }

  return deals.map(d => ({ ...d, category: known.get(d.store) || "Other" }));
}

module.exports = { fetchImpactDeals, resolveCategories, looksLikeCode, NO_EXPIRY };
