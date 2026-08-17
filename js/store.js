// Shared "deal store" used by both the public site (app.js) and the
// admin dashboard (admin.js). Persists to localStorage so that deals
// added/edited/removed in the admin dashboard are reflected on the
// public site in the same browser — a stand-in for the Postgres
// "system of record" described in the roadmap doc's tech stack section.

const DEALS_STORE_KEY = "omd_deals_store";
const DEALS_API_BASE = "/api/deals";

// Backend-first: if server.js is running, every read/write goes through the
// real /api/deals CRUD endpoints (backend/data/deals.json). If the backend
// is unreachable (e.g. index.html/admin.html opened as plain files), every
// function below falls back to the local-only localStorage store so the
// prototype never breaks — same pattern as the SMS gate in app.js.

function loadLocalDeals() {
  const raw = localStorage.getItem(DEALS_STORE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through to reseed
    }
  }
  localStorage.setItem(DEALS_STORE_KEY, JSON.stringify(DEALS));
  return DEALS.slice();
}

async function loadDeals() {
  try {
    const res = await fetch(DEALS_API_BASE);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const deals = await res.json();
    localStorage.setItem(DEALS_STORE_KEY, JSON.stringify(deals));
    return deals;
  } catch (err) {
    console.warn("Backend unavailable, using local deal store:", err.message);
    return loadLocalDeals();
  }
}

function saveDeals(deals) {
  localStorage.setItem(DEALS_STORE_KEY, JSON.stringify(deals));
}

// A 401 means the admin session expired/was never logged in — that's a
// real "you're not allowed" answer, not a "backend is unreachable" one,
// so send the admin to log in rather than silently editing a local-only
// copy that would never actually persist.
function redirectToAdminLoginIfUnauthorized(res) {
  if (res.status === 401) {
    window.location.href = "admin-login.html";
    return true;
  }
  return false;
}

async function createDeal(payload) {
  try {
    const res = await fetch(DEALS_API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (redirectToAdminLoginIfUnauthorized(res)) return null;
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Create failed");
    return { deal: data.deal, notified: data.notified || 0 };
  } catch (err) {
    console.warn("Backend unavailable, saving locally:", err.message);
    const deals = loadLocalDeals();
    const deal = { ...payload, id: makeDealId(deals) };
    deals.push(deal);
    saveDeals(deals);
    return { deal, notified: 0 };
  }
}

async function updateDealRemote(id, payload) {
  try {
    const res = await fetch(`${DEALS_API_BASE}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (redirectToAdminLoginIfUnauthorized(res)) return null;
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Update failed");
    return data.deal;
  } catch (err) {
    console.warn("Backend unavailable, updating locally:", err.message);
    const deals = loadLocalDeals().map(d => (d.id === id ? { ...d, ...payload } : d));
    saveDeals(deals);
    return deals.find(d => d.id === id);
  }
}

async function deleteDealRemote(id) {
  try {
    const res = await fetch(`${DEALS_API_BASE}/${id}`, { method: "DELETE" });
    if (redirectToAdminLoginIfUnauthorized(res)) return;
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Delete failed");
  } catch (err) {
    console.warn("Backend unavailable, deleting locally:", err.message);
    const deals = loadLocalDeals().filter(d => d.id !== id);
    saveDeals(deals);
  }
}

function getCategories(deals) {
  return [...new Set(deals.map(d => d.category))].sort();
}

function makeDealId(deals) {
  let n = deals.length + 1;
  let id = `d${String(n).padStart(3, "0")}`;
  const existing = new Set(deals.map(d => d.id));
  while (existing.has(id)) {
    n += 1;
    id = `d${String(n).padStart(3, "0")}`;
  }
  return id;
}
