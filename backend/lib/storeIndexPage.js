const { escapeHtml, storePath, SITE_ORIGIN, storesFrom } = require("./seo");

function discountValue(discount) {
  return parseFloat(String(discount || "").match(/(\d+(?:\.\d+)?)/)?.[1] || 0);
}

// A directory of every store page, and the reason it exists is crawl
// discovery rather than browsing: the homepage renders its deals client-side
// from /api/deals, so any store link injected there is invisible to a crawler
// that doesn't run JS. This page is served as HTML, is linked from the footer
// of every page on the site, and links to all 28 store pages — which gives a
// crawler a path from the homepage to every one of them in two hops.
function renderStoreIndexPage(deals) {
  const stores = [...storesFrom(deals).entries()]
    .map(([store, storeDeals]) => ({
      store,
      count: storeDeals.length,
      best: storeDeals.map(d => d.discount).sort((a, b) => discountValue(b) - discountValue(a))[0]
    }))
    .sort((a, b) => a.store.localeCompare(b.store));

  const totalDeals = stores.reduce((sum, s) => sum + s.count, 0);
  const title = `All Stores — Coupons & Promo Codes | OfferMeDiscounts`;
  const description = `Browse ${totalDeals} verified offers across ${stores.length} retailers. Every link is checked daily, so expired codes are removed automatically.`;
  const canonical = `${SITE_ORIGIN}/stores`;

  const rows = stores
    .map(
      s => `
      <li class="store-tile">
        <a href="${storePath(s.store)}">
          <span class="store-tile-name">${escapeHtml(s.store)}</span>
          <span class="store-tile-meta">${s.count} offer${s.count === 1 ? "" : "s"}${s.best ? ` &middot; up to ${escapeHtml(s.best)}` : ""}</span>
        </a>
      </li>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${canonical}" />
<meta name="twitter:card" content="summary" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='26' fill='%23ff5d73'/%3E%3Ctext x='50' y='70' font-size='54' font-family='Arial, sans-serif' font-weight='800' fill='%23241f30' text-anchor='middle'%3E%25%3C/text%3E%3C/svg%3E" />
<link rel="stylesheet" href="/css/styles.css" />
</head>
<body>

<header class="site-header">
  <div class="header-inner wrap">
    <a href="/" class="logo"><span class="logo-mark">%</span>Offer<span class="tag">Me</span>Discounts</a>
    <nav class="header-nav">
      <a href="/#browse">Browse Deals</a>
      <a href="/stores">Stores</a>
      <a href="/about.html">About</a>
    </nav>
  </div>
</header>

<main class="wrap seo-page">
  <nav class="seo-crumbs" aria-label="Breadcrumb">
    <a href="/">All deals</a> <span>/</span> <span>Stores</span>
  </nav>

  <h1>All Stores</h1>
  <p class="seo-lede">
    ${totalDeals} active ${totalDeals === 1 ? "offer" : "offers"} across ${stores.length} retailers.
    We follow every link to the retailer's own site each day and drop anything that stops working.
  </p>

  <ul class="store-tiles">
${rows}
  </ul>

  <p class="seo-back"><a href="/">&larr; Browse all deals</a></p>
</main>

<footer class="site-footer">
  <div class="wrap">
    <div>&copy; 2026 OfferMeDiscounts.com</div>
    <div><a href="/stores">All stores</a> &middot; <a href="/about.html">About</a> &middot; <a href="/terms.html">Terms</a> &middot; <a href="/privacy.html">Privacy</a></div>
  </div>
</footer>

</body>
</html>
`;
}

module.exports = { renderStoreIndexPage };
