// OfferMeDiscounts.com front-end logic. No build step — plain scripts
// against the Express/Postgres backend in backend/.
// The SMS registration/unlock flow below is real, not a simulation: it
// sends genuine one-time passcodes through Twilio Verify from a
// carrier-approved toll-free number, and deals come from live CJ
// Affiliate partnerships. See backend/README.md for the server side.

const STORAGE_KEY = "omd_registered_phone";
const UNLOCKED_KEY = "omd_unlocked_deals";

/* ---------------- Funnel tracking ---------------- */

// First-party only: an anonymous id in this browser plus whatever campaign
// brought the visitor here, posted to our own /api/track. No third-party
// tag, no cross-site identifier, nothing that needs a consent banner.
// This exists because the roadmap's four V1 success metrics — CPA, SMS CTR,
// redemption, site conversion/ROAS — were all unmeasurable: the only thing
// recorded was a copy event, and only for people who had already registered,
// which is precisely the group whose behaviour was never in question.
const VISITOR_KEY = "omd_visitor_id";
const ATTRIBUTION_KEY = "omd_first_touch";

function getVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9-]/g, "");
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return null; // private mode with storage blocked — just don't track
  }
}

// First touch, not last: whatever campaign first brought someone here is
// what earned the conversion, even if they come back later by typing the
// URL. Stored once and replayed on every subsequent event.
function getAttribution() {
  try {
    const stored = localStorage.getItem(ATTRIBUTION_KEY);
    if (stored) return JSON.parse(stored);

    const params = new URLSearchParams(location.search);
    const referrerHost = document.referrer && !document.referrer.includes(location.host)
      ? new URL(document.referrer).hostname
      : null;

    const touch = {
      source: params.get("utm_source") || referrerHost || "direct",
      medium: params.get("utm_medium") || (referrerHost ? "referral" : "none"),
      campaign: params.get("utm_campaign") || null
    };
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(touch));
    return touch;
  } catch {
    return { source: "direct", medium: "none", campaign: null };
  }
}

function track(step, dealId) {
  const visitorId = getVisitorId();
  if (!visitorId) return;
  const touch = getAttribution();
  // Deliberately not awaited anywhere it's called: a slow or failing
  // analytics write must never delay the thing the visitor actually asked
  // for, least of all the OTP flow.
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      visitorId,
      phone: localStorage.getItem(STORAGE_KEY) || null,
      step,
      dealId: dealId || null,
      source: touch.source,
      medium: touch.medium,
      campaign: touch.campaign
    })
  }).catch(() => {});
}

let activeCategory = "All";
let searchTerm = "";
let pendingDealId = null;
let LIVE_DEALS = [];
let LIVE_CATEGORIES = [];
// {dealId: score} for a returning, verified visitor — populated after load,
// so the grid renders immediately with the discovery shuffle and then
// re-renders once personalization is known, rather than blocking on it.
let PERSONALIZED_SCORES = {};

// Results of the last natural-language search: ids in relevance order, or
// null when no search is active. Kept separate from searchTerm because the
// term alone can no longer answer "does this deal match" — that judgement
// now happens server-side.
let SEARCH_RESULT_IDS = null;
let SEARCH_MODE = null;
let SEARCH_PENDING = false;

// Fine-grained interest tags shown per category in the preference survey.
// "Electronics" alone doesn't tell pickBestDeal whether someone wants
// headphones or laptops, so the survey collects these specific strings
// instead — they're sent to Claude as free text, same as before, so no
// backend change was needed. Any category not listed here (e.g. a new one
// an admin adds later) just falls back to showing itself as a single chip.
// Fetched from GET /api/category-tags on load (see backend/lib/categoryTags.js
// for why this lives server-side — it's also used to match a declared
// sub-tag interest back to its parent category for personalized ordering).
let SURVEY_TAGS = {};

// Display-side taxonomy from GET /api/taxonomy: what to call each raw CJ
// category, and which browse group it belongs to. Empty until loaded, and
// every lookup falls back to the raw category, so a failed fetch degrades to
// the old ungrouped bar rather than an empty one.
let CATEGORY_LABELS = {};
let CATEGORY_GROUPS = {};
let GROUP_BY_CATEGORY = {};

async function loadTaxonomy() {
  try {
    const res = await fetch("/api/taxonomy");
    const data = await res.json();
    CATEGORY_LABELS = data.labels || {};
    CATEGORY_GROUPS = data.groups || {};
    GROUP_BY_CATEGORY = {};
    for (const [group, categories] of Object.entries(CATEGORY_GROUPS)) {
      for (const category of categories) GROUP_BY_CATEGORY[category] = group;
    }
  } catch (err) {
    console.warn("Could not load taxonomy, showing raw categories:", err.message);
  }
}

function groupForCategory(category) {
  return GROUP_BY_CATEGORY[category] || category;
}

function labelForCategory(category) {
  return CATEGORY_LABELS[category] || category;
}

// Only groups that actually have deals behind them — an empty chip is the
// problem this grouping exists to solve, so don't reintroduce it.
function groupsInCatalog() {
  const counts = new Map();
  for (const deal of displayableDeals()) {
    const group = groupForCategory(deal.category);
    counts.set(group, (counts.get(group) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function loadSurveyTags() {
  try {
    const res = await fetch("/api/category-tags");
    SURVEY_TAGS = await res.json();
  } catch (err) {
    console.warn("Could not load survey tags, falling back to plain categories:", err.message);
  }
}

/* ---------------- Taste quiz (anonymous, no sign-up) ---------------- */

// A mix of real current advertisers (brand logo, tag = exact store name so
// it feeds favoriteBrands matching directly) and generic representative
// style photos for categories we don't have specific real product images
// for (tag = category name, feeds interests matching via categoryTags.js's
// matching on the server). No backend/CJ data needed for either kind.
const TASTE_CARDS = [
  { type: "brand", label: "Stylevana", logoDomain: "stylevana.com", tag: "Stylevana" },
  { type: "brand", label: "Peet's Coffee", logoDomain: "peets.com", tag: "Peet's Coffee" },
  { type: "brand", label: "SoccerGarage", logoDomain: "soccergarage.com", tag: "SoccerGarage" },
  { type: "brand", label: "AndaSeat", logoDomain: "andaseat.com", tag: "AndaSeat" },
  { type: "brand", label: "Pine Meadow Golf", logoDomain: "pinemeadowgolf.com", tag: "Pine Meadow Golf" },
  { type: "brand", label: "Amiclubwear", logoDomain: "amiclubwear.com", tag: "Amiclubwear" },
  { type: "brand", label: "UNice", logoDomain: "unice.com", tag: "UNice" },
  { type: "brand", label: "HerbsPro", logoDomain: "herbspro.com", tag: "HerbsPro" },
  { type: "brand", label: "Monoprice", logoDomain: "monoprice.com", tag: "Monoprice" },
  { type: "brand", label: "Tech For Less", logoDomain: "techforless.com", tag: "Tech For Less" },
  { type: "brand", label: "Sleep & Beyond", logoDomain: "sleepandbeyond.com", tag: "Sleep & Beyond" },
  { type: "brand", label: "Nanit", logoDomain: "nanit.com", tag: "Nanit" },
  { type: "brand", label: "VIGO", logoDomain: "vigoindustries.com", tag: "VIGO" },
  { type: "brand", label: "Winebasket", logoDomain: "winebasket.com", tag: "Winebasket" },
  { type: "brand", label: "Zinio", logoDomain: "zinio.com", tag: "Zinio" },
  { type: "brand", label: "Buture", logoDomain: "ibuture.com", tag: "Buture" },
  { type: "brand", label: "Snaps Clothing", logoDomain: "snapsclothing.com", tag: "Snaps Clothing" },
  { type: "style", label: "Casual Tees", image: "photo-1618453292459-53424b66bb6a", tag: "Apparel" },
  { type: "style", label: "Denim", image: "photo-1598554747436-c9293d6a588f", tag: "Apparel" },
  { type: "style", label: "Sunglasses", image: "photo-1511499767150-a48a237f0083", tag: "Womens" },
  { type: "style", label: "Men's Style", image: "photo-1618886614638-80e3c103d31a", tag: "Mens" },
  { type: "style", label: "Sneakers", image: "photo-1542291026-7eec264c27ff", tag: "Sports" },
  { type: "style", label: "Gym & Fitness", image: "photo-1517836357463-d25dfeac3438", tag: "Wellness" },
  { type: "style", label: "Skincare", image: "photo-1620916297397-a4a5402a3c6c", tag: "Cosmetics" },
  { type: "style", label: "Fragrance", image: "photo-1523293182086-7651a899d37f", tag: "Bath & Body" },
  { type: "style", label: "Hiking Gear", image: "photo-1551632811-561732d1e306", tag: "Outdoors" },
  { type: "style", label: "Coffee", image: "photo-1610632380989-680fe40816c6", tag: "Gourmet" },
  { type: "style", label: "Wine & Spirits", image: "photo-1510812431401-41d2bd2722f3", tag: "Gourmet" },
  { type: "style", label: "Resort Travel", image: "photo-1549294413-26f195200c16", tag: "Hotel" },
  { type: "style", label: "Fine Jewelry", image: "photo-1633934542430-0905ccb5f050", tag: "Jewelry" },
  { type: "style", label: "Kids Toys", image: "photo-1596461404969-9ae70f2830c1", tag: "Toys" },
  { type: "style", label: "Home Furniture", image: "photo-1631679706909-1844bbd07221", tag: "Furniture" },
  { type: "style", label: "Headphones", image: "photo-1505740420928-5e560c06d30e", tag: "Consumer Electronics" },
  { type: "style", label: "Flowers", image: "photo-1582794543139-8ac9cb0f7b11", tag: "Flowers" },
  { type: "style", label: "Gift Boxes", image: "photo-1513201099705-a9746e1e201f", tag: "Gifts" },
  { type: "style", label: "Watches", image: "photo-1600003014755-ba31aa59c4b6", tag: "Jewelry" },
  { type: "style", label: "Smart Home", image: "photo-1558002038-1055907df827", tag: "Consumer Electronics" }
];

const TASTE_PREFS_KEY = "omd_taste_prefs";

function getTastePrefs() {
  try {
    return JSON.parse(localStorage.getItem(TASTE_PREFS_KEY) || '{"liked":[],"disliked":[]}');
  } catch {
    return { liked: [], disliked: [] };
  }
}

function saveTastePrefs(prefs) {
  localStorage.setItem(TASTE_PREFS_KEY, JSON.stringify(prefs));
}

// --- Swipe deck -----------------------------------------------------------
// This was a 36-card grid with a ✕ and a ♥ on every card: 72 possible
// interactions, a 34px-tall tap target well under the 44px touch minimum,
// and 1,289px of wall before the visitor had done anything. The section
// promised "just tap what you like" while the interface demanded a decision
// between two cramped buttons — the instruction and the interaction didn't
// match, which is what made it feel clunky.
//
// One card at a time instead. Swipe right to like, left to pass; the whole
// card is the target, and there's exactly one decision on screen at a time.
// A left swipe is still a real negative signal (unlike ignoring a card in a
// grid), so dislike scoring keeps working.

let TASTE_DECK = [];
let TASTE_DECK_INDEX = 0;
const SWIPE_COMMIT_PX = 90;

function tasteCardImgHTML(card) {
  if (card.type === "brand") {
    return `<img src="https://logos.hunter.io/${card.logoDomain}" alt="" draggable="false"
      onload="if (this.naturalWidth < 32) dropTasteCard('${card.tag}');"
      onerror="dropTasteCard('${card.tag}');" />`;
  }
  return `<img src="https://images.unsplash.com/${card.image}?w=500&q=80&fit=crop&auto=format" alt="" draggable="false" />`;
}

// A brand card is mostly the name, which leaves the card looking empty and
// says nothing about why the brand is worth a swipe. The live count does
// both. It's omitted when we have no deals for that store (or before the
// catalog has loaded) rather than showing a zero.
function tasteCardMetaHTML(card) {
  if (card.type !== "brand") return "";
  const n = LIVE_DEALS.filter(d => d.store === card.tag).length;
  if (!n) return "";
  return `<span class="brand-meta">${n} deal${n === 1 ? "" : "s"} live</span>`;
}

// A logo the lookup service doesn't actually have comes back as a tiny
// placeholder rather than a 404, so the card has to remove itself. In a deck
// that means pulling it from the queue, not from the DOM.
function dropTasteCard(tag) {
  const at = TASTE_DECK.findIndex(c => c.tag === tag);
  if (at === -1) return;
  TASTE_DECK.splice(at, 1);
  if (at < TASTE_DECK_INDEX) TASTE_DECK_INDEX--;
  renderTasteDeck();
}

function buildTasteDeck() {
  const prefs = getTastePrefs();
  const seen = new Set([...prefs.liked, ...prefs.disliked]);
  // Already-answered cards don't come back, and the order is shuffled so the
  // deck doesn't open on the same brand for everyone.
  TASTE_DECK = shuffleInPlace(TASTE_CARDS.filter(c => !seen.has(c.tag)));
  TASTE_DECK_INDEX = 0;
}

function renderTasteQuiz() {
  if (!document.getElementById("tasteDeck")) return;
  buildTasteDeck();
  renderTasteDeck();
}

function renderTasteDeck() {
  const deck = document.getElementById("tasteDeck");
  if (!deck) return;

  const remaining = TASTE_DECK.slice(TASTE_DECK_INDEX);
  if (!remaining.length) {
    deck.innerHTML = `<div class="taste-done">
      <strong>That's everything.</strong>
      <p>We've got what we need — your deals are sorted below.</p>
    </div>`;
    updateTasteProgress();
    return;
  }

  // Only the top three are rendered; the ones behind exist to give the stack
  // depth, so there's no point building thirty-odd off-screen nodes.
  // Brand cards put the name in type and the logo alongside it as an accent.
  // Logos come back anywhere from 32px to 800px, so any size that makes the
  // small ones legible badly upscales them — letting the name carry the card
  // is the only treatment that survives that range.
  deck.innerHTML = remaining.slice(0, 3).map((card, i) => `
    <div class="taste-card ${card.type}" data-tag="${escapeHtml(card.tag)}" data-depth="${i}"
         ${i === 0 ? 'tabindex="0" role="group" aria-label="' + escapeHtml(card.label) + '"' : 'aria-hidden="true"'}>
      ${card.type === "brand"
        ? `<div class="brand-face">
             ${tasteCardImgHTML(card)}
             <span class="brand-name">${escapeHtml(card.label)}</span>
             ${tasteCardMetaHTML(card)}
           </div>`
        : `${tasteCardImgHTML(card)}<div class="taste-card-label">${escapeHtml(card.label)}</div>`}
      <div class="swipe-badge like">Like</div>
      <div class="swipe-badge nope">Pass</div>
    </div>`).reverse().join("");

  const top = deck.querySelector('[data-depth="0"]');
  if (top) attachSwipe(top);
  updateTasteProgress();
}

function updateTasteProgress() {
  const el = document.getElementById("tasteProgress");
  if (!el) return;
  const left = TASTE_DECK.length - TASTE_DECK_INDEX;
  el.textContent = left ? `${left} to go` : "";
}

// Pointer events rather than separate mouse/touch handlers — one code path
// covers finger, trackpad and mouse, and desktop gets the same drag.
function attachSwipe(card) {
  let startX = 0, startY = 0, dx = 0, dragging = false, pointerId = null;

  const onDown = e => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    card.setPointerCapture(pointerId);
    card.classList.add("dragging");
  };

  const onMove = e => {
    if (!dragging || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // A mostly-vertical drag is the page scrolling, not a swipe — let it go.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 30 && Math.abs(dx) < 20) return;
    card.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx / 18}deg)`;
    card.style.setProperty("--swipe", String(Math.max(-1, Math.min(1, dx / SWIPE_COMMIT_PX))));
  };

  const onUp = e => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    card.classList.remove("dragging");
    try { card.releasePointerCapture(pointerId); } catch {}
    pointerId = null;

    if (Math.abs(dx) >= SWIPE_COMMIT_PX) {
      commitSwipe(card, dx > 0);
    } else {
      card.style.transform = "";
      card.style.setProperty("--swipe", "0");
    }
    dx = 0;
  };

  card.addEventListener("pointerdown", onDown);
  card.addEventListener("pointermove", onMove);
  card.addEventListener("pointerup", onUp);
  card.addEventListener("pointercancel", onUp);
  card.addEventListener("keydown", e => {
    if (e.key === "ArrowRight") { e.preventDefault(); swipeTop(true); }
    if (e.key === "ArrowLeft") { e.preventDefault(); swipeTop(false); }
  });
}

function commitSwipe(card, liked) {
  const tag = card.dataset.tag;
  card.classList.add("gone");
  card.style.transform = `translateX(${liked ? "140%" : "-140%"}) rotate(${liked ? 25 : -25}deg)`;

  recordTaste(tag, liked);
  TASTE_DECK_INDEX++;

  // Let the card clear the screen before the stack rebuilds under it.
  const settle = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260;
  setTimeout(() => { renderTasteDeck(); applyTastePrefs(); }, settle);
}

// The button and keyboard path — same outcome as a drag.
function swipeTop(liked) {
  const top = document.querySelector('#tasteDeck [data-depth="0"]');
  if (top) commitSwipe(top, liked);
}

// State only. Kept separate from rendering so a swipe can record the answer
// mid-animation without the deck rebuilding underneath the card in flight.
function recordTaste(tag, liked) {
  const prefs = getTastePrefs();
  prefs.liked = prefs.liked.filter(t => t !== tag);
  prefs.disliked = prefs.disliked.filter(t => t !== tag);
  (liked ? prefs.liked : prefs.disliked).push(tag);
  saveTastePrefs(prefs);
}

// Still exported for anything that records a preference outside the deck.
function tasteReact(tag, liked) {
  recordTaste(tag, liked);
  applyTastePrefs();
}

/* ---------- Turning taste picks into an on-page result ---------- */

// {dealId: score} and {dealId: "why"} for an anonymous visitor's picks.
// Deliberately separate from PERSONALIZED_SCORES, which is the server's
// answer for a registered user and already has these merged into it.
let TASTE_SCORES = {};
let TASTE_REASONS = {};

// Same comparison the server's scoreDealsForUser uses: letters and digits
// only. A brand card's tag is a store name, and store names get rewritten by
// cleanStoreName on sync ("pinemeadowgolf.com" to "Pine Meadow Golf"), so a
// literal match would break for whichever side updates first.
function normalizeBrandName(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tasteSignals() {
  const prefs = getTastePrefs();
  const sig = { likedStores: [], likedCategories: [], dislikedStores: [], dislikedCategories: [] };
  for (const card of TASTE_CARDS) {
    const liked = prefs.liked.includes(card.tag);
    const disliked = prefs.disliked.includes(card.tag);
    if (!liked && !disliked) continue;
    if (card.type === "brand") {
      (liked ? sig.likedStores : sig.dislikedStores).push({ tag: card.tag, label: card.label });
    } else {
      (liked ? sig.likedCategories : sig.dislikedCategories).push({ tag: card.tag, label: card.label });
    }
  }
  return sig;
}

function storeMatches(dealStore, tag) {
  const a = normalizeBrandName(dealStore);
  const b = normalizeBrandName(tag);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

// A liked brand outranks a liked category, mirroring the server's 100/20
// split, so "I like this exact shop" beats "I like this kind of thing".
function recomputeTasteScores() {
  TASTE_SCORES = {};
  TASTE_REASONS = {};
  const sig = tasteSignals();
  if (!sig.likedStores.length && !sig.likedCategories.length &&
      !sig.dislikedStores.length && !sig.dislikedCategories.length) return;

  for (const deal of LIVE_DEALS) {
    let score = 0;
    let reason = null;

    const brandHit = sig.likedStores.find(s => storeMatches(deal.store, s.tag));
    if (brandHit) { score += 100; reason = brandHit.label; }

    const categoryHit = sig.likedCategories.find(c => c.tag === deal.category);
    if (categoryHit) { score += 20; if (!reason) reason = categoryHit.label; }

    if (sig.dislikedStores.some(s => storeMatches(deal.store, s.tag))) score -= 100;
    if (sig.dislikedCategories.some(c => c.tag === deal.category)) score -= 20;

    if (score) TASTE_SCORES[deal.id] = score;
    if (score > 0 && reason) TASTE_REASONS[deal.id] = reason;
  }
}

// A registered visitor's server-side scores already account for their quiz
// picks (submitSurvey/skipSurvey merge them in), so they win outright.
function activeScores() {
  return Object.keys(PERSONALIZED_SCORES).length ? PERSONALIZED_SCORES : TASTE_SCORES;
}

function applyTastePrefs() {
  recomputeTasteScores();
  renderDeals();
  renderTasteResult();
}

// The moment someone has expressed real taste is the moment to make the
// offer — before this the quiz section had no call to action at all, which
// left the highest-intent visitor on the page with nothing to do next.
const TASTE_CTA_THRESHOLD = 3;

function renderTasteResult() {
  const el = document.getElementById("tasteResult");
  if (!el) return;

  const likes = getTastePrefs().liked.length;
  const matches = displayableDeals().filter(d => (TASTE_SCORES[d.id] || 0) > 0).length;

  if (!likes) {
    el.innerHTML = "";
    return;
  }
  if (likes < TASTE_CTA_THRESHOLD) {
    const left = TASTE_CTA_THRESHOLD - likes;
    el.innerHTML = `<div class="taste-result">
      <span>${likes} picked — ${left} more and we'll sort the deals around what you like.</span>
    </div>`;
    return;
  }

  el.innerHTML = `<div class="taste-result ready">
    <span><strong>${matches}</strong> deal${matches === 1 ? "" : "s"} match what you picked — they're at the top of the list now.</span>
    <button type="button" class="taste-cta" onclick="scrollToMatches()">See my deals</button>
  </div>`;
}

function scrollToMatches() {
  document.getElementById("browse").scrollIntoView({ behavior: "smooth" });
}

function getUnlockedDeals() {
  try {
    return JSON.parse(localStorage.getItem(UNLOCKED_KEY) || "[]");
  } catch {
    return [];
  }
}

function markUnlocked(dealId) {
  const unlocked = getUnlockedDeals();
  if (!unlocked.includes(dealId)) {
    unlocked.push(dealId);
    localStorage.setItem(UNLOCKED_KEY, JSON.stringify(unlocked));
  }
}

function isRegistered() {
  return !!localStorage.getItem(STORAGE_KEY);
}

// Cards now show just brand + discount badge, no descriptive title — a
// badge-less deal (real code, but no extractable %/$) would render
// identically to every other badge-less deal from the same store, with
// nothing to tell them apart. Rather than bring the messy title text back,
// those stay in the database (still usable for personalization/matching)
// but don't show up in the browsable grid at all.
function displayableDeals() {
  const today = new Date().toISOString().slice(0, 10);
  return LIVE_DEALS.filter(d => d.discount && d.expires >= today);
}

function filteredDeals() {
  const inCategory = d => activeCategory === "All" || groupForCategory(d.category) === activeCategory;

  // With a search active the server has already decided what matches, and
  // it returned them ranked — so preserve that order instead of running the
  // grid's usual shuffle over them. Category still applies on top, so
  // narrowing a search by group keeps working.
  if (SEARCH_RESULT_IDS) {
    const byId = new Map(displayableDeals().map(d => [d.id, d]));
    return SEARCH_RESULT_IDS.map(id => byId.get(id)).filter(d => d && inCategory(d));
  }
  return displayableDeals().filter(inCategory);
}

// Real brand logos come from a free lookup-by-domain service — falls back
// to the emoji if the advertiser isn't in that service's index (common for
// smaller/niche brands). The service returns a 20x16px generic placeholder
// (HTTP 200, not a 404) rather than failing outright when it has no real
// logo, so a plain onerror handler doesn't catch that case — checking the
// loaded image's actual size does.
function dealLogoInnerHTML(d) {
  // logo_url is the brand's own logo, served through our proxy — authoritative
  // and it doesn't silently degrade. Only Impact deals have one; CJ deals fall
  // back to the Hunter.io lookup below.
  const src = d.logo_url || (d.logo_domain ? `https://logos.hunter.io/${d.logo_domain}` : null);
  if (!src) return d.emoji;

  // The naturalWidth guard exists for Hunter.io specifically: it answers 200
  // with a ~16px placeholder for brands it doesn't have, so a plain onerror
  // never fires. Our own proxy 404s instead, but keep the check for both —
  // a tiny image is the wrong thing to show either way.
  return `<img src="${src}" alt="" loading="lazy"
    onerror="this.parentElement.innerHTML = '${d.emoji}';"
    onload="if (this.naturalWidth < 32) this.parentElement.innerHTML = '${d.emoji}';" />`;
}

function dealCardHTML(d) {
  return `
    <div class="deal-card" data-id="${d.id}" onclick="openDealModal('${d.id}')">
      <div class="top-row">
        <div class="deal-emoji">${dealLogoInnerHTML(d)}</div>
        ${d.discount ? `<div class="badge-discount">${d.discount}</div>` : ""}
      </div>
      <h3>${d.store}</h3>
      <div class="deal-store">${labelForCategory(d.category)}</div>
      ${TASTE_REASONS[d.id] ? `<div class="match-reason">Because you like ${TASTE_REASONS[d.id]}</div>` : ""}
      <div class="card-footer">
        <span>Expires ${formatDate(d.expires)}</span>
        <button class="get-code-btn" onclick="event.stopPropagation(); openDealModal('${d.id}')">Get Code</button>
      </div>
    </div>
  `;
}

function formatDate(iso) {
  const dt = new Date(iso + "T00:00:00");
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderCategoryBar() {
  const bar = document.getElementById("categoryBar");
  const groups = groupsInCatalog();
  const chips = [["All", displayableDeals().length], ...groups];
  bar.innerHTML = chips
    .map(
      ([name, count]) =>
        `<button class="chip ${name === activeCategory ? "active" : ""}" onclick="setCategory('${name.replace(/'/g, "\\'")}')">${name} <span class="chip-count">${count}</span></button>`
    )
    .join("");
}

function setCategory(cat) {
  activeCategory = cat;
  renderCategoryBar();
  renderDeals();
}

function discountValue(discount) {
  const match = (discount || "").match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function renderFeatured() {
  const wrap = document.getElementById("featuredGrid");
  const pool = displayableDeals();
  let featured = pool.filter(d => d.featured);
  // No CJ-synced deal is ever admin-curated as "featured" (they always
  // come in as featured=false), so without this fallback this section
  // would show "No featured deals right now" permanently. Auto-feature
  // the strongest current offers by discount size instead.
  if (!featured.length) {
    // Best-per-store first, so a cluster of duplicate/near-identical deals
    // from one advertiser (a real, recurring pattern in synced data) can't
    // fill every featured slot with the same brand.
    const bestPerStore = new Map();
    pool.forEach(d => {
      const current = bestPerStore.get(d.store);
      if (!current || discountValue(d.discount) > discountValue(current.discount)) bestPerStore.set(d.store, d);
    });
    featured = Array.from(bestPerStore.values())
      .sort((a, b) => discountValue(b.discount) - discountValue(a.discount))
      .slice(0, 4);
  }
  wrap.innerHTML = featured.length
    ? featured.map(dealCardHTML).join("")
    : `<div class="empty-state">No featured deals right now.</div>`;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Deals load in DB insertion order, which clusters every deal from one
// advertiser's sync batch together (e.g. 8 Trident Hotels cards in a row) —
// bad for discovery. Groups by store, shuffles within and across groups,
// then round-robins one deal per store per pass so the same store can't
// appear twice in a row unless it alone makes up more than half the list.
function interleaveByStore(deals) {
  const buckets = new Map();
  for (const d of deals) {
    if (!buckets.has(d.store)) buckets.set(d.store, []);
    buckets.get(d.store).push(d);
  }
  const groups = Array.from(buckets.values());
  groups.forEach(shuffleInPlace);
  shuffleInPlace(groups);

  const result = [];
  let anyLeft = true;
  while (anyLeft) {
    anyLeft = false;
    for (const group of groups) {
      if (group.length) {
        result.push(group.shift());
        if (group.length) anyLeft = true;
      }
    }
  }
  return result;
}

// For a returning, verified visitor (see PERSONALIZED_SCORES below), puts
// their best-matching deals first as a group, then everything else — each
// group still internally shuffled/interleaved by store, so it's "your
// matches first" layered on top of the discovery shuffle, not a full
// replacement of it.
function orderDeals(deals) {
  const scores = activeScores();
  if (!Object.keys(scores).length) return interleaveByStore(deals);

  const matched = shuffleInPlace(deals.filter(d => (scores[d.id] || 0) > 0));
  const neutral = deals.filter(d => (scores[d.id] || 0) === 0);
  // A dislike is a real signal and cheaper to give than a like, so it should
  // actually cost the deal its place rather than just greying out a card.
  const buried = deals.filter(d => (scores[d.id] || 0) < 0);

  return [...rankMatched(matched, scores), ...interleaveByStore(neutral), ...buried];
}

// Sorting the matched group by score alone stacked every deal from a liked
// brand at the top — seven consecutive Stylevana cards the moment you liked
// Stylevana, which is the clustering interleaveByStore exists to prevent,
// reintroduced right above the fold. interleaveByStore can't be reused here
// because it shuffles the store order and would throw the ranking away, so
// this round-robins across stores while keeping score in charge of who goes
// first: best match leads, then one deal per store per pass.
function rankMatched(deals, scores) {
  const buckets = new Map();
  for (const deal of deals) {
    if (!buckets.has(deal.store)) buckets.set(deal.store, []);
    buckets.get(deal.store).push(deal);
  }

  for (const group of buckets.values()) {
    group.sort(
      (a, b) =>
        (scores[b.id] || 0) - (scores[a.id] || 0) ||
        discountValue(b.discount) - discountValue(a.discount)
    );
  }
  const groups = [...buckets.values()].sort(
    (a, b) => (scores[b[0].id] || 0) - (scores[a[0].id] || 0)
  );

  const result = [];
  let anyLeft = true;
  while (anyLeft) {
    anyLeft = false;
    for (const group of groups) {
      if (group.length) {
        result.push(group.shift());
        if (group.length) anyLeft = true;
      }
    }
  }
  return result;
}

function renderDeals() {
  const grid = document.getElementById("dealGrid");
  const countEl = document.getElementById("resultCount");

  if (SEARCH_PENDING) {
    countEl.textContent = "Searching\u2026";
    grid.innerHTML = `<div class="empty-state"><span class="spinner"></span> Looking for "${escapeHtml(searchTerm)}"\u2026</div>`;
    return;
  }

  const filtered = filteredDeals();
  // Search results arrive already ranked by relevance; re-ordering them by
  // taste would bury the thing the visitor actually asked for under a brand
  // they once tapped a heart on.
  const deals = SEARCH_RESULT_IDS ? filtered : orderDeals(filtered);
  const scores = activeScores();
  const matches = deals.filter(d => (scores[d.id] || 0) > 0).length;

  countEl.textContent =
    `${deals.length} deal${deals.length === 1 ? "" : "s"}` +
    (SEARCH_RESULT_IDS ? ` for "${searchTerm}"` : "") +
    (!SEARCH_RESULT_IDS && matches ? ` \u00b7 ${matches} matched to you` : "");

  if (deals.length === 0) {
    grid.innerHTML = SEARCH_RESULT_IDS
      // A thin catalog means searches legitimately miss, so say so honestly
      // and point at the thing that pays off later rather than dead-ending.
      ? `<div class="empty-state">
           <strong>Nothing matches "${escapeHtml(searchTerm)}" yet.</strong>
           <p>We're adding new retailers constantly. Tap what you like above and we'll text you the moment something fits.</p>
           <button type="button" class="chip" onclick="clearSearch()">Show all deals</button>
         </div>`
      : `<div class="empty-state">No deals in ${activeCategory}. <button type="button" class="chip" onclick="setCategory('All')">Show all deals</button></div>`;
    return;
  }
  grid.innerHTML = deals.map(dealCardHTML).join("");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function clearSearch() {
  searchTerm = "";
  SEARCH_RESULT_IDS = null;
  SEARCH_MODE = null;
  document.getElementById("searchInput").value = "";
  renderDeals();
}

async function handleSearch(e) {
  e.preventDefault();
  searchTerm = document.getElementById("searchInput").value.trim();
  document.getElementById("browse").scrollIntoView({ behavior: "smooth" });

  if (!searchTerm) return clearSearch();

  SEARCH_PENDING = true;
  renderDeals();

  try {
    const res = await fetch("/api/deals/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: searchTerm })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Search failed");
    SEARCH_RESULT_IDS = data.dealIds;
    SEARCH_MODE = data.mode;
  } catch (err) {
    // Never leave the box dead. Fall back to the old substring behaviour in
    // the browser, which needs no network at all.
    console.warn("Search unavailable, matching locally instead:", err.message);
    const term = searchTerm.toLowerCase();
    SEARCH_RESULT_IDS = displayableDeals()
      .filter(d =>
        (d.title || "").toLowerCase().includes(term) ||
        (d.brand || "").toLowerCase().includes(term) ||
        (d.store || "").toLowerCase().includes(term) ||
        (d.category || "").toLowerCase().includes(term)
      )
      .map(d => d.id);
    SEARCH_MODE = "local";
  } finally {
    SEARCH_PENDING = false;
    renderDeals();
  }
}

/* ---------------- Deal modal / mock SMS gate ---------------- */

function openDealModal(dealId) {
  pendingDealId = dealId;
  const deal = LIVE_DEALS.find(d => d.id === dealId);
  if (!deal) return;
  track("deal_view", dealId);

  document.getElementById("modalEmoji").innerHTML = dealLogoInnerHTML(deal);
  renderModalStoreLink(deal.store);
  document.getElementById("modalTitle").textContent = deal.title;
  document.getElementById("modalStore").textContent = `${deal.store} · Expires ${formatDate(deal.expires)}`;
  document.getElementById("modalDesc").textContent = deal.description;

  const overlay = document.getElementById("modalOverlay");
  overlay.classList.remove("hidden");

  const alreadyUnlocked = getUnlockedDeals().includes(dealId);
  if (alreadyUnlocked || isRegistered()) {
    showRevealStep(deal, isRegistered() && !alreadyUnlocked);
  } else {
    showStep("stepPhone");
    document.getElementById("phoneInput").value = "";
    document.getElementById("phoneInput").focus();
  }
}

function closeModal() {
  document.getElementById("modalOverlay").classList.add("hidden");
  pendingDealId = null;
}

// Mirrors backend/lib/seo.js's slugify — the two must agree or this link
// 404s. Small enough to duplicate rather than add a fetch on every modal open.
function storeSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderModalStoreLink(store) {
  const el = document.getElementById("modalStoreLink");
  if (!el) return;
  const slug = storeSlug(store);
  if (!slug) { el.innerHTML = ""; return; }
  el.innerHTML = `<a class="modal-store-link" href="/${slug}-coupons">See all ${store} deals &rarr;</a>`;
}

function showStep(stepId) {
  document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
  document.getElementById(stepId).classList.add("active");
}

// Set to true once you're running server.js (see backend/README.md).
// When false, or if a call to the backend fails for any reason (e.g. this
// page was opened directly as a file, or the backend isn't running yet),
// the flow silently falls back to the original mock behavior so the demo
// never breaks.
const USE_REAL_BACKEND = true;

async function submitPhone(e) {
  e.preventDefault();
  const input = document.getElementById("phoneInput");
  const val = input.value.trim();
  const digits = val.replace(/\D/g, "");
  if (digits.length < 10) {
    input.style.borderColor = "#d64545";
    return;
  }
  input.style.borderColor = "";
  track("phone_submit", pendingDealId);

  const btn = document.getElementById("sendCodeBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Texting your code&hellip;`;

  const goToOtpStep = () => {
    btn.disabled = false;
    btn.textContent = originalText;
    document.getElementById("otpPhoneDisplay").textContent = formatPhoneDisplay(val);
    showStep("stepOtp");
    document.getElementById("otpInput").value = "";
    document.getElementById("otpInput").focus();
  };

  if (USE_REAL_BACKEND) {
    // No consent decision is captured at this step anymore — the optional
    // marketing ask now happens at the reveal step, after the user's
    // actually gotten something, not before. New users default to opted
    // out until they check that box (see handleRevealConsentToggle below).
    let res;
    try {
      res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: val })
      });
    } catch (networkErr) {
      // Backend truly unreachable (e.g. server.js isn't running, or this
      // page was opened as a plain file) — fall back to the demo mock below.
      console.warn("Backend unavailable, falling back to demo mode:", networkErr.message);
      setTimeout(goToOtpStep, 1100);
      return;
    }

    // Backend responded — trust its answer, real or a real rejection
    // (e.g. a rate limit). Don't pretend a code was sent when it wasn't.
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = originalText;
    if (!res.ok || !data.success) {
      input.style.borderColor = "#d64545";
      showToast(data.error || "Couldn't send a code. Try again in a bit.");
      return;
    }
    goToOtpStep();
    return;
  }

  // MOCK fallback — simulates the text-send delay with no real backend call.
  setTimeout(goToOtpStep, 1100);
}

function formatPhoneDisplay(val) {
  const digits = val.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return val;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

async function submitOtp(e) {
  e.preventDefault();
  const otpInput = document.getElementById("otpInput");
  const otp = otpInput.value.trim();
  const phone = document.getElementById("phoneInput").value.trim();
  const deal = LIVE_DEALS.find(d => d.id === pendingDealId);
  if (otp.length < 4) {
    otpInput.style.borderColor = "#d64545";
    return;
  }
  otpInput.style.borderColor = "";

  if (USE_REAL_BACKEND) {
    let res;
    try {
      res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: otp, dealId: pendingDealId, visitorId: getVisitorId() })
      });
    } catch (networkErr) {
      // Backend truly unreachable (e.g. server.js isn't running, or this
      // page was opened as a plain file) — fall back to the demo mock below.
      console.warn("Backend unavailable, falling back to demo mode:", networkErr.message);
      return mockUnlock(phone, deal);
    }

    // Backend responded — trust its answer, real or a real rejection.
    const data = await res.json();
    if (!res.ok || !data.success) {
      otpInput.style.borderColor = "#d64545";
      showToast(data.error || "That code didn't match.");
      return;
    }

    const isFirstRegistration = !localStorage.getItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY, phone);
    markUnlocked(pendingDealId);

    let note;
    if (data.smsSent) {
      note = "You're registered! We just texted you this deal — future deals will be personalized based on your preferences.";
    } else if (data.optedOut) {
      note = "Here's your code. We didn't text it since you're not opted in for texts — text START to our number anytime if you'd like future deals sent to you.";
    } else {
      note = "You're registered! (SMS send skipped — check your backend's Twilio config in .env.)";
    }
    track("otp_verified", pendingDealId);
    const revealData = { code: data.code, link: data.link, message: data.message, note };

    if (isFirstRegistration) {
      showSurveyStep(phone, revealData);
    } else {
      populateRevealStep(revealData);
      showStep("stepReveal");
    }
    return;
  }

  mockUnlock(phone, deal);
}

// Shared by every reveal path (registered, returning, mock) so a deal
// with no coupon code (CJ link-only deals) doesn't show an empty code box.
function applyRevealCodeAndLink(code, link) {
  document.getElementById("revealCodeBox").style.display = code ? "block" : "none";
  document.getElementById("revealCode").textContent = code || "";
  const shopLink = document.getElementById("revealShopLink");
  if (link) {
    shopLink.style.display = "block";
    shopLink.href = link;
  } else {
    shopLink.style.display = "none";
  }
}

function populateRevealStep(revealData) {
  track("code_revealed", pendingDealId);
  applyRevealCodeAndLink(revealData.code, revealData.link);
  document.getElementById("revealNote").textContent = revealData.note;
  const preview = document.getElementById("revealSmsPreview");
  if (revealData.message) {
    preview.style.display = "block";
    preview.textContent = revealData.message;
  } else {
    preview.style.display = "none";
  }
  // Reset so a previous unlock's choice doesn't silently carry over and
  // look pre-checked on a new one — this element persists across unlocks.
  document.getElementById("revealMarketingConsentInput").checked = false;
}

let pendingSurveyPhone = null;
let pendingRevealData = null;

function showSurveyStep(phone, revealData) {
  pendingSurveyPhone = phone;
  pendingRevealData = revealData;
  const grid = document.getElementById("surveyCategories");
  grid.innerHTML = LIVE_CATEGORIES.map((c, i) => {
    const tags = SURVEY_TAGS[c] || [c];
    return `
    <div class="survey-group">
      <button type="button" class="survey-group-header" onclick="toggleSurveyGroup(${i})">
        <span>${c}</span>
        <span class="survey-group-chevron" id="surveyChevron${i}">+</span>
      </button>
      <div class="survey-group-tags" id="surveyGroupTags${i}" hidden>
        ${tags.map(
          t => `
        <label class="survey-chip">
          <input type="checkbox" value="${t}" />
          <span>${t}</span>
        </label>`
        ).join("")}
      </div>
    </div>`;
  }).join("");
  document.getElementById("surveyBrandsInput").value = "";
  showStep("stepSurvey");
}

function toggleSurveyGroup(i) {
  const tagsEl = document.getElementById(`surveyGroupTags${i}`);
  const chevronEl = document.getElementById(`surveyChevron${i}`);
  const isHidden = tagsEl.hasAttribute("hidden");
  if (isHidden) {
    tagsEl.removeAttribute("hidden");
    chevronEl.textContent = "−";
  } else {
    tagsEl.setAttribute("hidden", "");
    chevronEl.textContent = "+";
  }
}

// Splits anonymous taste-quiz likes (recorded pre-signup, see tasteReact)
// back into interests vs. favoriteBrands, so they merge into the same
// /api/preferences call the checkbox survey already makes — one signal,
// regardless of which of the two ways someone expressed it.
function getTasteLikesSplit() {
  const liked = getTastePrefs().liked;
  const interests = [];
  const favoriteBrands = [];
  TASTE_CARDS.forEach(card => {
    if (!liked.includes(card.tag)) return;
    (card.type === "brand" ? favoriteBrands : interests).push(card.tag);
  });
  return { interests, favoriteBrands };
}

async function submitSurvey(e) {
  e.preventDefault();
  const checked = Array.from(document.querySelectorAll("#surveyCategories input:checked")).map(i => i.value);
  const brandsRaw = document.getElementById("surveyBrandsInput").value;
  const typedBrands = brandsRaw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const email = document.getElementById("surveyEmailInput").value.trim();

  const taste = getTasteLikesSplit();
  const interests = [...new Set([...checked, ...taste.interests])];
  const favoriteBrands = [...new Set([...typedBrands, ...taste.favoriteBrands])];

  // Email counts as something worth saving on its own — without it in this
  // condition, someone who filled in only the address would have it silently
  // dropped, which is the one field here we explicitly asked for.
  if (interests.length || favoriteBrands.length || email) {
    try {
      await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: pendingSurveyPhone, interests, favoriteBrands, email })
      });
    } catch (err) {
      console.warn("Could not save preferences, continuing anyway:", err.message);
    }
  }
  finishSurvey();
}

function skipSurvey() {
  // Skipping the checkbox survey shouldn't lose taste-quiz likes recorded
  // before sign-up — those are the only preference signal in that case.
  const taste = getTasteLikesSplit();
  if (taste.interests.length || taste.favoriteBrands.length) {
    fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: pendingSurveyPhone, interests: taste.interests, favoriteBrands: taste.favoriteBrands })
    }).catch(() => {});
  }
  finishSurvey();
}

function finishSurvey() {
  populateRevealStep(pendingRevealData);
  pendingSurveyPhone = null;
  pendingRevealData = null;
  showStep("stepReveal");
}

function mockUnlock(phone, deal) {
  // MOCK: any 4+ digit code is accepted in this prototype (demo code shown as a hint).
  localStorage.setItem(STORAGE_KEY, phone);
  markUnlocked(pendingDealId);
  document.getElementById("revealSmsPreview").style.display = "none";
  showRevealStep(deal, true);
}

function showRevealStep(deal, isFirstUnlock) {
  applyRevealCodeAndLink(deal.code, deal.link);
  document.getElementById("revealNote").textContent = isFirstUnlock
    ? "You're registered! We'll text you future deals in categories you engage with (per the V2 personalization plan)."
    : "Welcome back — code unlocked instantly since you're already registered.";
  document.getElementById("revealSmsPreview").style.display = "none";
  document.getElementById("revealMarketingConsentInput").checked = false;
  showStep("stepReveal");
}

function copyCode() {
  const code = document.getElementById("revealCode").textContent;
  navigator.clipboard?.writeText(code).catch(() => {});
  showToast(`Copied "${code}" to clipboard`);

  // Best-effort signal that this code is actually about to get used, not
  // just sent. Doesn't block the clipboard copy or the toast either way.
  track("code_copied", pendingDealId);

  // Separate from the funnel event above: this one feeds personalization
  // (markLastEngagementCopied), so it stays keyed on a known phone.
  const phone = localStorage.getItem(STORAGE_KEY);
  if (phone && pendingDealId) {
    fetch("/api/track-copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, dealId: pendingDealId })
    }).catch(() => {});
  }
}

// The affiliate event — this is the click that can actually earn a
// commission, and it used to be recorded as if it were a code copy, on the
// same endpoint and the same flag, so the two were indistinguishable.
function trackShopClick() {
  track("outbound_click", pendingDealId);

  const phone = localStorage.getItem(STORAGE_KEY);
  if (phone && pendingDealId) {
    fetch("/api/track-copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, dealId: pendingDealId })
    }).catch(() => {});
  }
}

// The optional marketing-texts checkbox lives on the reveal step now,
// asked after the user's already gotten their code rather than before —
// see the design discussion this was moved from stepPhone for. Fires as
// soon as they check/uncheck it, not gated behind the "Done" button.
function handleRevealConsentToggle(e) {
  const phone = localStorage.getItem(STORAGE_KEY);
  if (!phone) return;
  fetch("/api/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, marketingConsent: e.target.checked })
  }).catch(() => {});
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

/* ---------------- init ---------------- */

async function loadPersonalizationIfRegistered() {
  const phone = localStorage.getItem(STORAGE_KEY);
  if (!phone) return;
  try {
    const res = await fetch("/api/deals/personalized-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (data.success) {
      PERSONALIZED_SCORES = data.scores;
      renderDeals(); // re-render now that matches are known — grid already showed the discovery shuffle first
    }
  } catch (err) {
    console.warn("Personalization unavailable, showing discovery order only:", err.message);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  track("page_view");
  loadSurveyTags(); // not needed until first registration's survey step — don't block the grid on it
  renderTasteQuiz(); // works instantly for anonymous visitors, no deals/backend needed
  const [deals] = await Promise.all([loadDeals(), loadTaxonomy()]);
  LIVE_DEALS = deals;
  renderTasteDeck(); // same cards, same position — just fills in the live deal counts
  LIVE_CATEGORIES = getCategories(displayableDeals()); // raw categories — the survey still groups by these
  recomputeTasteScores(); // picks from a previous visit apply before the first paint
  renderCategoryBar();
  renderFeatured();
  renderDeals();
  renderTasteResult();
  document.getElementById("dealCountStat").textContent = displayableDeals().length;
  document.getElementById("storeCountStat").textContent = new Set(displayableDeals().map(d => d.store)).size;
  document.getElementById("categoryCountStat").textContent = groupsInCatalog().length;
  loadPersonalizationIfRegistered();
  openDealFromUrl();
});

// Store pages (/<brand>-coupons) link each offer as /?deal=<id>. Someone
// arriving from a search result has already chosen a specific deal, so open
// its gate rather than dropping them at the top of a grid to find it again.
function openDealFromUrl() {
  const wanted = new URLSearchParams(location.search).get("deal");
  if (!wanted) return;
  if (!LIVE_DEALS.some(d => d.id === wanted)) return; // stale or bad link — just show the site
  openDealModal(wanted);
  // Drop the parameter so a refresh or a back-navigation doesn't reopen it,
  // and so the URL people copy is the clean one.
  history.replaceState(null, "", location.pathname);
}
