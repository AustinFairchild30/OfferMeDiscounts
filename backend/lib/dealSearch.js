// The roadmap's "AI Deal Search: NLP input returns most relevant on-site
// offers" — the last named V1 AI deliverable. Until now the search box was a
// substring match over title/brand/store/category, so "a gift for my mom"
// or "something for a beach trip" returned nothing at all: the visitor had
// to already know a brand name to find anything.
//
// The whole catalog fits in one prompt at this size (under a hundred deals,
// roughly 30 tokens each), so this needs no embeddings, no vector store and
// no index to keep in sync — exactly the "cheap, ships in days" content-based
// approach the plan specifies for V1. Revisit if the catalog reaches the
// thousands the roadmap is aiming at.

const Anthropic = require("@anthropic-ai/sdk");

const SEARCH_MODEL = "claude-haiku-4-5-20251001";
const MAX_QUERY_LENGTH = 120;
const MAX_RESULTS = 20;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY.");
  return new Anthropic({ apiKey });
}

// What the search box did before. Still the fallback whenever the model call
// fails or the key is missing: a worse search is fine, a search box that
// throws is not.
function substringSearch(deals, query) {
  const term = query.trim().toLowerCase();
  if (!term) return deals;
  return deals.filter(
    d =>
      (d.title || "").toLowerCase().includes(term) ||
      (d.brand || "").toLowerCase().includes(term) ||
      (d.store || "").toLowerCase().includes(term) ||
      (d.category || "").toLowerCase().includes(term)
  );
}

function parseIds(text, deals) {
  const byId = new Map(deals.map(d => [d.id, d]));
  const seen = new Set();
  const out = [];
  // Only ids that exist in the catalog we just sent are accepted. The query
  // is visitor-supplied text going into a prompt, so this is what makes that
  // safe: the worst a crafted query can do is return odd results, never make
  // the endpoint emit something that isn't one of our own deals.
  for (const raw of String(text).split(/[^A-Za-z0-9]+/)) {
    if (byId.has(raw) && !seen.has(raw)) {
      seen.add(raw);
      out.push(byId.get(raw));
    }
  }
  return out.slice(0, MAX_RESULTS);
}

async function searchDeals(deals, rawQuery) {
  const query = String(rawQuery || "").trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) return { deals, mode: "all" };
  if (!deals.length) return { deals: [], mode: "empty" };

  try {
    const client = getClient();
    const catalog = deals
      .map(d => `${d.id} | ${d.store} | ${d.category} | ${d.discount || "offer"} | ${d.title}`)
      .join("\n");

    const msg = await client.messages.create({
      model: SEARCH_MODEL,
      max_tokens: 200,
      system:
        "You match a shopper's search against a list of discount deals. Reply with ONLY the ids of deals that " +
        "genuinely fit what they asked for, best match first, space-separated (e.g. d004 d017 d002). " +
        "Interpret intent generously: a search for a recipient ('gift for my mom') or an occasion ('beach trip') " +
        "should match deals that suit it, not just deals containing those words. A search for a product type " +
        "should match that type of product whatever the brand is called. " +
        "Return at most 20 ids. Return NOTHING AT ALL if no deal is a genuine fit — an empty answer is correct " +
        "and useful, and padding it with loosely-related deals is worse than returning none. " +
        "Never output anything except ids.",
      messages: [
        { role: "user", content: `Shopper searched for: ${query}\n\nDeals:\n${catalog}\n\nMatching ids:` }
      ]
    });

    const text = msg.content?.[0]?.text || "";
    const matched = parseIds(text, deals);
    // A deliberate empty answer is a real result, not a failure — the
    // catalog is thin and "we don't have that" is honest. Only fall back
    // when the call itself didn't work.
    return { deals: matched, mode: "ai" };
  } catch (err) {
    console.error("AI search unavailable, falling back to substring match:", err.message);
    return { deals: substringSearch(deals, query), mode: "fallback" };
  }
}

module.exports = { searchDeals, substringSearch, MAX_QUERY_LENGTH };
