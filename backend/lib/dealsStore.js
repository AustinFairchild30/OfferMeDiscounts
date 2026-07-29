// Deal storage. Reads from data/deals.json — the same seed data used by
// the front-end prototype (js/deals-data.js), exported to JSON.
//
// This is a stand-in for the Postgres "deals" table + affiliate-network
// feed described in the roadmap doc. Swap readDeals()/writeDeals() for
// real DB calls when you're ready to move off the file store.

const fs = require("fs");
const path = require("path");

const DEALS_PATH = path.join(__dirname, "..", "data", "deals.json");

function readDeals() {
  const raw = fs.readFileSync(DEALS_PATH, "utf8");
  return JSON.parse(raw);
}

function writeDeals(deals) {
  fs.writeFileSync(DEALS_PATH, JSON.stringify(deals, null, 2));
}

function getDealById(id) {
  return readDeals().find(d => d.id === id) || null;
}

module.exports = { readDeals, writeDeals, getDealById };
