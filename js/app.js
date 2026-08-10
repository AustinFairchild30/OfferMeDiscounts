// OfferMeDiscounts.com prototype front-end logic.
// Everything here runs client-side with no build step or backend.
// The SMS registration/unlock flow below is a MOCK: it simulates the
// "text number to unlock your first coupon" gate described in the
// business plan, but does not send real texts. See README.md for how
// to wire this to real Twilio + Claude API per the roadmap doc.

const STORAGE_KEY = "omd_registered_phone";
const UNLOCKED_KEY = "omd_unlocked_deals";

let activeCategory = "All";
let searchTerm = "";
let pendingDealId = null;
let LIVE_DEALS = [];
let LIVE_CATEGORIES = [];

// Fine-grained interest tags shown per category in the preference survey.
// "Electronics" alone doesn't tell pickBestDeal whether someone wants
// headphones or laptops, so the survey collects these specific strings
// instead — they're sent to Claude as free text, same as before, so no
// backend change was needed. Any category not listed here (e.g. a new one
// an admin adds later) just falls back to showing itself as a single chip.
const SURVEY_TAGS = {
  "Automotive": ["Oil Changes & Maintenance", "Car Detailing", "Dash Cams & Car Electronics"],
  "Baby & Kids": ["Baby Gear & Strollers", "Kids Books & Toys"],
  "Beauty & Personal Care": ["Skincare", "Haircare", "Fragrance", "Dental & Oral Care"],
  "Books & Media": ["Books", "Audiobooks", "Board Games"],
  "Electronics": ["Audio & Headphones", "Computers & Laptops", "Smart Home", "Gaming Gear"],
  "Entertainment & Streaming": ["Streaming Services", "Concerts & Events", "Movies"],
  "Fashion & Apparel": ["Clothing", "Shoes"],
  "Fitness & Outdoors": ["Yoga & Studio Gear", "Running & Athletic Wear", "Camping & Outdoor Gear", "Fitness Equipment"],
  "Food & Dining": ["Meal Kits & Groceries", "Restaurants & Dining Out", "Coffee & Beverages"],
  "Home & Garden": ["Furniture & Outdoor", "Smart Home & Appliances", "Bedding & Bath", "Kitchen"],
  "Pets": ["Dog Supplies", "Cat Supplies", "Pet Grooming", "Aquarium & Other Pets"],
  "Travel": ["Flights", "Hotels", "Rental Cars", "Cruises"]
};

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

function filteredDeals() {
  return LIVE_DEALS.filter(d => {
    const matchesCategory = activeCategory === "All" || d.category === activeCategory;
    const term = searchTerm.trim().toLowerCase();
    const matchesSearch =
      !term ||
      d.title.toLowerCase().includes(term) ||
      d.brand.toLowerCase().includes(term) ||
      d.store.toLowerCase().includes(term) ||
      d.category.toLowerCase().includes(term);
    return matchesCategory && matchesSearch;
  });
}

function dealCardHTML(d) {
  return `
    <div class="deal-card" data-id="${d.id}" onclick="openDealModal('${d.id}')">
      <div class="top-row">
        <div class="deal-emoji">${d.emoji}</div>
        <div class="badge-discount">${d.discount}</div>
      </div>
      <h3>${d.title}</h3>
      <div class="deal-store">${d.store} &middot; ${d.category}</div>
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
  const all = ["All", ...LIVE_CATEGORIES];
  bar.innerHTML = all
    .map(
      c =>
        `<button class="chip ${c === activeCategory ? "active" : ""}" onclick="setCategory('${c}')">${c}</button>`
    )
    .join("");
}

function setCategory(cat) {
  activeCategory = cat;
  renderCategoryBar();
  renderDeals();
}

function renderFeatured() {
  const wrap = document.getElementById("featuredGrid");
  const featured = LIVE_DEALS.filter(d => d.featured);
  wrap.innerHTML = featured.length
    ? featured.map(dealCardHTML).join("")
    : `<div class="empty-state">No featured deals right now.</div>`;
}

function renderDeals() {
  const grid = document.getElementById("dealGrid");
  const deals = filteredDeals();
  document.getElementById("resultCount").textContent = `${deals.length} deal${deals.length === 1 ? "" : "s"}`;
  if (deals.length === 0) {
    grid.innerHTML = `<div class="empty-state">No deals match "${searchTerm}" ${activeCategory !== "All" ? "in " + activeCategory : ""}. Try another search or category.</div>`;
    return;
  }
  grid.innerHTML = deals.map(dealCardHTML).join("");
}

function handleSearch(e) {
  e.preventDefault();
  searchTerm = document.getElementById("searchInput").value;
  renderDeals();
  document.getElementById("browse").scrollIntoView({ behavior: "smooth" });
}

/* ---------------- Deal modal / mock SMS gate ---------------- */

function openDealModal(dealId) {
  pendingDealId = dealId;
  const deal = LIVE_DEALS.find(d => d.id === dealId);
  if (!deal) return;

  document.getElementById("modalEmoji").textContent = deal.emoji;
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
    const marketingConsent = document.getElementById("marketingConsentInput").checked;
    let res;
    try {
      res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: val, marketingConsent })
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
        body: JSON.stringify({ phone, code: otp, dealId: pendingDealId })
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
    const revealData = { code: data.code, message: data.message, note };

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

function populateRevealStep(revealData) {
  document.getElementById("revealCode").textContent = revealData.code;
  document.getElementById("revealNote").textContent = revealData.note;
  const preview = document.getElementById("revealSmsPreview");
  if (revealData.message) {
    preview.style.display = "block";
    preview.textContent = revealData.message;
  } else {
    preview.style.display = "none";
  }
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

async function submitSurvey(e) {
  e.preventDefault();
  const checked = Array.from(document.querySelectorAll("#surveyCategories input:checked")).map(i => i.value);
  const brandsRaw = document.getElementById("surveyBrandsInput").value;
  const favoriteBrands = brandsRaw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (checked.length || favoriteBrands.length) {
    try {
      await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: pendingSurveyPhone, interests: checked, favoriteBrands })
      });
    } catch (err) {
      console.warn("Could not save preferences, continuing anyway:", err.message);
    }
  }
  finishSurvey();
}

function skipSurvey() {
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
  document.getElementById("revealCode").textContent = deal.code;
  document.getElementById("revealNote").textContent = isFirstUnlock
    ? "You're registered! We'll text you future deals in categories you engage with (per the V2 personalization plan)."
    : "Welcome back — code unlocked instantly since you're already registered.";
  document.getElementById("revealSmsPreview").style.display = "none";
  showStep("stepReveal");
}

function copyCode() {
  const code = document.getElementById("revealCode").textContent;
  navigator.clipboard?.writeText(code).catch(() => {});
  showToast(`Copied "${code}" to clipboard`);

  // Best-effort signal that this code is actually about to get used, not
  // just sent. Doesn't block the clipboard copy or the toast either way.
  const phone = localStorage.getItem(STORAGE_KEY);
  if (phone && pendingDealId) {
    fetch("/api/track-copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, dealId: pendingDealId })
    }).catch(() => {});
  }
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

/* ---------------- init ---------------- */

document.addEventListener("DOMContentLoaded", async () => {
  LIVE_DEALS = await loadDeals();
  LIVE_CATEGORIES = getCategories(LIVE_DEALS);
  renderCategoryBar();
  renderFeatured();
  renderDeals();
  document.getElementById("dealCountStat").textContent = LIVE_DEALS.length;
  document.getElementById("storeCountStat").textContent = new Set(LIVE_DEALS.map(d => d.store)).size;
  document.getElementById("categoryCountStat").textContent = LIVE_CATEGORIES.length;
});
