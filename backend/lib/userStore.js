// User storage. Simple JSON-file "database" keyed by phone number (E.164),
// standing in for the Postgres users table described in the roadmap doc
// (phone as primary key, email secondary, declared interests, engagement
// history). Fine for local prototyping; swap for real Postgres before
// you have real users.

const fs = require("fs");
const path = require("path");

const USERS_PATH = path.join(__dirname, "..", "data", "users.json");

function readUsers() {
  if (!fs.existsSync(USERS_PATH)) return {};
  const raw = fs.readFileSync(USERS_PATH, "utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function writeUsers(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

function getUser(phone) {
  const users = readUsers();
  return users[phone] || null;
}

function upsertUser(phone, patch) {
  const users = readUsers();
  const existing = users[phone] || {
    phone,
    registeredAt: null,
    verified: false,
    interests: [],
    engagement: [] // { dealId, category, sentAt }
  };
  users[phone] = { ...existing, ...patch };
  writeUsers(users);
  return users[phone];
}

function logEngagement(phone, entry) {
  const users = readUsers();
  const user = users[phone];
  if (!user) return;
  user.engagement = user.engagement || [];
  user.engagement.push({ ...entry, at: new Date().toISOString() });
  users[phone] = user;
  writeUsers(users);
}

module.exports = { readUsers, writeUsers, getUser, upsertUser, logEngagement };
