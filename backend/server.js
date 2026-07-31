require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const apiRouter = require("./routes/api");
const { COOKIE_NAME, verifySessionToken } = require("./lib/adminAuth");

const app = express();
const PORT = process.env.PORT || 3000;

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

// Serve the existing front-end prototype (index.html, admin.html, css/, js/)
// straight from the project root, so the same site now talks to a real
// backend instead of the mocked localStorage flow.
app.use(express.static(path.join(__dirname, "..")));

app.use("/api", apiRouter);

app.listen(PORT, () => {
  console.log(`OfferMeDiscounts backend running at http://localhost:${PORT}`);
  console.log(`Site:  http://localhost:${PORT}/index.html`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
});
