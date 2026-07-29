require("dotenv").config();
const path = require("path");
const express = require("express");
const apiRouter = require("./routes/api");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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
