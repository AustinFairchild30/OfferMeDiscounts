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
function sitemapXml(deals) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: "/", priority: "1.0", changefreq: "daily" },
    { loc: "/about.html", priority: "0.5", changefreq: "monthly" },
    ...[...storesFrom(deals).keys()]
      .sort()
      .map(store => ({ loc: storePath(store), priority: "0.8", changefreq: "daily" }))
  ];

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        u =>
          "  <url>\n" +
          `    <loc>${SITE_ORIGIN}${u.loc}</loc>\n` +
          `    <lastmod>${today}</lastmod>\n` +
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
  findStoreBySlug,
  robotsTxt,
  sitemapXml
};
