// Server-rendered browse-group pages: /tech-deals, /pets-deals, and so on.
//
// Store pages were the only indexable surface, and they're capped by the
// catalog — a store needs two live offers to be worth indexing, which 33 of
// 57 manage. Google has already indexed essentially all of them, so coverage
// stopped being the constraint and page count became it.
//
// Group pages also aim at queries that exist. "Stirlingkit coupons" is
// searched by almost nobody; "pet supply coupons" and "laser cutter deals"
// are searched constantly. A group page can rank for the second kind without
// needing a brand anyone has heard of.
//
// Hard constraint, same as every other server-rendered page: NEVER put
// deal.code in this HTML.

const {
  escapeHtml, storePath, groupPath, offerLine, SITE_ORIGIN
} = require("./seo");
const { labelForCategory } = require("./categoryTags");
const { currentMonthYear } = require("./storePage");

function discountValue(discount) {
  const match = String(discount || "").match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

// Grouped by store rather than listed flat: on a group page the useful unit
// is "which brands are here", and 49 ungrouped rows reads as a dump.
function storesIn(deals) {
  const byStore = new Map();
  for (const deal of deals) {
    if (!byStore.has(deal.store)) byStore.set(deal.store, []);
    byStore.get(deal.store).push(deal);
  }
  return [...byStore.entries()]
    .map(([store, list]) => ({
      store,
      deals: list.sort((a, b) => discountValue(b.discount) - discountValue(a.discount)),
      best: Math.max(...list.map(d => discountValue(d.discount)))
    }))
    .sort((a, b) => b.deals.length - a.deals.length || b.best - a.best);
}

function storeBlock({ store, deals }) {
  const rows = deals
    .slice(0, 4)
    .map(
      deal => `
        <li class="seo-deal">
          <div class="seo-deal-badge">${escapeHtml(deal.discount)}</div>
          <div class="seo-deal-body">
            <h3>${escapeHtml(offerLine(deal) || `${deal.discount} at ${store}`)}</h3>
            <p class="seo-deal-meta">${deal.code ? "Coupon code" : "Deal"}${deal.category ? ` &middot; ${escapeHtml(labelForCategory(deal.category))}` : ""}</p>
          </div>
          <a class="seo-deal-cta" href="/?deal=${encodeURIComponent(deal.id)}">${deal.code ? "Get code" : "Get deal"}</a>
        </li>`
    )
    .join("\n");

  const more = deals.length > 4
    ? `<p class="seo-group-more"><a href="${storePath(store)}">All ${deals.length} ${escapeHtml(store)} offers &rarr;</a></p>`
    : `<p class="seo-group-more"><a href="${storePath(store)}">${escapeHtml(store)} coupon page &rarr;</a></p>`;

  return `
  <section class="seo-group-store">
    <h2>${escapeHtml(store)}</h2>
    <ul class="seo-deal-list">
${rows}
    </ul>
    ${more}
  </section>`;
}

function renderGroupPage(group, deals, otherGroups = []) {
  const monthYear = currentMonthYear();
  const stores = storesIn(deals);
  const best = deals
    .map(d => ({ d, n: discountValue(d.discount) }))
    .sort((a, b) => b.n - a.n)[0];
  const bestLabel = best && best.n ? best.d.discount : null;

  const title = `${group} Coupons & Deals — ${monthYear} | OfferMeDiscounts`;
  const description =
    `${deals.length} verified ${group.toLowerCase()} offers from ${stores.length} ` +
    `${stores.length === 1 ? "retailer" : "retailers"} for ${monthYear}` +
    (bestLabel ? `, up to ${bestLabel.replace(/\s*OFF\s*$/i, "")} off` : "") +
    `. Every link is checked daily, so expired codes are removed automatically.`;
  const canonical = `${SITE_ORIGIN}${groupPath(group)}`;

  // Takes [group, deals] pairs so the count is real rather than a promise the
  // linked page might not keep.
  const siblings = otherGroups
    .filter(([g]) => g !== group)
    .map(([g, gDeals]) =>
      `<li><a href="${groupPath(g)}">${escapeHtml(g)} deals</a> <span>${gDeals.length} ${gDeals.length === 1 ? "offer" : "offers"}</span></li>`)
    .join("\n      ");

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
    <a href="/">All deals</a> <span>/</span> <span>${escapeHtml(group)}</span>
  </nav>

  <h1>${escapeHtml(group)} Coupons &amp; Deals</h1>
  <p class="seo-lede">
    ${deals.length} active ${group.toLowerCase()} ${deals.length === 1 ? "offer" : "offers"} from
    ${stores.length} ${stores.length === 1 ? "retailer" : "retailers"} for ${monthYear}${bestLabel ? `, the best worth ${escapeHtml(bestLabel)}` : ""}.
    We follow every link to the retailer's own site each day and drop anything that stops working,
    so you shouldn't hit a dead code here.
  </p>

${stores.map(storeBlock).join("\n")}

  <section class="seo-note">
    <h2>How the codes work</h2>
    <p>
      Pick an offer and tap Get code. We'll text it to you after a one-time
      verification, which is how we keep the codes working instead of letting them get
      scraped and burnt out. No account, and you can reply STOP at any time.
    </p>
  </section>
${siblings ? `
  <section class="seo-related">
    <h2>Other categories</h2>
    <ul class="seo-related-list">
      ${siblings}
    </ul>
  </section>` : ""}

  <p class="seo-back"><a href="/stores">&larr; All stores</a> &middot; <a href="/">Browse all deals</a></p>
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

module.exports = { renderGroupPage };
