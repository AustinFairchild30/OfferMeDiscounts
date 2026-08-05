// Admin dashboard logic. Reads/writes through the real /api/deals CRUD
// endpoints (backend/data/deals.json) when server.js is running, so
// changes here show up on index.html for every visitor. Falls back to
// the localStorage-only "deal store" if the backend is unreachable
// (e.g. admin.html opened as a plain file) — see js/store.js.

let deals = [];
let editingId = null;

async function adminLogout(e) {
  e.preventDefault();
  try {
    await fetch("/api/admin/logout", { method: "POST" });
  } catch {
    // ignore — redirecting either way
  }
  window.location.href = "admin-login.html";
}

async function refreshAll() {
  deals = await loadDeals();
  renderStats();
  renderTable();
  populateCategoryOptions();
}

function renderStats() {
  const cats = getCategories(deals);
  const featuredCount = deals.filter(d => d.featured).length;
  const soon = new Date();
  soon.setDate(soon.getDate() + 14);
  const expiringSoon = deals.filter(d => new Date(d.expires + "T00:00:00") <= soon).length;

  document.getElementById("statTotal").textContent = deals.length;
  document.getElementById("statCategories").textContent = cats.length;
  document.getElementById("statFeatured").textContent = featuredCount;
  document.getElementById("statExpiring").textContent = expiringSoon;
}

function populateCategoryOptions() {
  const select = document.getElementById("fCategory");
  const cats = getCategories(deals);
  const current = select.value;
  select.innerHTML =
    cats.map(c => `<option value="${c}">${c}</option>`).join("") +
    `<option value="__new__">+ New category&hellip;</option>`;
  if (cats.includes(current)) select.value = current;
}

function renderTable() {
  const tbody = document.getElementById("adminTableBody");
  if (deals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--ink-soft);padding:24px;">No deals yet. Add one above.</td></tr>`;
    return;
  }
  tbody.innerHTML = deals
    .map(
      d => `
    <tr>
      <td>${d.emoji} ${d.title}${d.featured ? ' <span class="badge-pill">Featured</span>' : ""}</td>
      <td>${d.store}</td>
      <td><span class="badge-pill">${d.category}</span></td>
      <td>${d.discount}</td>
      <td><code>${d.code}</code></td>
      <td>${d.expires}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" onclick="startEdit('${d.id}')">Edit</button>
          <button class="icon-btn danger" onclick="deleteDeal('${d.id}')">Delete</button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

function categorySelectChanged() {
  const select = document.getElementById("fCategory");
  const newWrap = document.getElementById("newCategoryWrap");
  newWrap.style.display = select.value === "__new__" ? "block" : "none";
}

function resetForm() {
  editingId = null;
  document.getElementById("dealForm").reset();
  document.getElementById("newCategoryWrap").style.display = "none";
  document.getElementById("formTitle").textContent = "Add a new deal";
  document.getElementById("submitBtn").textContent = "Add Deal";
  populateCategoryOptions();
}

function startEdit(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  editingId = id;
  document.getElementById("formTitle").textContent = `Editing: ${d.title}`;
  document.getElementById("submitBtn").textContent = "Save Changes";
  document.getElementById("fTitle").value = d.title;
  document.getElementById("fBrand").value = d.brand;
  document.getElementById("fStore").value = d.store;
  populateCategoryOptions();
  document.getElementById("fCategory").value = d.category;
  document.getElementById("fDiscount").value = d.discount;
  document.getElementById("fCode").value = d.code;
  document.getElementById("fEmoji").value = d.emoji;
  document.getElementById("fExpires").value = d.expires;
  document.getElementById("fDescription").value = d.description;
  document.getElementById("fFeatured").checked = !!d.featured;
  document.getElementById("dealForm").scrollIntoView({ behavior: "smooth" });
}

async function deleteDeal(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  if (!confirm(`Delete "${d.title}"? This can't be undone.`)) return;
  await deleteDealRemote(id);
  await refreshAll();
  showToast("Deal deleted");
}

async function submitDealForm(e) {
  e.preventDefault();

  let category = document.getElementById("fCategory").value;
  if (category === "__new__") {
    category = document.getElementById("fNewCategory").value.trim();
    if (!category) {
      alert("Enter a name for the new category.");
      return;
    }
  }

  const payload = {
    title: document.getElementById("fTitle").value.trim(),
    brand: document.getElementById("fBrand").value.trim(),
    store: document.getElementById("fStore").value.trim(),
    category,
    discount: document.getElementById("fDiscount").value.trim(),
    code: document.getElementById("fCode").value.trim().toUpperCase(),
    emoji: document.getElementById("fEmoji").value.trim() || "🏷️",
    expires: document.getElementById("fExpires").value,
    description: document.getElementById("fDescription").value.trim(),
    featured: document.getElementById("fFeatured").checked
  };

  if (!payload.title || !payload.store || !payload.code || !payload.expires) {
    alert("Title, store, code, and expiration date are required.");
    return;
  }

  if (editingId) {
    await updateDealRemote(editingId, payload);
    showToast("Deal updated");
  } else {
    const result = await createDeal(payload);
    const notified = result?.notified || 0;
    showToast(notified > 0 ? `Deal added — texted ${notified} matching user${notified === 1 ? "" : "s"}` : "Deal added");
  }

  await refreshAll();
  resetForm();
}

async function handleResetData() {
  if (!confirm("Reset all deals back to the original sample data? Your edits will be lost.")) return;
  await resetDealsRemote();
  await refreshAll();
  resetForm();
  showToast("Reset to sample data");
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

document.addEventListener("DOMContentLoaded", () => {
  refreshAll();
});
