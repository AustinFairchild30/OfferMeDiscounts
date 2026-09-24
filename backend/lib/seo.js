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
    ...[...byStore.keys()]
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
  safeTitle,
  categoryOf,
  relatedStores,
  findStoreBySlug,
  robotsTxt,
  sitemapXml
};
