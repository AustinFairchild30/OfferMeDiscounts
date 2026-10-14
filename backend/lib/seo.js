// Server-rendered, crawlable pages. Everything on this site is client-
// rendered from /api/deals, so a search engine fetching the homepage sees a
// headline and a set of empty divs — no deals, nothing to index, nothing to
// rank. That closes off the one acquisition channel that suits a small
// catalog: you don't need a thousand deals to rank for "pine meadow golf
// promo code", you need one deal on a page a crawler can read.
//
// Hard constraint throughout: NEVER put deal.code in this HTML. The SMS gate
// is the entire business model, and a code sitting in server-rendered markup
// is a code Google will happily index and hand out for free.

// The apex 301-redirects to www, so www is the host that actually returns
// 200. Canonicals and sitemap entries have to name that host: pointing them
// at the apex means every sitemap URL is a redirect, and every page's
// canonical names a URL that redirects away from the page declaring it.
// Overridable so a future move back to the apex is one env var, not a code change.
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://www.offermediscounts.com";

function escapeHtml(str) {
  return String(str == null ? "" : str).replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// "Peet's Coffee" -> "peets-coffee", "Winebasket" -> "winebasket".
function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// "brand + coupons" is the query people actually type, so the slug carries
// the intent word rather than sitting at a bare /stylevana.
function storePath(store) {
  return `/${slugify(store)}-coupons`;
}

// The one rule this whole module exists under is that no coupon code reaches
// server-rendered HTML. stripCodeMention alone doesn't achieve that: it needs
// to be told which string is the code, and some advertisers write the code
// into the title while leaving the structured field empty — so deal.code is
// null and the title says "52% Off For All Product Code:E52".
//
// Those titles were being printed verbatim into store pages and their
// JSON-LD. Recovering the code from the text first is what makes the strip
// work on them. Everything that renders a title for a crawler goes through
// here.
const { redactCodes } = require("./cjClient");

function safeTitle(deal) {
  return redactCodes(deal.title, deal.code);
}

// Affiliate titles are link names, not offer descriptions. CJ in particular
// hands back the name of the creative — "17% Off Text Link", "Shop Quickbooks
// and Save! banner image", "25% Office Banner link" — which is internal
// plumbing a visitor has no use for and a crawler reads as a scraped feed.
// There were 12 of these in a 212-deal catalog, 11 of them from one
// advertiser, and they clustered at the top of the new category pages.
//
// Shared with the homepage grid (backend/lib/homePage.js) and twinned in
// js/app.js — keep the three in step.
function offerLine(deal) {
  let text = safeTitle(deal).trim();
  if (!text) return "";

  // Creatives arrive as filenames — "CMH_20%_728X90", "...Mujeres)_970x250".
  // Underscore is a word character, so every \b below silently fails against
  // them, and the underscores survive the punctuation strip and pad the
  // residue over its threshold. Treating them as separators fixes both.
  text = text.replace(/_+/g, " ").replace(/\s{2,}/g, " ").trim();

  // Case-insensitive: the banner sizes are written 728X90 as often as 728x90.
  if (/\b\d{2,4}\s*[x×]\s*\d{2,4}\b/i.test(text)) return "";

  // Creative-type words, wherever they appear rather than only at the front:
  // "text link coupon code" puts them in the middle. The list is explicit
  // because the single word "link" is a legitimate part of a product name and
  // stripping it alone would damage real titles.
  text = text
    .replace(/\b(?:text|banner|display|image|logo|email)\s*(?:link|banner|image|ad|sale)\b/gi, " ")
    // DirectDeals suffixes its creative names with OPC. Hardcoded because it
    // is one advertiser's internal tag, not a general pattern worth guessing.
    .replace(/\bOPC\b/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Affiliate link names are stacked prefixes — "Miles District - Text Link -
  // 10% Off First Order" carries the store name (already the heading) and the
  // link type. Peeled in a loop because stripping one exposes the next, and a
  // single pass in any fixed order leaves whichever came second.
  const LEAD_NOISE = /^(service|coupon|deal|offer|promo|sale|text link|text ad|banner|logo|homepage|generic)\s*[:\-–|]\s*/i;
  const storePrefix = deal.store
    ? new RegExp(`^${String(deal.store).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\-–|]\\s*`, "i")
    : null;

  for (let i = 0; i < 4; i++) {
    const before = text;
    text = text.replace(LEAD_NOISE, "").trim();
    if (storePrefix) text = text.replace(storePrefix, "").trim();
    // "...sale - 20% coupon code" — true of every offer here and stated by
    // the row's own label, so it adds nothing at the end of a title.
    // The modifiers go with it: "Exclusive AWIN Code" and "New 15% OFF
    // Affiliate Code" otherwise strip back to a dangling adjective.
    text = text.replace(
      /[\s\-–—|:,]*\b(?:(?:exclusive|affiliate|discount|coupon|promo|voucher|awin|special|unique|secret)\s+)*(?:coupon|promo|discount|voucher)?\s*codes?\s*$/i,
      ""
    ).trim();
    // And the preposition the code hung off: "...Off with" reads as truncated.
    text = text.replace(/\s+\b(with|using|via|at|on|for|and|the|your)\b\s*$/i, "").trim();
    text = text.replace(/^[\s\-–—|:•]+/, "").replace(/[\s\-–—|:,]+$/, "").trim();
    if (text === before) break;
  }

  // What's left once the words every offer shares are removed. A title that
  // reduces to nothing was never describing this offer — "17% Off Text Link"
  // becomes "17% Off", which the badge beside it already says, and which in
  // that particular row contradicted it (the badge read 25%).
  const residue = text
    .toLowerCase()
    .split(String(deal.store || "").toLowerCase()).join(" ")
    .replace(/\b(coupon|code|deal|offer|promo|sale|service|off|save|get|at|on|the|your|for|a|an|with|up|to)\b/g, " ")
    .replace(/[\d%$.,:\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (residue.length < 4) return "";

  return text;
}

// A store page with one offer is a headline, a single row and the same
// boilerplate as 41 others — 16 of 42 stores are in that state right now.
// A set of near-identical thin pages is what Google's thin-content handling
// is built to catch, and the risk isn't that they rank badly on their own:
// it's that they drag on how the site is judged as a whole, including the
// pages that do have something to say.
//
// So they stay noindex until a store has two offers, and stay out of the
// sitemap while they are. They remain fully browsable and linked — this is
// about what a crawler is asked to index, not about hiding anything from a
// visitor. The moment a store gains a second deal it becomes indexable and
// enters the sitemap on the next build, with no intervention.
const MIN_DEALS_TO_INDEX = 2;

function isIndexableStore(storeDeals) {
  return (storeDeals || []).length >= MIN_DEALS_TO_INDEX;
}

// Browse groups as their own pages. Store pages are capped by the catalog —
// only 33 stores have the two offers needed to be worth indexing — and
// coverage of those is already complete, so the group pages are the next
// surface worth having. They also target queries people actually type: nobody
// searches "Stirlingkit coupons", plenty search "pet supply coupons".
function groupPath(group) {
  return `/${slugify(group)}-deals`;
}

function groupsFrom(deals) {
  const { groupForCategory } = require("./categoryTags");
  const byGroup = new Map();
  for (const deal of displayableDeals(deals)) {
    const group = groupForCategory(deal.category);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(deal);
  }
  return byGroup;
}

// Same bar as a store page, and for the same reason: a group holding one or
// two offers is a thin page, and a wall of them is what thin-content handling
// is built to catch.
const MIN_DEALS_TO_INDEX_GROUP = 4;
// And more than one retailer. A group whose every offer comes from a single
// store is that store's page with a different heading — Food & Drink was
// exactly this, four offers all from one advertiser — and two URLs carrying
// the same offers compete with each other rather than adding reach.
const MIN_STORES_TO_INDEX_GROUP = 2;

// The one list of groups that get a page, used by the route, the sitemap and
// every internal link, so none of them can disagree about what exists. "More"
// is excluded on purpose: it's the catch-all for categories no group claims,
// which makes it the one group whose contents have nothing in common — the
// exact shape of a page worth nothing to a visitor or a crawler.
function indexableGroups(deals) {
  return [...groupsFrom(deals).entries()]
    .filter(([group, groupDeals]) =>
      group !== "More" &&
      groupDeals.length >= MIN_DEALS_TO_INDEX_GROUP &&
      new Set(groupDeals.map(d => d.store)).size >= MIN_STORES_TO_INDEX_GROUP)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function findGroupBySlug(deals, slug) {
  for (const [group, groupDeals] of indexableGroups(deals)) {
    if (slugify(group) === slug) return { group, deals: groupDeals };
  }
  return null;
}

function displayableDeals(deals) {
  const today = new Date().toISOString().slice(0, 10);
  return deals.filter(d => d.discount && d.expires >= today);
}

function storesFrom(deals) {
  const byStore = new Map();
  for (const deal of displayableDeals(deals)) {
    if (!byStore.has(deal.store)) byStore.set(deal.store, []);
    byStore.get(deal.store).push(deal);
  }
  return byStore;
}

// A store's category, decided by what most of its deals say rather than by
// whichever one happens to sort first — advertisers aren't consistent, and
// the whole point here is to group stores a visitor would consider together.
function categoryOf(storeDeals) {
  const counts = new Map();
  for (const deal of storeDeals) {
    const key = deal.category || "Other";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Other";
}

// Stores worth linking to from a given store's page. Same category first,
// since that's the genuinely related set; topped up with the largest other
// stores when a category is too small to fill the row, because a "related"
// block with one entry in it looks broken and passes almost nothing on.
//
// Sorted by deal count so the links point at the pages with the most to
// index, and capped so the block stays a recommendation rather than a
// second copy of /stores on every page.
function relatedStores(deals, store, limit = 6) {
  const byStore = storesFrom(deals);
  const target = byStore.get(store);
  if (!target) return { stores: [], heading: "" };

  const targetCategory = categoryOf(target);
  const others = [...byStore.entries()]
    .filter(([name]) => name !== store)
    .map(([name, storeDeals]) => ({
      store: name,
      count: storeDeals.length,
      category: categoryOf(storeDeals)
    }));

  const rank = (a, b) => b.count - a.count || a.store.localeCompare(b.store);
  const sameCategory = others.filter(o => o.category === targetCategory).sort(rank);

  // Two or more genuine siblings is enough to stand on its own, and the
  // heading can then name the category. Below that, mixing in the biggest
  // unrelated stores to pad the row would put Peet's Coffee under "more
  // stores like this" on a K-beauty page — a claim the page can't support.
  // Link to them anyway, since the crawl path is worth having, but say what
  // they actually are.
  if (sameCategory.length >= 2) {
    return { stores: sameCategory.slice(0, limit), heading: `More ${targetCategory} stores` };
  }

  const filler = others.filter(o => o.category !== targetCategory).sort(rank);
  return {
    stores: [...sameCategory, ...filler].slice(0, limit),
    heading: "Other stores on OfferMeDiscounts"
  };
}

function findStoreBySlug(deals, slug) {
  for (const [store, storeDeals] of storesFrom(deals)) {
    if (slugify(store) === slug) return { store, deals: storeDeals };
  }
  return null;
}

function robotsTxt() {
  return [
    "User-agent: *",
    "Allow: /",
    // No value in crawling these, and the admin pages shouldn't be in an index.
    "Disallow: /admin.html",
    "Disallow: /admin-login.html",
    "Disallow: /api/",
    "",
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    ""
  ].join("\n");
}

// Generated from the live catalog rather than kept as a static file, so a
// store that arrives in tomorrow's CJ sync is in the sitemap tomorrow
// instead of whenever someone remembers to regenerate it.
function lastModOf(deals) {
  const times = deals.map(d => d.updatedAt).filter(Boolean).map(t => new Date(t).getTime());
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString().slice(0, 10);
}

function sitemapXml(deals) {
  const byStore = storesFrom(deals);
  const allLive = [...byStore.values()].flat();

  const urls = [
    // The homepage and the hub genuinely change whenever any deal does.
    { loc: "/", priority: "1.0", changefreq: "daily", lastmod: lastModOf(allLive) },
    { loc: "/stores", priority: "0.9", changefreq: "daily", lastmod: lastModOf(allLive) },
    // No lastmod on static pages rather than a made-up one: omitting the
    // field is honest, and an inaccurate one is worse than none — Google
    // only trusts lastmod when it's consistently accurate.
    { loc: "/about.html", priority: "0.5", changefreq: "monthly", lastmod: null },
    // Submitting a noindex URL in a sitemap asks a crawler to fetch a page
    // and then tells it not to index what it fetched. Leave them out.
    ...indexableGroups(deals)
      .map(([group, groupDeals]) => ({
        loc: groupPath(group),
        priority: "0.85",
        changefreq: "daily",
        lastmod: lastModOf(groupDeals)
      })),
    ...[...byStore.keys()]
      .filter(store => isIndexableStore(byStore.get(store)))
      .sort()
      .map(store => ({
        loc: storePath(store),
        priority: "0.8",
        changefreq: "daily",
        lastmod: lastModOf(byStore.get(store))
      }))
  ];

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        u =>
          "  <url>\n" +
          `    <loc>${SITE_ORIGIN}${u.loc}</loc>\n` +
          (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : "") +
          `    <changefreq>${u.changefreq}</changefreq>\n` +
          `    <priority>${u.priority}</priority>\n` +
          "  </url>"
      )
      .join("\n") +
    "\n</urlset>\n"
  );
}

module.exports = {
  SITE_ORIGIN,
  escapeHtml,
  slugify,
  storePath,
  displayableDeals,
  storesFrom,
  isIndexableStore,
  MIN_DEALS_TO_INDEX,
  safeTitle,
  offerLine,
  categoryOf,
  relatedStores,
  findStoreBySlug,
  groupPath,
  groupsFrom,
  indexableGroups,
  findGroupBySlug,
  MIN_DEALS_TO_INDEX_GROUP,
  MIN_STORES_TO_INDEX_GROUP,
  robotsTxt,
  sitemapXml
};
