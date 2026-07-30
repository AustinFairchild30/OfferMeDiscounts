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
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: val })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Registration failed");
      goToOtpStep();
      return;
    } catch (err) {
      console.warn("Backend unavailable, falling back to demo mode:", err.message);
      // fall through to mock below
    }
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

    localStorage.setItem(STORAGE_KEY, phone);
    markUnlocked(pendingDealId);
    document.getElementById("revealCode").textContent = data.code;
    document.getElementById("revealNote").textContent = data.smsSent
      ? "You're registered! We just texted you this deal — future deals will be personalized as you engage (V2 plan)."
      : "You're registered! (SMS send skipped — check your backend's Twilio config in .env.)";
    const preview = document.getElementById("revealSmsPreview");
    if (data.message) {
      preview.style.display = "block";
      preview.innerHTML = `<strong>Claude wrote:</strong> ${data.message}`;
    } else {
      preview.style.display = "none";
    }
    showStep("stepReveal");
    return;
  }

  mockUnlock(phone, deal);
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
