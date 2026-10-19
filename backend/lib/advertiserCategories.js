// Neither Impact nor Awin returns a category on a deal, so each advertiser is
// classified once from whatever description its network provides, and the
// answer is cached in advertiser_categories. One Haiku call per NEW
// advertiser — never per deal, never per sync — so the cost is a one-off per
// brand and then zero.
//
// Lives here rather than inside impactClient because it is not Impact's: the
// cache is keyed on the store name alone, which is exactly right for a table
// that has to serve every network without letting the same brand be
// classified twice under two different rows.
const pool = require("../db/pool");
const { classifyAdvertiser } = require("./claudeClient");
const { CATEGORY_TAGS } = require("./categoryTags");

async function resolveCategories(deals) {
  const { rows } = await pool.query("SELECT advertiser, category FROM advertiser_categories");
  const known = new Map(rows.map(r => [r.advertiser, r.category]));
  const allowed = Object.keys(CATEGORY_TAGS);

  for (const deal of deals) {
    // "Other" is not an answer, it's the absence of one — either the
    // classifier failed, or nothing in the list fitted. Retrying it is what
    // makes adding a category retroactive: Pets existed as a browse group
    // for days while Nextrition Pet sat in the More bucket, because its row
    // was already cached and this loop skipped anything it had seen. Now the
    // next sync after a category is added picks those advertisers back up,
    // with no manual database work.
    //
    // The cost is bounded by how many advertisers are genuinely unclassifiable
    // — three today — and it's one Haiku call each, not one per deal.
    if (known.has(deal.store) && known.get(deal.store) !== "Other") continue;
    let category = "Other";
    try {
      // Each network names its blurb differently; take whichever is present.
      const blurb = deal.campaignDescription || deal.programmeDescription || deal.description || "";
      category = await classifyAdvertiser(deal.store, blurb, allowed);
    } catch (err) {
      // A classification failure must not cost us the deal — "Other" still
      // shows, it just lands in the "More" browse group until reclassified.
      console.error(`Could not classify ${deal.store}:`, err.message);
    }
    await pool.query(
      `INSERT INTO advertiser_categories (advertiser, category) VALUES ($1,$2)
       ON CONFLICT (advertiser) DO UPDATE SET category = EXCLUDED.category`,
      [deal.store, category]
    );
    known.set(deal.store, category);
  }

  return deals.map(d => ({ ...d, category: known.get(d.store) || "Other" }));
}

module.exports = { resolveCategories };
