require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const apiRouter = require("./routes/api");
const { COOKIE_NAME, verifySessionToken } = require("./lib/adminAuth");

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

app.get("/", (req, res) => res.sendFile(path.join(SITE_ROOT, "index.html")));
for (const page of PAGES) {
  app.get(`/${page}.html`, (req, res) => res.sendFile(path.join(SITE_ROOT, `${page}.html`)));
}

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
