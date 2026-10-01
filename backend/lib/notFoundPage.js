// The 404 page.
//
// Express's default is a bare `Cannot GET /stdcheck-coupons` on a white page,
// which is what Google was sending people to: two of the seven URLs it had
// indexed were store pages that had since been removed — one of them the
// advertiser we deliberately blocked.
//
// This is a real 404 rather than a redirect to /stores, which is the opposite
// of what it looks like it should be. Redirecting would keep a dead URL alive
// in the index and risk Google continuing to show "STDCheck Coupons —
// OfferMeDiscounts" in results, pointing at the store directory. A 404 is how
// you tell a search engine the page is gone and have it dropped. The page
// still has to be useful to the person who clicked that stale result, so it
// carries the search box and the routes back into the catalog.

const { escapeHtml, SITE_ORIGIN } = require("./seo");

function renderNotFoundPage(requestedPath = "") {
  // Shown back to the visitor, so it is escaped — the path is attacker-
  // controlled in the sense that anyone can request anything.
  const shown = escapeHtml(String(requestedPath).slice(0, 80));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Page not found — OfferMeDiscounts</title>
<meta name="robots" content="noindex" />
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
  <h1>That page isn't here</h1>
  <p class="seo-lede">
    ${shown ? `We don't have anything at <code>${shown}</code>.` : "We couldn't find that page."}
    If you followed a link to a store's coupons, that retailer's offers have probably
    expired since — we remove deals rather than leave dead codes up, so pages come and
    go with the catalog.
  </p>

  <section class="seo-note">
    <h2>Where to go next</h2>
    <p>
      <a href="/stores">Browse all stores</a> &middot;
      <a href="/#browse">See every current deal</a> &middot;
      <a href="/">Start from the top</a>
    </p>
  </section>

  <p class="seo-back"><a href="/">&larr; Back to all deals</a></p>
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

module.exports = { renderNotFoundPage, SITE_ORIGIN };
