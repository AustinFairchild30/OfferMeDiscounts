require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const apiRouter = require("./routes/api");
const { COOKIE_NAME, verifySessionToken } = require("./lib/adminAuth");
const { readDeals } = require("./lib/dealsStore");
const { robotsTxt, sitemapXml, findStoreBySlug, relatedStores } = require("./lib/seo");
const { renderStorePage } = require("./lib/storePage");
const { injectHomeGrid } = require("./lib/homePage");
const { renderStoreIndexPage } = require("./lib/storeIndexPage");

const app = express();
const PORT = process.env.PORT || 3000;

// Render sits one reverse-proxy hop in front of this app. Without this,
// Express sees every request as coming from that proxy's own address, so
// the rate limiters in routes/api.js would treat all users as a single
// shared IP instead of each visitor's real one.
app.set("trust proxy", 1);

app.use(express.json());
app.use(cookieParser());

// Gate the admin.html page itself (not just the API) behind a session —
// otherwise anyone who finds the URL could add/edit/delete deals with no
// login at all. Runs before express.static below, which is what actually
// serves the file once this lets the request through.
app.get("/admin.html", (req, res, next) => {
  if (verifySessionToken(req.cookies?.[COOKIE_NAME])) return next();
  res.redirect("/admin-login.html");
});

// Serve the front-end from the project root — one service serves both the
// site and the API. Note this reaches OUTSIDE backend/, which is why
// render.yaml deliberately sets no rootDir; see the comment there.
//
// This is an explicit allowlist rather than express.static(SITE_ROOT). That
// served the whole repository, so backend/lib/*.js, backend/db/schema.sql,
// backend/package.json, render.yaml and README.md were all fetchable over
// HTTP. No credentials leaked (.env is gitignored, and Render injects env
// vars rather than shipping a file), but it handed out the database schema,
// the admin-auth implementation and the rate-limit thresholds to anyone who
// guessed a path. Any new top-level page or asset needs adding here.
const SITE_ROOT = path.join(__dirname, "..");
const PAGES = ["index", "about", "admin", "admin-login", "opt-in-proof", "privacy", "terms"];

app.use("/css", express.static(path.join(SITE_ROOT, "css")));
app.use("/js", express.static(path.join(SITE_ROOT, "js")));

// index.html with the deal grid filled in server-side — see lib/homePage.js.
// Read from disk once: a deploy restarts the process, which is the only way
// the file changes in production.
let INDEX_HTML = null;
function indexHtml() {
  if (INDEX_HTML === null) INDEX_HTML = fs.readFileSync(path.join(SITE_ROOT, "index.html"), "utf8");
  return INDEX_HTML;
}

app.get("/", async (req, res) => {
  // The homepage must not depend on the database being reachable. If the
  // deals query fails, serve the same client-rendered page as before rather
  // than an error — the visitor gets a working site, and only the crawler
  // loses out for that request.
  try {
    res.type("html").send(injectHomeGrid(indexHtml(), await readDeals()));
  } catch (err) {
    console.error("Home render error:", err.message);
    res.sendFile(path.join(SITE_ROOT, "index.html"));
  }
});
for (const page of PAGES) {
  app.get(`/${page}.html`, (req, res) => res.sendFile(path.join(SITE_ROOT, `${page}.html`)));
}

// Google Search Console's HTML-file verification, driven by an env var so it
// needs no code change and no deploy of ours to complete. The DNS/TXT method
// is the better one long-term — a Domain property covers apex and www in a
// single property — but it needs registrar access, which isn't always the
// same person who owns the site.
//
// Set GOOGLE_VERIFICATION_FILE to the filename Google gives you
// (e.g. "google1a2b3c4d5e6f.html"). Nothing is read from disk: the content
// is exactly the one line Google expects, generated from the name.
app.get("/google:token.html", (req, res, next) => {
  const expected = process.env.GOOGLE_VERIFICATION_FILE;
  if (!expected) return next();
  const requested = `google${req.params.token}.html`;
  if (requested !== expected.trim()) return next();
  res.type("text/plain").send(`google-site-verification: ${requested}`);
});

// --- Crawlable surface -------------------------------------------------
// Both generated from the live catalog rather than kept as static files, so
// a store that arrives in tomorrow's sync is crawlable tomorrow instead of
// whenever someone remembers to regenerate a file.
app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(robotsTxt());
});

app.get("/sitemap.xml", async (req, res) => {
  try {
    res.type("application/xml").send(sitemapXml(await readDeals()));
  } catch (err) {
    console.error("Sitemap error:", err.message);
    res.status(500).type("text/plain").send("");
  }
});

// The crawl hub: one server-rendered page linking to every store page, so a
// crawler can reach all of them from the homepage in two hops. Without it the
// store pages are orphans — the homepage builds its deal list client-side, so
// links injected there aren't reliably discovered.
app.get("/stores", async (req, res, next) => {
  try {
    res.type("html").send(renderStoreIndexPage(await readDeals()));
  } catch (err) {
    console.error("Store index error:", err.message);
    next(err);
  }
});

// A hub at /stores whose children live at the root is a confusing shape, and
// /stores/<brand>-coupons is the obvious guess — it was the first thing tried
// by hand, and Search Console rejected an indexing request for it because the
// URL simply didn't exist. Redirect rather than serve, so there's exactly one
// canonical URL per store and any mistyped or mis-pasted link still lands.
// 301 because the root-level URL is the permanent one, and it's what the
// sitemap and every canonical tag already name.
app.get("/stores/:slug", (req, res, next) => {
  const slug = String(req.params.slug || "").replace(/-coupons$/, "");
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return next();
  res.redirect(301, `/${slug}-coupons`);
});

// Per-store pages: "<brand> coupon code" is the query people actually type,
// and these are the only pages on the site a crawler can read deals from —
// everything else renders client-side from /api/deals.
//
// Registered LAST among the page routes so it can't shadow a real page:
// the pattern only matches a path ending in -coupons, and every .html page
// is already claimed above.
app.get("/:slug-coupons", async (req, res, next) => {
  const slug = String(req.params.slug || "");
  try {
    const allDeals = await readDeals();
    const found = findStoreBySlug(allDeals, slug);
    if (!found) return next();
    res.type("html").send(renderStorePage(found.store, found.deals, relatedStores(allDeals, found.store)));
  } catch (err) {
    console.error("Store page error:", err.message);
    next(err);
  }
});

// Short, sayable landing paths for campaigns that can't carry a query string.
// A connected-TV spot is generally not clickable: the viewer either scans a
// QR code or reads the URL off the screen and types it. A typed URL arrives
// with no utm_* parameters at all, so every one of those viewers would be
// recorded as "direct" and the campaign they came from would get no credit —
// on the one channel we're about to spend real money on.
//
// /tv is short enough to put on screen and still tags the visit. /tv/<slug>
// gives a spot or flight its own campaign name, so two creatives can be
// compared: /tv/launch, /tv/holiday. Redirects are 302 on purpose — a 301
// gets cached by the browser and would pin a viewer to whichever campaign
// was live the first time they visited.
const CAMPAIGN_LANDINGS = {
  tv: { source: "performance_tv", medium: "ctv", campaign: "tv_default" }
};

for (const [slug, tag] of Object.entries(CAMPAIGN_LANDINGS)) {
  const target = (campaign) =>
    `/?utm_source=${tag.source}&utm_medium=${tag.medium}&utm_campaign=${encodeURIComponent(campaign)}`;

  app.get(`/${slug}`, (req, res) => res.redirect(302, target(tag.campaign)));

  app.get(`/${slug}/:campaign`, (req, res) => {
    const raw = req.params.campaign || "";
    // Anything else is someone poking at the URL, not a real campaign — fall
    // back to the default rather than reflecting arbitrary input into the page.
    const safe = /^[A-Za-z0-9_-]{1,40}$/.test(raw) ? raw.toLowerCase() : tag.campaign;
    res.redirect(302, target(safe));
  });
}

app.use("/api", apiRouter);

app.listen(PORT, () => {
  console.log(`OfferMeDiscounts backend running at http://localhost:${PORT}`);
  console.log(`Site:  http://localhost:${PORT}/index.html`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
});
