# OfferMeDiscounts.com — Prototype

A clickable prototype of the V1 destination site described in the business
plan: browse/search deals by category, a "text to unlock" gated coupon
reveal, an admin dashboard for managing the deal catalog, and — as of this
build — a real backend that wires the SMS gate to Twilio and the deal
matching/copy to the Claude API.

## Running it

**Front-end only (mocked SMS, no setup):**
Open `index.html` directly in a browser. No install needed.

**With the real backend (real Twilio SMS + Claude deal matching):**
See `backend/README.md` for full setup (Twilio + Anthropic account
creation, `.env` config, `npm install`, `npm run dev`). Once running, the
same `index.html` talks to real APIs instead of the mock — served from
`http://localhost:3000/index.html`.

The front-end always falls back to the mock automatically if the backend
isn't running, so it never breaks either way.

## What's in here

| Path | Purpose |
|---|---|
| `index.html` | Public site: hero, featured deals, category filter, search, deal grid |
| `admin.html` | Admin dashboard: stats, add/edit/delete deals, category management |
| `css/styles.css` | All styling |
| `js/deals-data.js` | Seed data — 24 sample deals across 8 categories |
| `js/store.js` | Shared localStorage-backed "deal store" used by both front-end pages |
| `js/app.js` | Public site logic: search, filtering, the SMS-gate modal (real + mock) |
| `js/admin.js` | Admin CRUD logic (still localStorage-only — see below) |
| `backend/` | Node/Express server: Twilio Verify + SMS, Claude deal matching/copy |
| `backend/README.md` | Twilio + Anthropic account setup and run instructions |

## Why plain HTML/CSS/JS on the front-end

This was originally scaffolded as Next.js/React per your preference, but the
sandbox it was built in has no access to the npm package registry, so
`npm install` couldn't pull in Next/React/Tailwind. Plain HTML/CSS/JS was the
fastest path to something clickable. It ports cleanly to React later — the
backend's Express server already serves it as static files, so most of the
migration is just swapping the front-end layer.

## What's real vs. still mocked

**Real, working today:**
- Browse/search/filter deals by category and keyword; admin CRUD (title,
  discount, code, category, expiration, featured flag)
- With `backend/` running: real Twilio Verify OTP send + check, real SMS
  delivery, Claude picking the best-matching deal and writing the SMS copy,
  and a text-in entry point (`/api/sms-inbound`) for people who text your
  Twilio number directly

**Still mocked / not built:**
- Admin dashboard writes still go to `localStorage`, not the backend —
  wiring `admin.html` to a real `/api/deals` CRUD endpoint is the natural
  next step once you're managing real inventory.
- The JSON-file user/deal store (`backend/data/`) stands in for the Postgres
  system-of-record described in the roadmap doc — fine for testing, not for
  real users.
- 10DLC/A2P registration and full TCPA compliance (consent language, quiet
  hours, opt-out handling) — required before sending real marketing SMS at
  volume, noted in `backend/README.md`.
- V2/V3 from the roadmap: AI shopping agent, cashback matching, brand
  analytics dashboard.

## Version control

This folder is a git repo (`git log` to see history). `.gitignore` at the
root and inside `backend/` keep `node_modules/`, `.env`, and the local
`users.json` file out of commits — your Twilio/Anthropic credentials should
never end up in git history.

To keep working on this in an editor like Cursor: just open this folder
(`/Users/austinfairchild/OfferMeDiscounts`) directly — it's a normal local
project, no extra setup needed.
