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
// Awin's REST API is documented at https://wiki.awin.com/index.php/API but
// the promotions/voucher endpoint in particular has moved around, and what a
// given publisher account can reach depends on the programmes it has joined.
// This tries every candidate path and reports which ones answer.
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
  { method: "GET", path: `/publishers/${publisherId}/programmes?relationship=joined` },
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
  2. Is there a working promotions/voucher endpoint at all? If none of
     the candidates answered, Awin may only expose vouchers through a
     generated feed (Toolbox > Create-a-Feed) rather than the REST API —
     in which case awinClient.js needs to read that feed URL instead, and
     AWIN_PROMOTIONS_URL is the env var it will look for.
  3. On a promotion row: which field holds the code, the description, the
     start/end dates, and the tracking/deep link?
  4. Are discounts structured (a percentage/amount field) or free text?
     Impact claimed structured and delivered text on 22 of 24 rows.
  5. Is there a US/region field per programme, for the same US-only
     filtering CJ and Impact get?

Paste this output back and the client gets written against it.
────────────────────────────────────────────────────────`);
})();
