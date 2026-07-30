// Deal storage. Reads from data/deals.json — the same seed data used by
// the front-end prototype (js/deals-data.js), exported to JSON.
//
// This is a stand-in for the Postgres "deals" table + affiliate-network
// feed described in the roadmap doc. Swap readDeals()/writeDeals() for
// real DB calls when you're ready to move off the file store.

const fs = require("fs");
const path = require("path");

const DEALS_PATH = path.join(__dirname, "..", "data", "deals.json");
const SEED_PATH = path.join(__dirname, "..", "data", "deals.seed.json");

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

function addDeal(payload) {
  const deals = readDeals();
  const deal = { ...payload, id: makeDealId(deals) };
  deals.push(deal);
  writeDeals(deals);
  return deal;
}

function updateDeal(id, payload) {
  const deals = readDeals();
  const idx = deals.findIndex(d => d.id === id);
  if (idx === -1) return null;
  deals[idx] = { ...deals[idx], ...payload, id };
  writeDeals(deals);
  return deals[idx];
}

function removeDeal(id) {
  const deals = readDeals();
  const idx = deals.findIndex(d => d.id === id);
  if (idx === -1) return false;
  deals.splice(idx, 1);
  writeDeals(deals);
  return true;
}

function resetToSeed() {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
  writeDeals(seed);
  return seed;
}

module.exports = { readDeals, writeDeals, getDealById, addDeal, updateDeal, removeDeal, resetToSeed };
