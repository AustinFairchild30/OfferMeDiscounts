const { escapeHtml, storePath, SITE_ORIGIN } = require("./seo");

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function currentMonthYear() {
  const now = new Date();
  return `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

function formatExpiry(iso) {
  const dt = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[dt.getUTCMonth()].slice(0, 3)} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
}

// Google shows these as rich results for coupon queries, which is most of
// the reason to bother with a per-store page at all. Deliberately omits any
// coupon code — the markup is as public as the rest of the page.
function offerJsonLd(store, deals) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${store} coupons and promo codes`,
    numberOfItems: deals.length,
    itemListElement: deals.map((deal, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Offer",
        name: deal.title,
        description: deal.discount,
        seller: { "@type": "Organization", name: store },
        availabilityEnds: deal.expires,
        url: `${SITE_ORIGIN}${storePath(store)}`
      }
    }))
  });
}

function dealRow(deal) {
  const badge = escapeHtml(deal.discount);
  const title = escapeHtml(deal.title);
  // The "Get Code" link carries the deal id so the homepage can open straight
  // to this offer's gate. Never the code itself.
  return `
    <li class="seo-deal">
      <div class="seo-deal-badge">${badge}</div>
      <div class="seo-deal-body">
        <h3>${title}</h3>
        <p class="seo-deal-meta">
          ${deal.code ? "Coupon code" : "Deal"} &middot; expires ${formatExpiry(deal.expires)}
        </p>
      </div>
      <a class="seo-deal-cta" href="/?deal=${encodeURIComponent(deal.id)}">
        ${deal.code ? "Get code" : "Get deal"}
      </a>
    </li>`;
}

function renderStorePage(store, deals) {
  const monthYear = currentMonthYear();
  const count = deals.length;
  const best = deals
    .map(d => ({ d, n: parseFloat((d.discount || "").match(/(\d+(?:\.\d+)?)/)?.[1] || 0) }))
    .sort((a, b) => b.n - a.n)[0];
  const bestLabel = best && best.n ? best.d.discount : null;

  const title = `${store} Coupons & Promo Codes — ${monthYear} | OfferMeDiscounts`;
  const description =
    `${count} verified ${store} ${count === 1 ? "offer" : "offers"} for ${monthYear}` +
    (bestLabel ? `, up to ${bestLabel.replace(/\s*OFF\s*$/i, "")} off` : "") +
    `. Every link is checked daily, so expired codes are removed automatically.`;
  const canonical = `${SITE_ORIGIN}${storePath(store)}`;

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
<script type="application/ld+json">${offerJsonLd(store, deals)}</script>
</head>
<body>

<header class="site-header">
  <div class="header-inner wrap">
    <a href="/" class="logo"><span class="logo-mark">%</span>Offer<span class="tag">Me</span>Discounts</a>
    <nav class="header-nav">
      <a href="/#browse">Browse Deals</a>
      <a href="/about.html">About</a>
    </nav>
  </div>
</header>

<main class="wrap seo-page">
  <nav class="seo-crumbs" aria-label="Breadcrumb">
    <a href="/">All deals</a> <span>/</span> <span>${escapeHtml(store)}</span>
  </nav>

  <h1>${escapeHtml(store)} Coupons &amp; Promo Codes</h1>
  <p class="seo-lede">
    ${count} active ${count === 1 ? "offer" : "offers"} for ${monthYear}${bestLabel ? `, the best worth ${escapeHtml(bestLabel)}` : ""}.
    We follow every link to ${escapeHtml(store)}'s own site each day and drop anything that stops working,
    so you shouldn't hit a dead code here.
  </p>

  <ul class="seo-deal-list">
    ${deals.map(dealRow).join("\n")}
  </ul>

  <section class="seo-note">
    <h2>How to use a ${escapeHtml(store)} code</h2>
    <p>
      Pick an offer above and tap Get code. We'll text it to you after a one-time
      verification, which is how we keep the codes working instead of letting them get
      scraped and burnt out. No account, and you can reply STOP at any time.
    </p>
  </section>

  <p class="seo-back"><a href="/">&larr; Browse all deals</a></p>
</main>

<footer class="site-footer">
  <div class="wrap">
    <div>&copy; 2026 OfferMeDiscounts.com</div>
    <div><a href="/about.html">About</a> &middot; <a href="/terms.html">Terms</a> &middot; <a href="/privacy.html">Privacy</a></div>
  </div>
</footer>

</body>
</html>
`;
}

module.exports = { renderStorePage, currentMonthYear };
