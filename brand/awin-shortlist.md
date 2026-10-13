# Awin target shortlist

Rebuilt 2026-10-13 from **real voucher counts** — 31,210 promotions
scanned, every advertiser with at least one US-serving voucher.

Earlier versions of this file ranked by category inference because I believed
the promotions endpoint was down. It wasn't: my probes used `pageSize: 5`,
below the API's minimum of 10, and Awin answers that with a 500 rather than a
400. See the header of `backend/lib/awinClient.js`.

Excluded here: the 25 programmes already joined, every advertiser
previously recommended, known rejections, regional duplicates, anything the
blocklist rejects, and advertisers with zero US vouchers.

## Do not apply — zero US vouchers

These were recommended in earlier batches on category inference and have **no
coupon inventory at all**. Approval produces nothing, which is the King Koil
outcome 40 times over.

> ANRAN, AoonuAuto, AutoPartsToys, Bambu Lab, ChessHouse, Comgrow, Dabbsson, De'Longhi, Dmoose, EKR, Fera Pets, Glass.com, Goplus, GritrOutdoors, HULKMAN, Hobbytron, ISOtunes, Jasco, Kaabo, KastKing, Mi Rancho, Nicecnc, Perfect Snacks, PetLab Co, Pupford, Qidi Tech, RadioFence, Redodo, SEALIGHT, Saris, TORRO, Thinkcar, Unistellar, Viking Bags, Wham-O, Wuffes, Wurth USA, Xtrons, labworkauto, meowbox

## Targets, by verified US voucher count

| Advertiser | Awin ID | US vouchers | Category | Site |
|---|---|---|---|---|
| Hernest Home Decor | `58525` | 100 | Home & Garden | hernest.com |
| PetPlate | `70899` | 79 | Home & Garden | petplate.com |
| Sephra LP | `88379` | 72 | FMCG | sephrausa.com |
| Clever Fox | `95765` | 65 | Gifts & Flowers | cleverfoxplanner.com |
| Joy Organics | `91727` | 56 | Health & Beauty | joyorganics.com |
| HTVRont | `68106` | 52 | Home & Garden | htvront.com |
| The Trusted Lab | `82765` | 31 | Health & Beauty | thetrustedlab.com |
| Greetabl | `90201` | 31 | Gifts & Flowers | greetabl.com |
| Fontana Candle Co. | `92227` | 28 | Home & Garden | fontanacandlecompany.com |
| mindbodygreen | `81633` | 27 | Health & Beauty | shop.mindbodygreen.com |
| Apothékary | `58777` | 25 | Health & Beauty | apothekary.com |
| Subset | `86665` | 24 | Clothing | wearsubset.com |
| Big Horn Outdoors | `117809` | 22 | White Goods | bighornoutdoor.com |
| Case Luggage | `121020` | 22 | Home & Garden | caseluggage.com |
| Ice Barrel | `82317` | 22 | Health & Beauty | icebarrel.com |
| AlorairCrawlspace | `104549` | 19 | Home & Garden | aloraircrawlspace.com |
| Vooglam | `90179` | 18 | Clothing Accessories | vooglam.com |
| BUILT (US) | `87269` | 18 | Health & Beauty | built.com |
| Neon Champ (US) | `31647` | 16 | Home & Garden | neonchamp.com |
| FLEXIMOUNTS | `89599` | 16 | Home & Garden | fleximounts.com |

Also skipped from this tier, despite the counts: DHgate and Prime Buy are
marketplaces rather than brands, Plugins-for-Wordpress is B2B, and 42Lolita
and wowangel have no US branded search.

## A caveat on quality

This batch is weaker than the first. The strongest names — UGREEN, TideWe,
Peanut Butter & Co., Perdue Farms — appeared in earlier lists because they
genuinely were the best available. What remains skews toward smaller DTC
brands with real coupon inventory but limited branded search. Worth applying
to for catalog breadth, which is its own goal; don't expect them to drive
search traffic the way a recognisable name does.

1727 eligible advertisers remain beyond this table if you want more.
Regenerate with a full scan rather than trusting this file after a month.
