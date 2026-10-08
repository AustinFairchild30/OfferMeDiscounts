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

  // Affiliate creatives arrive as filenames — "CMH_20%_728X90",
  // "...Mujeres)_970x250". Underscore is a word character, so every \b in the
  // checks below silently fails against them, and the underscores themselves
  // survive the punctuation strip and pad the residue over its threshold.
  // Treating them as separators first fixes both.
  text = text.replace(/_+/g, " ").replace(/\s{2,}/g, " ").trim();

  // Case-insensitive: the banner sizes are written 728X90 as often as 728x90.
  if (/\b\d{2,4}\s*[x×]\s*\d{2,4}\b/i.test(text)) return "";

  // Affiliate link names are stacked prefixes — "Miles District - Text Link -
  // 10% Off First Order" carries the store name (already the card's heading)
  // and the link type (ours to know, not the visitor's to read). Peeled in a
  // loop because stripping one exposes the next, and a single pass in any
  // fixed order leaves whichever came second.
  const LEAD_NOISE = /^(service|coupon|deal|offer|promo|sale|text link|text ad|banner|logo|homepage|generic)\s*[:\-–|]\s*/i;
  const storePrefix = deal.store
    ? new RegExp(`^${String(deal.store).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\-–|]\\s*`, "i")
    : null;

  for (let i = 0; i < 4; i++) {
    const before = text;
    text = text.replace(LEAD_NOISE, "").trim();
    if (storePrefix) text = text.replace(storePrefix, "").trim();
    if (text === before) break;
  }

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

// Twin of discountTier() in js/app.js.
function discountTier(discount) {
  const text = String(discount || "");
  const pct = text.includes("%") ? parseFloat(text.match(/(\d+(?:\.\d+)?)/)?.[1] || 0) : 0;
  const dollars = text.startsWith("$") ? parseFloat(text.match(/(\d+(?:\.\d+)?)/)?.[1] || 0) : 0;
  return pct >= 50 || dollars >= 50 ? " strong" : "";
}

// Twin of isNewDeal() in js/app.js. The server has no expiry label to defer
// to — it renders the slot empty and lets the client fill it on hydration —
// so this is the only thing that can appear here before JS runs.
const NEW_WINDOW_DAYS = 7;
function isNewDeal(deal) {
  const raw = deal.createdAt || deal.created_at;
  if (!raw) return false;
  const added = new Date(raw);
  if (Number.isNaN(added.getTime())) return false;
  return (Date.now() - added.getTime()) / 86400000 <= NEW_WINDOW_DAYS;
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
          <div class="deal-hero${discountTier(deal.discount)}">${escapeHtml(deal.discount)}</div>
          ${offer ? `<p class="deal-offer">${escapeHtml(offer)}</p>` : ""}
        </div>
        <div class="card-footer">
          <span class="deal-expiry${isNewDeal(deal) ? " fresh" : ""}">${isNewDeal(deal) ? "New this week" : ""}</span>
          <span class="get-code-btn">${deal.code ? "Get Code" : "Get Deal"}</span>
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
