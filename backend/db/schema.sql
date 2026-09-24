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
  code        TEXT,
  description TEXT,
  expires     DATE NOT NULL,
  featured    BOOLEAN NOT NULL DEFAULT FALSE,
  emoji       TEXT,
  link        TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  cj_link_id  TEXT,
  logo_domain TEXT,
  link_check_failures INTEGER NOT NULL DEFAULT 0
);

-- code used to be required (coupon-code redemption only); CJ-sourced deals
-- are often a tracking link with no code, so it's optional now.
ALTER TABLE deals ALTER COLUMN code DROP NOT NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS cj_link_id TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS logo_domain TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS link_check_failures INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS deals_cj_link_id_idx ON deals(cj_link_id) WHERE cj_link_id IS NOT NULL;

-- Deleting a CJ-sourced deal from the admin dashboard records its link-id
-- here, so a later "Sync from CJ" doesn't silently re-add it.
CREATE TABLE IF NOT EXISTS cj_excluded_links (
  cj_link_id  TEXT PRIMARY KEY,
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  copied     BOOLEAN NOT NULL DEFAULT FALSE,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE engagement_events ADD COLUMN IF NOT EXISTS disliked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE engagement_events ADD COLUMN IF NOT EXISTS explicit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE engagement_events ADD COLUMN IF NOT EXISTS copied BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS engagement_events_phone_idx ON engagement_events(phone);

-- Funnel instrumentation. Deliberately a separate table from
-- engagement_events, which is keyed on a phone number that REFERENCES users
-- and so can only ever describe someone who already registered — exactly the
-- people whose behaviour we already understand. The interesting question is
-- where the other visitors drop out, so this is keyed on an anonymous
-- visitor_id generated in the browser, with phone backfilled at the moment
-- someone verifies. That backfill is what turns a stack of anonymous steps
-- into an attributable conversion.
CREATE TABLE IF NOT EXISTS funnel_events (
  id         BIGSERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  phone      TEXT,
  step       TEXT NOT NULL,
  deal_id    TEXT,
  -- First-touch attribution, captured once per visitor and replayed on every
  -- later event, so a conversion still names the campaign that produced it
  -- rather than whatever the last referrer happened to be.
  source     TEXT,
  medium     TEXT,
  campaign   TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funnel_events_step_at_idx ON funnel_events(step, at);
CREATE INDEX IF NOT EXISTS funnel_events_visitor_idx ON funnel_events(visitor_id);
CREATE INDEX IF NOT EXISTS funnel_events_campaign_idx ON funnel_events(campaign) WHERE campaign IS NOT NULL;

-- What people searched for and whether we had it. Zero-result searches are
-- the most directly actionable data this site produces right now: with a thin
-- catalog, "what are visitors asking for that we don't stock" answers which
-- advertisers to apply to next, rather than guessing from category lists.
CREATE TABLE IF NOT EXISTS search_queries (
  id           BIGSERIAL PRIMARY KEY,
  query        TEXT NOT NULL,
  result_count INTEGER NOT NULL,
  mode         TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_queries_at_idx ON search_queries(at);

-- Real modification time, so sitemap <lastmod> can be honest. Google only
-- trusts that field if it's consistently accurate; a sitemap where every URL
-- claims it changed today, every day, teaches it to ignore the field entirely.
-- Crucially this is only bumped when a value actually differs (see
-- upsertCjDeals) — the daily sync touches every row, so an unconditional
-- update would recreate exactly the problem it's meant to fix.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Optional secondary contact, collected at the survey step. The roadmap's V1
-- spec is "text plus email as secondary engagement", and email was the one
-- named V1 deliverable never built. Deliberately nullable and never required:
-- the phone number is the account, and making this mandatory would add
-- friction to the highest-drop-off point in the funnel to collect a channel
-- that's strictly a hedge.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- Impact.com is the second affiliate network. Kept as its own id column
-- rather than reusing cj_link_id so the two networks dedupe and exclude
-- independently — an Impact ad and a CJ link are different objects even when
-- they point at the same brand.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS impact_ad_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS deals_impact_ad_id_idx ON deals(impact_ad_id) WHERE impact_ad_id IS NOT NULL;

-- Impact returns no category on an ad or a campaign — unlike CJ, which files
-- every link under one. Without a category a deal lands in the "More" browse
-- group, which is the empty-chip problem the grouping exists to prevent. The
-- brand's own CampaignDescription is descriptive enough to classify from, so
-- it's done once per advertiser and cached here rather than on every sync.
CREATE TABLE IF NOT EXISTS advertiser_categories (
  advertiser  TEXT PRIMARY KEY,
  category    TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'llm',
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same role as cj_excluded_links, for the other network: deleting an
-- Impact-sourced deal from the admin dashboard has to stick across syncs, or
-- tomorrow's sync just puts it back.
-- Third network. Same shape as the other two rather than a generic
-- (source, external_id) pair: the existing columns and their partial unique
-- indexes already work, and changing that shape would mean migrating live
-- rows from two networks to gain tidiness and nothing else.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS awin_promotion_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS deals_awin_promotion_id_idx
  ON deals(awin_promotion_id) WHERE awin_promotion_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS awin_excluded_promotions (
  awin_promotion_id TEXT PRIMARY KEY,
  excluded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS impact_excluded_ads (
  impact_ad_id TEXT PRIMARY KEY,
  excluded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A ready-to-use logo URL, for sources that serve their own brand logo.
-- Impact does (behind its API credentials, hence the proxy at /api/logo);
-- CJ doesn't, so CJ deals leave this null and keep falling back to the
-- Hunter.io lookup driven by logo_domain.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS logo_url TEXT;
