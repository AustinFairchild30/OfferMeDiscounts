# OfferMeDiscounts backend

Implements the "week 1 core loop" from the project plan: a visitor texts
in (or requests a code on the site) → Twilio Verify sends a one-time code →
on confirmation, Claude picks/writes a personalized deal message → Twilio
sends the SMS. This replaces the mocked flow in the front-end prototype.

## 1. Create a Twilio account

1. Sign up at [twilio.com/try-twilio](https://www.twilio.com/try-twilio) (free trial includes credit).
2. From the [Twilio Console](https://console.twilio.com) dashboard, copy your **Account SID** (top of the dashboard). Then create an **API Key** (Twilio's recommended auth method over the account Auth Token — Console → Account → [API keys & tokens](https://console.twilio.com/us1/account/keys-credentials/api-keys) → Create API key, "Standard" type). Copy the **SID** (starts with `SK`) and **Secret** (shown once) into `.env`.
3. Get a phone number: Console → Phone Numbers → Buy a Number (a US local or toll-free number works; toll-free numbers verify faster for messaging). Copy it in E.164 format (e.g. `+18885551234`) into `TWILIO_FROM_NUMBER`.
4. Create a Verify Service: Console → Verify → Services → Create new Service (name it "OfferMeDiscounts"). Copy the **Service SID** (starts with `VA`) into `TWILIO_VERIFY_SERVICE_SID`.
5. **Trial account note:** while on a free trial, Twilio can only send SMS to phone numbers you've verified as "Caller IDs" in the console (Console → Phone Numbers → Verified Caller IDs). Add your own phone number there to test. Verify OTP codes work the same way — the phone receiving the code must be a verified number on trial accounts.
6. **A2P 10DLC registration:** for any real (non-trial) SMS volume in the US, Twilio requires registering your business/campaign for 10DLC compliance (Console → Messaging → Regulatory Compliance). This takes days to weeks — start it early, well before you need real send volume. Not required just to test locally on a trial account.

## 2. Get an Anthropic API key

1. Sign up / log in at [console.anthropic.com](https://console.anthropic.com).
2. Go to API Keys → Create Key. Copy it into `ANTHROPIC_API_KEY`.
3. Add billing / credits if needed (Console → Billing) — the free trial credit is usually enough for prototype-level testing.

## 3. Set up the database

The app stores deals/users in Postgres (currently [Neon](https://neon.tech), free tier).

1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. Copy the connection string it gives you into `DATABASE_URL` in `.env`.
3. Run the migration once to create the schema and seed the deal catalog:
   ```bash
   npm run migrate
   ```
   Safe to re-run — it skips seeding if the `deals` table already has rows.

## 4. Set up admin login

`admin.html` (add/edit/delete deals) requires logging in — set two values in `.env`:

- `ADMIN_PASSWORD` — pick your own password.
- `SESSION_SECRET` — a random signing secret, not something you type in anywhere. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

## 5. Configure and install

```bash
cd backend
cp .env.example .env
# open .env and fill in the 8 values from steps 1-4 above
npm install
```

## 6. Run it

```bash
npm run dev
```

This starts a single server on `http://localhost:3000` that serves both the
front-end (`/index.html`, `/admin.html`) and the API (`/api/...`). Open
`http://localhost:3000/index.html` in your browser — the "Text Me the Code"
flow now hits your real Twilio + Claude integration instead of the mock.

If the backend isn't running (or you open `index.html` directly as a file),
the front-end automatically falls back to the old mock flow — nothing
breaks either way.

## 7. Test the inbound-text flow (optional, needs a public URL)

To let people text your Twilio number directly (the "text number to begin"
entry point from the plan), Twilio needs to reach your local server over the
internet. Use [ngrok](https://ngrok.com) for local testing:

```bash
ngrok http 3000
```

Copy the `https://...ngrok-free.app` URL it gives you, then in the Twilio
Console: Phone Numbers → your number → Messaging → "A message comes in" →
set the webhook to `https://YOUR-NGROK-URL/api/sms-inbound` (method POST).
Now texting your Twilio number triggers the same registration + deal-match
flow as the website.

## What this does NOT include yet

- 10DLC/A2P registration and TCPA compliance (consent language, quiet hours,
  opt-out handling) needed before sending real marketing SMS at volume.
- The V2/V3 features from the roadmap (AI shopping agent, cashback matching,
  brand analytics) — this covers V1's core loop only.
