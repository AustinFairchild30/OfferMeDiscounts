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

// Advertisers whose account name can't be turned into a brand name by rule:
// a domain with no word breaks to recover, or one account covering several
// brands (where picking which one leads is an editorial call, not a regex).
//
// Shared with Impact, which supplies a different flavour of the same problem:
// its CampaignName is whatever the advertiser typed on signup, so it can be
// the registered legal entity in its own language, or the same brand running
// two programs under two spellings. Each entry below was confirmed by
// following the deal's own tracking link to the destination it lands on —
// these are not guesses at what the name might mean.
const STORE_DISPLAY_NAMES = {
  "pinemeadowgolf.com": "Pine Meadow Golf",
  "herbspro.com": "HerbsPro",
  "zinio us": "Zinio",
  "winebasket/babybasket/capalbosonline": "Winebasket",
  "dream pairs, bruno marc, & nortiv 8 shoes": "Dream Pairs",
  // Impact. The first is a legal entity name, not a brand: its links go to
  // yilitehair.com. The next two are one brand with two Impact programs
  // (both land on sizeglasses.com), which otherwise shows as two stores and
  // gets two separate per-advertiser caps.
  "许昌市永传发制品有限公司": "Yilite Hair",
  "size glasses": "SizeGlasses",
  "sizeglasses - creator": "SizeGlasses",
  // Hyphenated region tag the generic rule deliberately won't touch, since
  // it only strips a space-separated "US" (never a word ending in "us").
  "amazon-pioneer camp-us": "Pioneer Camp",
  // Bare domain whose generic .com strip leaves it lowercase.
  "lightsaber.com": "Lightsaber"
};

// CJ's advertiser-name is an account name, not a brand name: it carries the
// affiliate-relationship suffix ("Stylevana Affiliate Program"), bare domains
// ("Monoprice.com"), legal suffixes ("Snaps Clothing Inc."), and region tags
// ("ZINIO US"). Since the card redesign the store name IS the card headline
// (dealCardHTML in js/app.js), so this is the most prominent text on every
// card and has to read as a brand — the title-side cleanup below never
// covered it, because back then the title was the headline.
//
// Note this deliberately takes the RAW advertiser name, not the cleaned one:
// cleanTitle/pickBestTitle compare titles against rawStore, since it's the
// raw name that advertisers repeat inside their own link names.
function cleanStoreName(store) {
  const raw = (store || "").trim();
  if (!raw) return store;

  const named = STORE_DISPLAY_NAMES[raw.toLowerCase()];
  if (named) return named;

  const cleaned = raw
    .replace(/\s*Affiliate\s*(Program)?\s*$/i, "")
    .replace(/,?\s*\b(Inc|LLC|L\.L\.C|Corp|Corporation|Ltd|Co)\b\.?\s*$/i, "")
    .replace(/\s+(US|USA)\s*$/, "") // case-sensitive: only the region tag, never a word ending in "us"
    .replace(/\.(com|net|org)\s*$/i, "")
    .trim();

  return cleaned || raw;
}

// Advertisers we won't carry, whatever the offer is. This isn't a quality
// bar — it's about what this site does with a deal once it has one.
//
// Every offer here can end up in a text message to a verified phone number,
// matched to that person because we inferred they'd want it. That makes a
// deal on sexual-health testing categorically different from a deal on
// vitamins: the match itself asserts something about the recipient, arriving
// unprompted on their phone where someone else may read it. It's also the
// same carrier-compliance risk that kept Joylume off the site — the toll-free
// number is vetted, and SHAFT-adjacent content put through it puts the whole
// messaging channel at risk, not just the one campaign.
//
// Names are matched on the cleaned store name, lowercased and exact. The
// regex is a second pass over the offer text for the same subject matter
// arriving under a different advertiser name; it's deliberately narrow,
// since "wellness" and "health" are ordinary retail categories we do want.
const BLOCKED_ADVERTISERS = new Set(["stdcheck", "stdcheck.com"]);

const BLOCKED_SUBJECT_MATTER =
  /\b(std|sti|hiv|herpes|chlamydia|gonorrhea|syphilis)\b|sexual(ly)?[\s-]?(health|transmitted)|\bviagra\b|\bcialis\b|erectile|\bescort\b/i;

function isBlockedAdvertiser(store, text = "") {
  if (BLOCKED_ADVERTISERS.has(String(store || "").trim().toLowerCase())) return true;
  return BLOCKED_SUBJECT_MATTER.test(String(text || ""));
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

  // Lifting the code out of "…/coupon=SAVE40" or "Code：SAVE40" leaves the
  // separator dangling on the end. Trailing quotes go too, since the code is
  // usually the thing that was quoted.
  return cleaned.replace(/[\s"'“”：:=\-–—,;/|]+$/u, "").trim();
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

// Some advertisers put the code in the offer text and leave the structured
// coupon-code field empty. That's the worst of both worlds: the code is
// readable on the card without verifying, AND there's nothing for the reveal
// step to hand over afterwards, so the gate is bypassed and useless at once.
// Pulling it into the code field fixes both — stripCodeMention then takes it
// back out of the text, and the visitor gets a working code for verifying.
//
// Deliberately conservative. The captured token has to look like a code
// (carry a digit, or be written in caps) and not be an ordinary word that
// happens to follow "code", or this invents codes that don't work.
const CODE_IN_TEXT = /\b(?:coupon|promo|discount)?\s*code\s*[:=]?\s*["'\u201c]?([A-Za-z0-9][A-Za-z0-9_-]{2,19})\b/i;
const NOT_A_CODE = new Set([
  "the", "your", "you", "and", "for", "at", "on", "off", "use", "using", "with",
  "free", "now", "here", "below", "above", "today", "required", "needed", "applies",
  "will", "can", "any", "all", "our", "this", "that", "when", "get", "save", "is",
  "are", "not", "none", "n/a", "na", "auto", "applied", "automatically", "checkout"
]);

function extractCodeFromText(text) {
  const match = CODE_IN_TEXT.exec(String(text || ""));
  if (!match) return null;
  const token = match[1];
  if (NOT_A_CODE.has(token.toLowerCase())) return null;
  // A code is either alphanumeric or shouted. A lowercase all-letters token
  // after "code" is far more likely to be prose than a real coupon.
  const hasDigit = /\d/.test(token);
  const isShouted = token === token.toUpperCase() && /[A-Z]/.test(token);
  if (!hasDigit && !isShouted) return null;
  // A bare number is a quantity ("code 15 off"), not a code.
  if (/^\d+$/.test(token)) return null;
  return token;
}

// Everything that shows advertiser text to someone who hasn't verified goes
// through here: server-rendered pages, their JSON-LD, and the public catalog.
//
// stripCodeMention alone isn't enough, because it has to be told which string
// is the code. Two failure modes get past it: the structured field is empty
// and the code lives only in the text, and — worse — the structured field
// holds a DIFFERENT code than the text does (one deal carries "AFF51" while
// its title reads "Use Code:E51"). So strip the known code first, then keep
// pulling whatever still looks like a code out of the text until nothing
// does. Bounded, and stops early if a pass changes nothing, so a string
// extractCodeFromText keeps matching but stripCodeMention can't remove
// can't spin here.
function redactCodes(text, knownCode) {
  let out = String(text || "");
  if (!out) return out;
  if (knownCode) out = stripCodeMention(out, knownCode);

  for (let i = 0; i < 4; i++) {
    const found = extractCodeFromText(out);
    if (!found) break;
    const next = stripCodeMention(out, found);
    if (next === out) break;
    out = next;
  }

  // Lifting a code out of "Extra 54% OFF (code:E54)" leaves the brackets
  // behind, and those land on a deal tile. Only ever removes a bracket pair
  // that is now empty.
  return out
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}|["\u201c]\s*["\u201d]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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
  const rawDescription = stripHtmlTags(link.description || link["ad-content"] || "");
  const couponCode = link["coupon-code"];
  const code = couponCode && couponCode.trim()
    ? couponCode.trim()
    : extractCodeFromText(`${link["link-name"] || ""} ${rawDescription}`);
  // The description is shown in the deal modal ABOVE the phone gate, so a
  // code left sitting in it is readable without verifying — which is the
  // whole gate, bypassed. This ran on the title only; 21 of 80 coded deals
  // were publishing their code in the description.
  const description = redactCodes(rawDescription, code);
  const promotionType = link["promotion-type"];
  let title = cleanTitle(pickBestTitle(link["link-name"], rawDescription, rawStore), rawStore);
  title = stripUsPrefix(title);
  // redactCodes, not stripCodeMention: an advertiser can write a different
  // code in the text than the one in the structured field, and cleaning only
  // the one we were handed leaves the other sitting in the stored row.
  title = redactCodes(title, code);

  return {
    cjLinkId: String(link["link-id"]),
    title,
    brand: store,
    store,
    category: link.category || "Other",
    discount: deriveDiscount(promotionType, title, rawDescription),
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

// No single advertiser should be allowed to swamp the catalog. The Excellence
// Collection publishes one near-identical link per hotel property and grew to
// 147 deals — 60% of the entire site — against a median of 5 for everyone
// else. Hand-curating that advertiser down worked twice before and was
// outrun both times, so this is the structural version of the same call.
//
// 20 is deliberately generous: with 27 advertisers it allows a catalog of
// ~540, well clear of current volume, so it only ever bites the outliers.
const MAX_DEALS_PER_ADVERTISER = 20;

function discountRank(deal) {
  if (!deal.discount) return -1;              // code-only deals are dropped first
  const n = deal.discount.match(/(\d+(?:\.\d+)?)/);
  return n ? parseFloat(n[1]) : 0;            // "Free Shipping" outranks nothing but null
}

// Advertisers routinely register one link per placement or property that all
// resolve to the same offer — the Excellence Collection had the same "5% OFF
// / VIP5" registered against 15+ hotels. Since a card shows store and
// discount only, those render as identical duplicates (the same way four
// SilverRushStyle "95% OFF" links once filled all four featured slots), and
// the code behind them is literally the same string, so keeping one loses
// the visitor nothing.
//
// Collapsing on (store, discount, code) deliberately does NOT merge offers
// that differ in either field — Stylevana's "20% off for members, 10% off
// for Guest shoppers" is two real, non-interchangeable offers, not a
// duplicate. Ties break toward the latest expiry, then the lowest link-id,
// so the survivor is the same one on every sync.
// Both tie-breakers below need a per-deal id that's stable between syncs, and
// the two networks name theirs differently. Falling back to the tracking link
// keeps the ordering deterministic even for a deal carrying neither.
function sourceId(deal) {
  return String(deal.cjLinkId ?? deal.impactAdId ?? deal.link ?? "");
}

function dedupeIdenticalOffers(deals) {
  const best = new Map();
  for (const deal of deals) {
    const key = `${deal.store}\u0000${deal.discount || ""}\u0000${deal.code || ""}`;
    const held = best.get(key);
    if (!held) {
      best.set(key, deal);
      continue;
    }
    const better =
      String(deal.expires || "").localeCompare(String(held.expires || "")) ||
      sourceId(held).localeCompare(sourceId(deal));
    if (better > 0) best.set(key, deal);
  }
  return [...best.values()];
}

// Which deals survive the cap is decided deterministically — real discount
// first, then size of discount, then link-id — rather than by taking the
// first N in CJ's order. CJ's ordering isn't stable between syncs, so an
// order-dependent rule would keep a different subset each day and leave the
// previous day's picks stranded in the table as orphans.
function capPerAdvertiser(deals) {
  const byStore = new Map();
  for (const deal of deals) {
    if (!byStore.has(deal.store)) byStore.set(deal.store, []);
    byStore.get(deal.store).push(deal);
  }

  const kept = [];
  for (const list of byStore.values()) {
    list.sort((a, b) =>
      discountRank(b) - discountRank(a) ||
      sourceId(a).localeCompare(sourceId(b))
    );
    kept.push(...list.slice(0, MAX_DEALS_PER_ADVERTISER));
  }
  return kept;
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
  const deals = allLinks
    .filter(link => link && (link.clickUrl || link.clickURL) && link.destination)
    .filter(link => link["promotion-type"] && link["promotion-type"] !== "N/A")
    .filter(link => !isNonUsTargeted(link["link-name"] || link.description || ""))
    .map(mapLinkToDeal)
    // A promotion-type tag alone isn't enough — some advertisers (Marmot:
    // 23 of its 28 links) tag plain category/collection pages ("Shop Men's
    // Rain Jackets", "New Minimalist Collection") as promotional even
    // though there's no actual discount or code attached. Without either,
    // it's just a product link, not a deal.
    .filter(d => d.discount || d.code)
    .filter(d => !isBlockedAdvertiser(d.store, `${d.title} ${d.description}`));

  // ...then collapse links that are the same offer wearing different
  // link-ids, and stop any one advertiser owning the catalog. See above.
  return capPerAdvertiser(dedupeIdenticalOffers(deals));
}

// Shared with impactClient.js — the two networks differ in how they deliver
// data but need identical judgement about what counts as a real offer, so
// the text-extraction and filtering helpers live here and are reused rather
// than reimplemented per network.
module.exports = {
  fetchCjDeals,
  deriveDiscount,
  isNonUsTargeted,
  stripCodeMention,
  stripHtmlTags,
  cleanStoreName,
  extractCodeFromText,
  redactCodes,
  dedupeIdenticalOffers,
  capPerAdvertiser,
  isBlockedAdvertiser,
  BLOCKED_ADVERTISERS
};
