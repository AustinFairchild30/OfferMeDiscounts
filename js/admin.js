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
      <td>${d.emoji} ${d.title}${d.featured ? ' <span class="badge-pill">Featured</span>' : ""}${d.source === "cj" ? ' <span class="badge-pill">CJ</span>' : ""}</td>
      <td>${d.store}</td>
      <td><span class="badge-pill">${d.category}</span></td>
      <td>${d.discount || ""}</td>
      <td>${d.code ? `<code>${d.code}</code>` : d.link ? `<a href="${d.link}" target="_blank" rel="noopener">link</a>` : "—"}</td>
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
  document.getElementById("fCode").value = d.code || "";
  document.getElementById("fLink").value = d.link || "";
  document.getElementById("fLogoDomain").value = d.logo_domain || "";
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
    code: document.getElementById("fCode").value.trim().toUpperCase() || null,
    link: document.getElementById("fLink").value.trim() || null,
    logoDomain: document.getElementById("fLogoDomain").value.trim().replace(/^https?:\/\//, "").replace(/^www\./, "") || null,
    emoji: document.getElementById("fEmoji").value.trim() || "🏷️",
    expires: document.getElementById("fExpires").value,
    description: document.getElementById("fDescription").value.trim(),
    featured: document.getElementById("fFeatured").checked
  };

  if (!payload.title || !payload.store || !payload.expires) {
    alert("Title, store, and expiration date are required.");
    return;
  }
  if (!payload.code && !payload.link) {
    alert("Enter a coupon code, a tracking link, or both.");
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

async function handleSyncCj(e) {
  const btn = e?.target;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch("/api/deals/sync-cj", { method: "POST" });
    if (redirectToAdminLoginIfUnauthorized(res)) return;
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Sync failed");
    await refreshAll();
    const skippedNote = data.skipped ? `, ${data.skipped} skipped (excluded)` : "";
    showToast(`Synced from CJ — ${data.created} new, ${data.updated} updated${skippedNote}`);
  } catch (err) {
    alert(`CJ sync failed: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// The Impact sync had no button: it only ever ran from the nightly cron
// route, which needs the cron secret. That left no way to run one network
// without the other, or to see the result of a catalog change before the
// next morning.
async function handleSyncImpact(e) {
  const btn = e?.target;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch("/api/deals/sync-impact", { method: "POST" });
    if (redirectToAdminLoginIfUnauthorized(res)) return;
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Sync failed");
    // runImpactSync returns this instead of syncing when the Impact
    // credentials aren't set on the server, and reports success either way.
    if (data.skipped === "not configured") {
      showToast("Impact isn't configured on the server — nothing synced.");
      return;
    }
    await refreshAll();
    // Pruned is the count this sync deleted — deals the deduper or the
    // per-advertiser cap dropped. Worth showing: it's the one number here
    // that goes down, and seeing it as zero is how you'd notice the prune
    // silently doing nothing.
    const prunedNote = data.pruned?.removed ? `, ${data.pruned.removed} pruned` : "";
    const skippedNote = data.skipped ? `, ${data.skipped} skipped (excluded)` : "";
    showToast(`Synced from Impact — ${data.created} new, ${data.updated} updated${prunedNote}${skippedNote}`);
  } catch (err) {
    alert(`Impact sync failed: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

document.addEventListener("DOMContentLoaded", () => {
  refreshAll();
  loadFunnel();
  loadSearches();
});

/* ---------------- Funnel report ---------------- */

const FUNNEL_LABELS = {
  page_view: "Visited the site",
  deal_view: "Opened a deal",
  phone_submit: "Entered a number",
  otp_verified: "Verified the number",
  code_revealed: "Got the code"
};

function pct(n) {
  return `${n.toFixed(1)}%`;
}

async function loadFunnel() {
  const panel = document.getElementById("funnelPanel");
  if (!panel) return;
  const days = document.getElementById("funnelDays").value;

  let report;
  try {
    const res = await fetch(`/api/admin/funnel?days=${days}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Request failed");
    report = data.report;
  } catch (err) {
    panel.innerHTML = `<p style="color:var(--brand-coral-dark);">Couldn't load the funnel: ${err.message}</p>`;
    return;
  }

  const top = report.funnel[0]?.visitors || 0;
  if (!top) {
    panel.innerHTML = `<p style="color:var(--ink-soft);">No traffic recorded in this window yet. Steps are logged from the live site as visitors move through it.</p>`;
    return;
  }

  // Each row's bar is width-proportional to the top of the funnel, so the
  // drop-offs are visible at a glance rather than needing the numbers read.
  const rows = report.funnel.map((f, i) => {
    const prev = i === 0 ? null : report.funnel[i - 1];
    const lost = prev ? prev.visitors - f.visitors : 0;
    return `
      <div class="funnel-row">
        <div class="funnel-label">${FUNNEL_LABELS[f.step] || f.step}</div>
        <div class="funnel-track"><div class="funnel-bar" style="width:${Math.max(f.ofTop, 1)}%"></div></div>
        <div class="funnel-figures">
          <strong>${f.visitors}</strong>
          <span>${pct(f.ofTop)} of visitors${prev ? ` · ${pct(f.ofPrevious)} of previous step` : ""}${lost > 0 ? ` · lost ${lost}` : ""}</span>
        </div>
      </div>`;
  }).join("");

  const campaigns = report.campaigns.length
    ? report.campaigns.map(c => `
        <tr>
          <td>${c.source}${c.medium ? ` <span style="color:var(--ink-soft);">/ ${c.medium}</span>` : ""}</td>
          <td>${c.campaign || "—"}</td>
          <td>${c.visitors}</td>
          <td>${c.registered}</td>
          <td>${c.visitors ? pct((c.registered / c.visitors) * 100) : "—"}</td>
          <td>${c.outbound_clicks}</td>
        </tr>`).join("")
    : `<tr><td colspan="6" style="color:var(--ink-soft);">Nothing recorded yet.</td></tr>`;

  const deals = report.deals.length
    ? report.deals.map(d => `
        <tr>
          <td>${d.store || d.deal_id}</td>
          <td>${d.discount || "—"}</td>
          <td>${d.views}</td>
          <td>${d.copies}</td>
          <td>${d.clicks}</td>
        </tr>`).join("")
    : `<tr><td colspan="5" style="color:var(--ink-soft);">Nothing recorded yet.</td></tr>`;

  panel.innerHTML = `
    <div class="funnel-wrap">${rows}</div>
    <div class="stat-cards" style="margin-top:18px;">
      <div class="stat-card"><div class="label">Outbound clicks</div><div class="value">${report.outboundClicks}</div></div>
      <div class="stat-card"><div class="label">Codes copied</div><div class="value">${report.codeCopies}</div></div>
      <div class="stat-card"><div class="label">Visitor → registered</div><div class="value">${pct(report.funnel[3]?.ofTop || 0)}</div></div>
    </div>

    <div class="section-head"><h2 style="font-size:16px;">Where they came from</h2></div>
    <div style="overflow-x:auto;">
      <table class="admin-table">
        <thead><tr><th>Source</th><th>Campaign</th><th>Visitors</th><th>Registered</th><th>Rate</th><th>Outbound</th></tr></thead>
        <tbody>${campaigns}</tbody>
      </table>
    </div>

    <div class="section-head"><h2 style="font-size:16px;">What people searched for</h2></div>
    <div id="searchPanel"><p style="color:var(--ink-soft);">Loading&hellip;</p></div>

    <div class="section-head"><h2 style="font-size:16px;">Deals people acted on</h2></div>
    <div style="overflow-x:auto;">
      <table class="admin-table">
        <thead><tr><th>Store</th><th>Discount</th><th>Views</th><th>Copies</th><th>Outbound</th></tr></thead>
        <tbody>${deals}</tbody>
      </table>
    </div>`;
}


async function loadSearches() {
  const panel = document.getElementById("searchPanel");
  if (!panel) return;
  const days = document.getElementById("funnelDays").value;

  let report;
  try {
    const res = await fetch(`/api/admin/searches?days=${days}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Request failed");
    report = data.report;
  } catch (err) {
    panel.innerHTML = `<p style="color:var(--brand-coral-dark);">Couldn't load searches: ${err.message}</p>`;
    return;
  }

  if (!report.searches) {
    panel.innerHTML = `<p style="color:var(--ink-soft);">No searches recorded in this window yet.</p>`;
    return;
  }

  // Misses lead, because they're the actionable half: each one is a visitor
  // telling you which retailer to go sign.
  const missRate = Math.round((report.empty / report.searches) * 100);
  const misses = report.misses.length
    ? report.misses.map(m => `<tr><td>${m.query}</td><td>${m.times}</td></tr>`).join("")
    : `<tr><td colspan="2" style="color:var(--ink-soft);">Every search found something.</td></tr>`;
  const hits = report.hits.length
    ? report.hits.map(h => `<tr><td>${h.query}</td><td>${h.times}</td><td>${h.avg_results}</td></tr>`).join("")
    : `<tr><td colspan="3" style="color:var(--ink-soft);">Nothing yet.</td></tr>`;

  panel.innerHTML = `
    <div class="stat-cards" style="margin-bottom:16px;">
      <div class="stat-card"><div class="label">Searches</div><div class="value">${report.searches}</div></div>
      <div class="stat-card"><div class="label">Found nothing</div><div class="value">${report.empty}</div></div>
      <div class="stat-card"><div class="label">Miss rate</div><div class="value">${missRate}%</div></div>
    </div>
    <div style="overflow-x:auto;">
      <p style="font-size:13px;color:var(--ink-soft);margin:0 0 8px;">
        Searches that returned nothing &mdash; what visitors wanted that you don't stock yet.
      </p>
      <table class="admin-table">
        <thead><tr><th>Search</th><th>Times</th></tr></thead>
        <tbody>${misses}</tbody>
      </table>
    </div>
    <div style="overflow-x:auto;margin-top:16px;">
      <p style="font-size:13px;color:var(--ink-soft);margin:0 0 8px;">Searches that found something.</p>
      <table class="admin-table">
        <thead><tr><th>Search</th><th>Times</th><th>Avg results</th></tr></thead>
        <tbody>${hits}</tbody>
      </table>
    </div>`;
}
