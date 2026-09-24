// Server-rendered deal grid for the homepage.
//
// Everything on the homepage is built client-side from /api/deals, so a
// crawler fetching / saw a headline, a swipe deck and two empty divs: 9KB of
// markup with no deals in it. The per-store pages were the only readable
// pages on the site, and nothing on the homepage linked to them except a
// single /stores hub — so the homepage could never rank for anything but the
// brand name, and passed almost nothing to the pages that could.
//
// The client re-renders this grid the moment /api/deals resolves, so this
// markup only has to be (a) readable by a crawler and (b) close enough to
// what replaces it that there's no visible jump. It deliberately links each
// card to that store's own indexable page rather than to the deal modal:
// that turns the homepage into 42 internal links to the pages that are
// actually trying to rank.
//
// Hard constraint, same as seo.js: NEVER put deal.code in this HTML.

const { escapeHtml, storePath, safeTitle, displayableDeals } = require("./seo");

// Twin of offerLine() in js/app.js — keep them in step. Affiliate titles are
// uneven enough that printing them raw would publish "Winebasket120x600" (a
// banner size) into indexable markup, and a page of those reads exactly like
// the scraped doorway pages this site is trying not to be.
function offerLine(deal) {
  let text = safeTitle(deal).trim();
  if (!text) return "";
  if (/\b\d{2,4}\s*[x×]\s*\d{2,4}\b/.test(text)) return "";

  text = text.replace(/^(service|coupon|deal|offer|promo|sale)\s*[:\-–]\s*/i, "").trim();

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

function discountValue(discount) {
  const match = String(discount || "").match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function logoHtml(deal) {
  const src = deal.logo_url || (deal.logo_domain ? `https://logos.hunter.io/${deal.logo_domain}` : null);
  // No onload/onerror fallback here the way the client has: this markup is
  // replaced as soon as the client renders, and inline handlers in
  // server HTML are worth avoiding.
  if (!src) return escapeHtml(deal.emoji || "");
  return `<img src="${escapeHtml(src)}" alt="" loading="lazy" />`;
}

function cardHtml(deal) {
  const offer = offerLine(deal);
  return `
      <a class="deal-card" href="${escapeHtml(storePath(deal.store))}">
        <div class="deal-brand">
          <div class="deal-emoji">${logoHtml(deal)}</div>
          <div class="deal-brand-text">
            <h3>${escapeHtml(deal.store)}</h3>
            <span class="deal-cat">${escapeHtml(deal.category || "")}</span>
          </div>
        </div>
        <div class="deal-body">
          <div class="deal-hero">${escapeHtml(deal.discount)}</div>
          ${offer ? `<p class="deal-offer">${escapeHtml(offer)}</p>` : ""}
        </div>
        <div class="card-footer">
          <span class="deal-expiry"></span>
          <span class="get-code-btn">Get Code</span>
        </div>
      </a>`;
}

// Deterministic order, unlike the client's shuffle: a crawler that fetches
// the page twice should see the same page, and a stable order is also what
// makes the output cacheable later if it ever needs to be.
function orderedDeals(deals) {
  return displayableDeals(deals).sort(
    (a, b) =>
      discountValue(b.discount) - discountValue(a.discount) ||
      String(a.store).localeCompare(String(b.store)) ||
      String(a.id).localeCompare(String(b.id))
  );
}

const GRID_PLACEHOLDER = '<div class="deal-grid" id="dealGrid"></div>';

// Returns the page unchanged if the placeholder isn't found, so a future edit
// to index.html degrades to today's behaviour rather than serving a broken
// page or throwing on every homepage request.
function injectHomeGrid(html, deals) {
  if (!html.includes(GRID_PLACEHOLDER)) return html;
  const cards = orderedDeals(deals).map(cardHtml).join("\n");
  if (!cards) return html;
  return html.replace(
    GRID_PLACEHOLDER,
    `<div class="deal-grid" id="dealGrid">${cards}\n    </div>`
  );
}

module.exports = { injectHomeGrid, offerLine, orderedDeals };
