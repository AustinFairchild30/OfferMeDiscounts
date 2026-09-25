// Awin API probe. Run this ONCE, before trusting anything awinClient.js does:
//
//   cd backend && node scripts/probe-awin.js
//
// Why this exists rather than just reading the docs: the Impact integration
// was written against the published documentation and most of it was wrong
// for the actual account — /Programs 404'd, deals turned out to live on
// /Ads?Type=COUPON rather than /Deals, and the structured discount fields
// that the docs present as the normal case were populated on 2 of 24 rows.
// Every one of those cost a debugging cycle that a single probe would have
// saved. So: find out what this account really returns, then write the
// mapping against that.
//
// It has now been run once, and the answers are recorded in the header of
// lib/awinClient.js. Keeping it is still worth it: re-run after joining
// programmes to confirm the field shapes on rows that are actually yours,
// and re-run if a sync starts returning nothing, since that is usually the
// endpoint moving rather than the mapping breaking.
//
// What it found the first time, all of which contradicted the docs-based
// first draft: promotions are POST /publisher/{id}/promotions (singular,
// POST), programmes are GET /publishers/{id}/programmes (plural), the
// tracking link is urlTracking rather than url, the code is nested at
// voucher.code and often null, and every server-side filter shape returns
// 400 or 500.
//
// Prints structure, not secrets: the token is never echoed, and sample values
// are truncated.

require("dotenv").config();

const BASE = "https://api.awin.com";

const token = process.env.AWIN_API_TOKEN;
const publisherId = process.env.AWIN_PUBLISHER_ID;

if (!token || !publisherId) {
  console.error(
    "Set AWIN_API_TOKEN and AWIN_PUBLISHER_ID in backend/.env first.\n" +
    "Both come from the Awin UI: Toolbox > API credentials (token), and your\n" +
    "publisher ID is the number shown in the top-right of the dashboard."
  );
  process.exit(1);
}

// Candidate paths, in the order most likely to be the real one. Awin has used
// both /publishers/ and /publisher/ (singular) across versions, and promotions
// have appeared as both GET and POST.
const CANDIDATES = [
  // The two known-good paths first, so a re-run answers the important
  // question — "do these still work?" — before anything else.
  { method: "GET", path: `/publishers/${publisherId}/programmes?relationship=joined` },
  { method: "POST", path: `/publisher/${publisherId}/promotions`, body: { filters: {}, pagination: { page: 1, pageSize: 5 } } },
  { method: "GET", path: `/publishers/${publisherId}/programmes` },
  { method: "GET", path: `/publisher/${publisherId}/programmes?relationship=joined` },
  { method: "GET", path: `/publishers/${publisherId}/programmedetails` },
  { method: "GET", path: `/publishers/${publisherId}/promotions` },
  { method: "GET", path: `/publisher/${publisherId}/promotions` },
  { method: "POST", path: `/publishers/${publisherId}/promotions`, body: { filters: {}, pagination: { page: 1, pageSize: 50 } } },
  { method: "POST", path: `/publisher/${publisherId}/promotions`, body: { filters: {}, pagination: { page: 1, pageSize: 50 } } },
  { method: "GET", path: `/publishers/${publisherId}/vouchers` },
  { method: "GET", path: `/publishers/${publisherId}/commissiongroups` },
  { method: "GET", path: `/accounts` }
];

function describe(value, depth = 0) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.length ? `array[${value.length}] of ${describe(value[0], depth + 1)}` : "array[0]";
  }
  if (typeof value === "object") {
    if (depth > 1) return "{…}";
    const keys = Object.keys(value);
    return `{ ${keys.slice(0, 40).join(", ")}${keys.length > 40 ? ", …" : ""} }`;
  }
  const s = String(value);
  return `${typeof value}(${s.length > 40 ? s.slice(0, 40) + "…" : s})`;
}

async function probe({ method, path, body }) {
  const label = `${method} ${path}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (err) {
    console.log(`  ✗ ${label}\n      network error: ${err.message}`);
    return null;
  }

  const text = await res.text();
  if (!res.ok) {
    // The body of a failure is often the most useful thing here — it's how
    // Impact's "No handler found" turned up.
    console.log(`  ✗ ${label}\n      HTTP ${res.status}  ${text.slice(0, 160).replace(/\s+/g, " ")}`);
    return null;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.log(`  ? ${label}\n      HTTP 200 but not JSON: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
    return null;
  }

  console.log(`  ✓ ${label}\n      ${describe(data)}`);
  const first = Array.isArray(data) ? data[0] : data?.data?.[0] || data?.promotions?.[0];
  if (first && typeof first === "object") {
    console.log("      first row:");
    for (const [k, v] of Object.entries(first).slice(0, 30)) {
      console.log(`        ${k}: ${describe(v, 1)}`);
    }
  }
  return data;
}

(async () => {
  console.log(`Probing Awin as publisher ${publisherId}\n`);

  const results = {};
  for (const candidate of CANDIDATES) {
    results[`${candidate.method} ${candidate.path}`] = await probe(candidate);
  }

  // The questions awinClient.js actually needs answered, spelled out so the
  // output can be pasted back and acted on.
  console.log(`
────────────────────────────────────────────────────────
What to check in the output above:

  1. Which path returns the JOINED programmes, and what is the
     advertiser/programme name field called?
  2. Does POST /publisher/{id}/promotions still answer, and does
     advertiser.joined still appear on the rows? That flag is the only
     thing separating your programmes from the other 32,000 promotions
     in the feed, since no server-side filter shape works.
  3. On a promotion row: which field holds the code, the description, the
     start/end dates, and the tracking/deep link?
  4. Are discounts structured (a percentage/amount field) or free text?
     Impact claimed structured and delivered text on 22 of 24 rows.
  5. Is there a US/region field per programme, for the same US-only
     filtering CJ and Impact get?

Paste this output back and the client gets written against it.
────────────────────────────────────────────────────────`);
})();
