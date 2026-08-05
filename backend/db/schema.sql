-- OfferMeDiscounts schema. Mirrors the shape of the old JSON-file stores
-- (backend/data/deals.json, users.json) so the app-level code barely
-- changes — dealsStore.js and userStore.js just swap fs calls for SQL.

CREATE TABLE IF NOT EXISTS deals (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  brand       TEXT,
  store       TEXT NOT NULL,
  category    TEXT NOT NULL,
  discount    TEXT,
  code        TEXT NOT NULL,
  description TEXT,
  expires     DATE NOT NULL,
  featured    BOOLEAN NOT NULL DEFAULT FALSE,
  emoji       TEXT
);

CREATE TABLE IF NOT EXISTS users (
  phone           TEXT PRIMARY KEY,
  registered_at   TIMESTAMPTZ,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  interests       JSONB NOT NULL DEFAULT '[]'::jsonb,
  favorite_brands JSONB NOT NULL DEFAULT '[]'::jsonb,
  opted_out       BOOLEAN NOT NULL DEFAULT FALSE
);

-- Safe to re-run: adds the column(s) if this schema.sql ran before they existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_brands JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS engagement_events (
  id         SERIAL PRIMARY KEY,
  phone      TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE,
  deal_id    TEXT,
  category   TEXT,
  sms_sent   BOOLEAN,
  via        TEXT,
  disliked   BOOLEAN NOT NULL DEFAULT FALSE,
  explicit   BOOLEAN NOT NULL DEFAULT FALSE,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE engagement_events ADD COLUMN IF NOT EXISTS disliked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE engagement_events ADD COLUMN IF NOT EXISTS explicit BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS engagement_events_phone_idx ON engagement_events(phone);
