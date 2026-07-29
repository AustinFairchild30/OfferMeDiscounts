// Shared "deal store" used by both the public site (app.js) and the
// admin dashboard (admin.js). Persists to localStorage so that deals
// added/edited/removed in the admin dashboard are reflected on the
// public site in the same browser — a stand-in for the Postgres
// "system of record" described in the roadmap doc's tech stack section.

const DEALS_STORE_KEY = "omd_deals_store";

function loadDeals() {
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

function saveDeals(deals) {
  localStorage.setItem(DEALS_STORE_KEY, JSON.stringify(deals));
}

function resetDeals() {
  localStorage.setItem(DEALS_STORE_KEY, JSON.stringify(DEALS));
  return DEALS.slice();
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
