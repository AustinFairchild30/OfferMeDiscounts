// CJ Affiliate Link Search API — pulls live tracking links/coupons for
// advertisers we've joined so real deals can replace the seed catalog.
// https://developers.cj.com/docs/rest-apis/link-search

const { XMLParser } = require("fast-xml-parser");

const LINK_SEARCH_URL = "https://link-search.api.cj.com/v2/link-search";
const CATEGORY_EMOJI = {
  Electronics: "💻",
  "Fashion & Apparel": "👕",
  "Beauty & Personal Care": "💄",
  "Food & Dining": "🍽️",
  Travel: "✈️",
  "Home & Garden": "🏡",
  "Fitness & Outdoors": "🏋️",
  Pets: "🐾",
  "Books & Media": "📚",
  "Baby & Kids": "🧸",
  Automotive: "🚗",
  "Entertainment & Streaming": "🎬"
};

function sixtyDaysOut() {
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 60);
  return fallback.toISOString().slice(0, 10);
}

// CJ's docs say this field is MM/DD/YYYY, but the live API actually returns
// a full timestamp like "2026-09-01 04:59:00.0" — handle both rather than
// trusting the docs.
function parseExpires(promotionEndDate) {
  if (!promotionEndDate || promotionEndDate === "ongoing") return sixtyDaysOut();

  const isoMatch = String(promotionEndDate).match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const [month, day, year] = String(promotionEndDate).split("/");
  if (!month || !day || !year) return sixtyDaysOut();
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// CJ's promotion-type ("Sale/Discount", "Seasonal Link", "Product", ...) is
// an internal category, not an actual discount amount — showing it as the
// deal's discount badge looks specific but says nothing real. Pull an
// actual figure out of the advertiser's own text when there is one, and
// otherwise leave it blank rather than show a vague label.
//
// Free shipping used to qualify. It doesn't any more: the tile gives its
// biggest element to the discount, and "Free Shipping" occupying that slot
// promises a saving the offer doesn't contain. It also can't be ranked
// against the others — there's no number in it — so it drifted to the
// bottom of every sort while still taking a card.
function deriveDiscount(promotionType, title, description) {
  // Title first, and the order is the whole point: this takes the FIRST match
  // in the string, so whichever field leads wins every disagreement. With the
  // description leading, Piscifun's "Buy 2 Get 25% OFF Clearance Items" wore a
  // 55% badge, because Awin repeats one generic description ("55% OFF
  // Clearance Promo") across every offer in the programme. The title is what
  // the visitor reads on the card, so it is what the badge has to agree with.
  const text = `${title} ${description}`;

  // 100% is never a discount in this data — it's "100% Virgin Human Hair",
  // "1 child 100% FREE", "100% free shipping", "100% satisfaction". A coupon
  // tile reading "100% OFF" looks like a scam, which is a worse outcome than
  // showing no badge at all, and a genuine 100%-off coupon would read the
  // same way anyway.
  const percentMatch = text.match(/(\d{1,3})\s*%/);
  if (percentMatch && Number(percentMatch[1]) < 100 && Number(percentMatch[1]) > 0) {
    return `${percentMatch[1]}% OFF`;
  }

  const dollarMatch = text.match(/\$(\d+(?:\.\d{2})?)\s*(?:off|discount)/i);
  if (dollarMatch) return `$${dollarMatch[1]} OFF`;

  return null;
}

// Site is US-only for the foreseeable future. CJ's structured
// `targeted-countries` field is unreliable (often blank even when the title
// clearly says "Mexico only"), so this matches on the title/description
// text instead. Excludes only on a clear non-US signal rather than
// requiring an explicit "US" tag, since most links have no country marker
// at all and are presumably fine as the default/US case.
function isNonUsTargeted(text) {
  // A price quoted in pounds or euros is a non-US offer whatever the country
  // fields say. This surfaced as a card reading "$10 OFF" above the
  // advertiser's own text, "to get £10 off on your order" — the structured
  // amount had been taken at face value and formatted as dollars.
  if (/[£€]\s*\d/.test(text)) return true;
  if (/^ca[:.]?\s/i.test(text)) return true; // "CA: ..." — this advertiser's Canada prefix convention
  if (/\b(mexico|canada|latam)\b/i.test(text)) return true;
  if (/\bmx\b/i.test(text)) return true;
  if (/\bfor\s+(mexico|latam|canada|uk|eu|australia)\s+only\b/i.test(text)) return true;
  // Advertisers name the regional storefront rather than excluding the US:
  // "20% Off ... UK Store", "10% Off for UK sitewide", "DE store link",
  // "Sidewide for DE,EU,AU,CA Store". Awin reports these as unrestricted, so
  // the structured region field passes them and only the text gives them
  // away. Six Creality offers reached the live catalog this way.
  if (/\b(uk|de|eu|au|ca|fr|es|it|nl|jp|br|mx)[\s,]*(store|sitewide|site\b)/i.test(text)) return true;
  return false;
}

// Advertisers often name links "<Offer> | <Property> | <Advertiser Name>" —
// the trailing advertiser-name segment just repeats what the card already
// shows on the store line below the title, and the raw "|" reads as a
// formatting glitch rather than a real separator.
function cleanTitle(rawTitle, store) {
  if (!rawTitle.includes("|")) return rawTitle;
  const segments = rawTitle.split("|").map(s => s.trim()).filter(Boolean);
  const storeLower = (store || "").trim().toLowerCase();
  while (segments.length > 1 && segments[segments.length - 1].toLowerCase() === storeLower) {
    segments.pop();
  }
  return segments.join(" – ") || rawTitle;
}

// Advertisers whose account name can't be turned into a brand name by rule:
// a domain with no word breaks to recover, or one account covering several
// brands (where picking which one leads is an editorial call, not a regex).
//
// Shared with Impact, which supplies a different flavour of the same problem:
// its CampaignName is whatever the advertiser typed on signup, so it can be
// the registered legal entity in its own language, or the same brand running
// two programs under two spellings. Each entry below was confirmed by
// following the deal's own tracking link to the destination it lands on —
// these are not guesses at what the name might mean.
const STORE_DISPLAY_NAMES = {
  "pinemeadowgolf.com": "Pine Meadow Golf",
  "herbspro.com": "HerbsPro",
  "zinio us": "Zinio",
  "winebasket/babybasket/capalbosonline": "Winebasket",
  "dream pairs, bruno marc, & nortiv 8 shoes": "Dream Pairs",
  // Impact. The first is a legal entity name, not a brand: its links go to
  // yilitehair.com. The next two are one brand with two Impact programs
  // (both land on sizeglasses.com), which otherwise shows as two stores and
  // gets two separate per-advertiser caps.
  "许昌市永传发制品有限公司": "Yilite Hair",
  "size glasses": "SizeGlasses",
  "sizeglasses - creator": "SizeGlasses",
  // Hyphenated region tag the generic rule deliberately won't touch, since
  // it only strips a space-separated "US" (never a word ending in "us").
  "amazon-pioneer camp-us": "Pioneer Camp",
  // Bare domain whose generic .com strip leaves it lowercase.
  "lightsaber.com": "Lightsaber",
  // Awin. Each checked against the brand's own site, not guessed: the
  // programme is crealityfalcon.com ("Your First Laser Cutter") rather than
  // the printer line, and the rest are feed casing rather than styling.
  // ZEEHOO and BLUETTI are left alone — those really are their own caps.
  "creality 3d technology": "Creality Falcon",
  "creality 3d technology llc": "Creality Falcon",
  "euhomy": "Euhomy",
  "mojawa": "Mojawa",
  "mojawa, llc": "Mojawa",
  "aloraircrawlspace": "Alorair",
  "alorair the dry air": "Alorair",
  // Awin invitations accepted 2026-10-21. Keyed on several forms of each
  // name because the programme name in the invitation list and the
  // advertiser name in the API are not always the same string, and this map
  // is consulted on the raw value before any cleaning happens.
  //
  // Each checked against the brand's own site, not guessed:
  // launchtechusa.com sells vehicle diagnostic tools, and the bare "LAUNCH"
  // left by stripping the region tag is too generic to put in a page title;
  // fntcase.com is the brand Shenzhen Feinuote actually trades under.
  "purty body affiliate program": "Purty Body",
  "purty body": "Purty Body",
  "launch us": "Launch Tech",
  "launch": "Launch Tech",
  "shenzhen feinuote electronic technology co., ltd.": "FNTCASE",
  "shenzhen feinuote electronic technology co.": "FNTCASE",
  "shenzhen feinuote electronic technology co ltd": "FNTCASE",
  "shenzhen feinuote electronic technology": "FNTCASE",
  "rarartacabinets": "Rara RTA Cabinets",
  "loveisarose.com": "Love Is A Rose",
  "loveisarose": "Love Is A Rose",
  "jumy bee - us": "Jumy Bee",
  "jumy bee": "Jumy Bee",
  // AUTELOnline is Autel's own store and we already carry Autel through
  // another programme. Without this it becomes a second store page and one
  // brand's offers split across two, each too thin to index.
  "autelonline": "Autel",
  // A programme name, not a brand: left alone it publishes as
  // /argendon-crawlspace-and-commercial-dehumidifier-coupons with that whole
  // phrase as the page title.
  "argendon crawlspace & commercial dehumidifier": "Argendon",
  "argendon crawlspace and commercial dehumidifier": "Argendon",
  "argendon": "Argendon"
};

// CJ's advertiser-name is an account name, not a brand name: it carries the
// affiliate-relationship suffix ("Stylevana Affiliate Program"), bare domains
// ("Monoprice.com"), legal suffixes ("Snaps Clothing Inc."), and region tags
// ("ZINIO US"). Since the card redesign the store name IS the card headline
// (dealCardHTML in js/app.js), so this is the most prominent text on every
// card and has to read as a brand — the title-side cleanup below never
// covered it, because back then the title was the headline.
//
// Note this deliberately takes the RAW advertiser name, not the cleaned one:
// cleanTitle/pickBestTitle compare titles against rawStore, since it's the
// raw name that advertisers repeat inside their own link names.
function cleanStoreName(store) {
  const raw = (store || "").trim();
  if (!raw) return store;

  const named = STORE_DISPLAY_NAMES[raw.toLowerCase()];
  if (named) return named;

  const cleaned = raw
    .replace(/\s*Affiliate\s*(Program)?\s*$/i, "")
    .replace(/,?\s*\b(Inc|LLC|L\.L\.C|LLP|LP|Corp|Corporation|Ltd|Co)\b\.?\s*$/i, "")
    // Region tags, case-sensitive so a word ending in "us" survives. Awin
    // writes them several ways — "Fanttik (US)", "Jumy Bee - US", "Alison US
    // CA" — and the first version of this only caught a single
    // space-separated code, so the hyphenated and multi-country forms sailed
    // through into page titles and URL slugs.
    .replace(/\s*[-\u2013\u2014]?\s*\b(US|USA|CA|UK|EU|AU|NZ)(\s+(US|USA|CA|UK|EU|AU|NZ))*\s*$/, "")
    // Awin tags the region in parentheses — "Nextrition Pet (US)", "Fanttik
    // (US)" — which is programme bookkeeping, not a brand name, and it was
    // reaching the page title, the h1 and the URL slug. Restricted to short
    // region-shaped codes so a parenthetical that is part of the name
    // survives. Only US programmes are carried, but the others are listed
    // because the tag is wrong in a title whichever country it names.
    .replace(/\s*\((US|USA|CA|UK|GB|EU|AU|NZ|INT|INTL)\)\s*$/i, "")
    .replace(/\.(com|net|org)\s*$/i, "")
    .trim();

  return cleaned || raw;
}

// Advertisers we won't carry, whatever the offer is. This isn't a quality
// bar — it's about what this site does with a deal once it has one.
//
// Tobacco, vape, adult and cannabis sit here for the carrier reason, not a
// moral one: they are SHAFT categories, and SHAFT content sent through a
// vetted toll-free number risks the number itself. Losing it would take the whole messaging
// channel, which is the actual product, not one campaign. They are also the
// largest single source of vouchers on Awin, so this is not hypothetical —
// nine of the top 120 advertisers there are vape sellers, and an
// auto-approving programme could put them in the catalog unnoticed.
//
// Every offer here can end up in a text message to a verified phone number,
// matched to that person because we inferred they'd want it. That makes a
// deal on sexual-health testing categorically different from a deal on
// vitamins: the match itself asserts something about the recipient, arriving
// unprompted on their phone where someone else may read it. It's also the
// same carrier-compliance risk that kept Joylume off the site — the toll-free
// number is vetted, and SHAFT-adjacent content put through it puts the whole
// messaging channel at risk, not just the one campaign.
//
// Names are matched on the cleaned store name, lowercased and exact. The
// regex is a second pass over the offer text for the same subject matter
// arriving under a different advertiser name; it's deliberately narrow,
// since "wellness" and "health" are ordinary retail categories we do want.
// Named outright because nothing else would catch them. Sourcemore is the
// reason this list can't be only patterns: it is the single largest voucher
// source on Awin (1,438 offers), its site says "Top Vape Shop Online", and
// its programme record carries an empty description, the sector "Lead Gen"
// and a name that reads like a sourcing marketplace. A text rule sees
// nothing. Checked against the live site, not guessed from the name.
const BLOCKED_ADVERTISERS = new Set([
  "stdcheck", "stdcheck.com",
  "sourcemore", "sourcemore.com",
  // Awin files both of these under Toys & Games, and neither name says what
  // it sells. Confirmed from the sites themselves: Adorime is "Premium Sex
  // Toys", Galaxy Treats sells "Edibles and Vapes" — hemp and mushroom
  // products. The sector label is where you would look and the last place
  // the answer is.
  "adorime", "galaxy treats", "bestrealdoll",
  // Awin files this under Toys & Games as well. Its own site: "Premium
  // eRigs" — concentrate vaporizers. Third time that sector has hidden
  // something that isn't a toy, so the sector label is now worth nothing
  // as a signal and only the site is.
  "dr.dabber", "dr dabber", "drdabber",
  // Medical marijuana card consultations. Listed by name because the subject
  // matter check reads the offer text, and a voucher reading "20% off your
  // card renewal" names nothing it could match on — which is how this
  // category of advertiser actually writes its offers. Verified from their
  // own site: "get your medical marijuana card online, same day".
  "onlinemedicalcard", "online medical card", "onlinemedicalcard.com",
  // Weapons. The F in SHAFT is firearms, and carriers read that broadly
  // enough to include archery tackle — a crossbow is a weapon however it is
  // marketed. The toll-free number is the product, not any one campaign, so
  // the trade is a handful of commissions against the whole messaging
  // channel. Both of these arrived as Awin invitations.
  "centerpoint archery", "centerpoint", "ravin crossbows", "ravin"
]);

// Excluded for the quality of what they send, NOT for what they sell. Kept
// apart from BLOCKED_ADVERTISERS on purpose: every name in that set is there
// because promoting it would breach carrier rules, and a reader who finds a
// stationery brand among the crossbow sellers will reasonably conclude it
// sells something it doesn't. Same mechanism, different reason, and the
// reason is the part worth preserving.
//
// Clever Fox sends 20 Awin rows, 18 of which are titled with a person's name
// — "Jennifer Cook", "Vicky Parrilli" — carrying that creator's own referral
// code and no discount at all. They are affiliate records that happen to be
// shaped like vouchers, not offers anyone can use, and they were 5% of the
// catalog showing strangers' names on cards. The cost of the block is the two
// genuine offers in the same feed ("10% Off Storewide" and a 15% sitewide);
// at 20 rows for 2 usable ones, the feed is not worth parsing around.
//
// Prefer a rule in looksLikePromotion to a name here, once that exists — a
// name list does not generalise to the next advertiser who does this.
const EXCLUDED_FOR_FEED_QUALITY = new Set([
  "clever fox", "cleverfox", "cleverfoxplanner"
]);

// The domain is frequently more honest than the advertiser name. "Shenzhen
// Zhuole E-commerce Co., Ltd" tells you nothing; adorime.com tells you
// everything. Checked as an exact host and also against the pattern below,
// since a giveaway word often survives in the domain when the trading name
// has been sanded smooth.
const BLOCKED_DOMAINS = new Set([
  "stdcheck.com", "sourcemore.com",
  "adorime.com", "galaxytreats.com", "bestrealdoll.com", "drdabber.com",
  "onlinemedicalcard.com",
  "centerpointarchery.com", "ravincrossbows.com"
]);

// Matched against the STORE NAME, where a loose term is safe: no legitimate
// advertiser in this catalog is called Vapor-anything, and the vape sellers
// name themselves plainly — Vapesourcing, Morevaping, Vapor Empire, Ejuice
// Connect, Flawless Vape Shop, Portable Hookahs.
const BLOCKED_STORE_PATTERN =
  /vapor|vape|vaping|hookah|shisha|e-?juice|e-?liquid|e-?cig|tobacco|cigar|nicotine|snus|smoke\s?(shop|cartel)|head\s?shop|glass\s?pipe|water\s?pipe|porn|erotic|fetish|bdsm|dildo|vibrator|sex\s?(toy|doll|shop)|real\s?doll|love\s?doll|onlyfans|brothel|adult\s?(toy|store|shop|video|film)|cannabis|marijuana|\bthc\b|\bcbd\b|delta[\s-]?[89]\b|kratom|dispensary|hemp|psilocybin|dabber|e-?rig\b|dab\s?rig|bong\b|archery|crossbow|bowhunt|firearm|ammunition|\bammo\b|gun\s?(shop|store|smith)|handgun/i;

// The weapons words are deliberately narrower in the name pattern above than
// in the offer text below, which inverts the usual rule in this file. Brand
// names use them metaphorically — Shotgun Coffee is a roaster, Pistol Lake
// sells clothes, Rifle Paper Co sells stationery — while "shop rifles and
// ammunition" in offer copy is never anything else. The actual weapons
// advertisers are caught by name and domain in the sets above.

// Matched against the OFFER TEXT, where the same looseness would misfire.
// Deliberately excludes "vapor" (a Vapormax sneaker deal), "smok" (smoked
// salmon in Gourmet, a BBQ smoker in Home) and "puff" (puffer jackets, puff
// pastry, powder puffs) — all of which appear in ordinary retail copy.
const BLOCKED_SUBJECT_MATTER =
  /\b(std|sti|hiv|herpes|chlamydia|gonorrhea|syphilis)\b|sexual(ly)?[\s-]?(health|transmitted)|\bviagra\b|\bcialis\b|erectile|\bescort\b|\b(vape|vapes|vaping|vaper|vapers)\b|\b(e-?juices?|e-?liquids?|e-?cigs?|e-?cigarettes?)\b|\b(tobacco|nicotine|hookah|shisha|cigarette|cigarettes|cigar|cigars|snus)\b|\b(porn|erotic|fetish|bdsm|dildos?|vibrators?|condoms?)\b|\bmasturbat|\bsex\s?(toys?|dolls?)\b|\b(cannabis|marijuana|thc|cbd|kratom|psilocybin|bong|bongs)\b|\bdelta[\s-]?[89]\b|\b(dab|e)[\s-]?rigs?\b|\b(head\s?shop|glass\s?pipes?|water\s?pipes?)\b|\b(archery|crossbows?|bowhunting|firearms?|ammunition|ammo|rifles?|shotguns?|handguns?|pistols?)\b/i;

function isBlockedAdvertiser(store, text = "", domain = "") {
  const name = String(store || "").trim().toLowerCase();
  const host = String(domain || "").trim().toLowerCase().replace(/^www\./, "");
  if (BLOCKED_ADVERTISERS.has(name)) return true;
  // Shares this function so purgeBlockedDeals sweeps existing rows too — it
  // is the only thing that makes adding a name retroactive.
  if (EXCLUDED_FOR_FEED_QUALITY.has(name)) return true;
  if (host && BLOCKED_DOMAINS.has(host)) return true;
  if (name && BLOCKED_STORE_PATTERN.test(name)) return true;
  if (host && BLOCKED_STORE_PATTERN.test(host)) return true;
  return BLOCKED_SUBJECT_MATTER.test(String(text || ""));
}

// --- Offer quality ------------------------------------------------------
// isBlockedAdvertiser answers "may we promote this advertiser at all". This
// section answers the question nothing asked before: "is this row an offer".
// Everything upstream assumes that if an advertiser is allowed, every row it
// sends is a deal, and Clever Fox disproved that twenty times in one feed.

// Advertisers name rows after the CREATIVE rather than the offer, because in
// their own dashboard that is the useful label: DirectDeals ships "25% Office
// Banner link" and "Shop Quickbooks and Save! banner image". The offer behind
// those is real — all 13 of its rows carry a genuine discount — so this is a
// cleaning rule, not a drop rule. Dropping them would throw away the deal to
// fix the title.
const CREATIVE_METADATA =
  /\b(?:banners?|text\s?links?|creatives?|images?|logos?|\d{3}\s?x\s?\d{2,3})\b/gi;

function stripCreativeMetadata(text) {
  return String(text || "")
    .replace(CREATIVE_METADATA, "")
    // A bare "link" can't be stripped anywhere — a link bracelet is a real
    // product — but a trailing one is always the creative label, and taking
    // "Banner" out of "25% Office Banner link" strands it there.
    .replace(/\s+links?\s*$/i, "")
    // Removing a word from the middle leaves its separators touching
    // ("10% discount - - coupon code"), and from either end leaves one
    // dangling.
    .replace(/\s*([-–—|:,])\s*(?=[-–—|:,])/g, "")
    .replace(/^[\s\-–—|:,]+|[\s\-–—|:,]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Two or three capitalised words and nothing else — "Jennifer Cook", "Vicky
// Parrilli". Initials allowed, since "April D Burwick" is the same thing.
const PERSON_NAME = /^[A-Z][a-z'’-]*\.?(?:\s+[A-Z][a-z'’-]*\.?){1,2}$/;

// Any word or symbol that means a saving. A row carrying one of these is
// making an offer however oddly it is worded, so it is not for this gate to
// judge — the point here is to catch rows that offer NOTHING.
const OFFER_WORD =
  /\b(?:off|sale|save|saving|savings|deal|deals|discount|free|bogo|clearance|bundle|gift|extra|sitewide|coupon|promo|code|voucher)\b|[%$]/i;

// Deliberately narrow. An earlier, looser version of this also dropped rows
// with "no offer word or number at all", which took 33 rows including Big
// Horn Outdoors' real '12" wood fired+ electric pizza oven' — a product, but
// an actual thing being sold at a discount. A gate that eats real offers to
// tidy the catalog is worse than the untidy catalog, so this rejects only
// what is unambiguous and leaves the rest to the drop log to argue for later.
function rejectionReason(deal) {
  const title = String(deal.title || "").trim();

  // Nothing survived cleaning, so the row was never anything but a creative
  // label — Coco Moon's "CMH_20%_728X90" is a banner filename end to end.
  if (!title) return "metadata-only title";

  // A creator's name, their personal referral code, and no discount: an
  // affiliate record shaped like a voucher. Requiring all three is what keeps
  // AVIDLOVE's "Affiliate Discount Code" — which matches the name shape on
  // word count alone — out of this.
  if (!deal.discount && !OFFER_WORD.test(title) && PERSON_NAME.test(title)) {
    return "creator-name title, no offer";
  }

  return null;
}

// Cleans, then gates, then says what it dropped. The saying matters as much
// as the dropping: a silent filter over a thin catalog starves it without
// anyone noticing, and the counts are the only way to judge whether the next
// rule is worth adding. Logs nothing when nothing is dropped.
function enforceOfferQuality(deals, network) {
  const cleaned = deals.map(deal => ({
    ...deal,
    title: stripCreativeMetadata(deal.title),
    description: stripCreativeMetadata(deal.description)
  }));

  const dropped = new Map();
  const kept = cleaned.filter(deal => {
    const reason = rejectionReason(deal);
    if (!reason) return true;
    dropped.set(reason, (dropped.get(reason) || 0) + 1);
    return false;
  });

  const retitled = cleaned.filter((deal, i) => deal.title !== String(deals[i].title || "").trim()).length;
  if (dropped.size || retitled) {
    const reasons = [...dropped.entries()].map(([reason, n]) => `${n} ${reason}`).join(", ");
    console.log(
      `[${network}] quality gate: kept ${kept.length}/${deals.length}` +
      (dropped.size ? `, dropped ${reasons}` : "") +
      (retitled ? `, cleaned ${retitled} title(s)` : "")
    );
  }
  return kept;
}

// Now-redundant since every deal is US-only (see isNonUsTargeted) — was
// only ever there to distinguish from the Mexico/Canada/LATAM variants
// that get filtered out before this point.
function stripUsPrefix(title) {
  return title.replace(/^US(\s+only)?\s*[:.]\s*/i, "").trim();
}

// Some advertisers write the real coupon code straight into the title
// ("...with Code SVBTSLC"). That defeats the whole point of the SMS gate —
// a visitor could read the working code off the card without ever
// verifying their number — so strip any mention of the deal's own code.
function stripCodeMention(title, code) {
  if (!code) return title;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withCodeWord = new RegExp(`\\s*(?:with|use|using|enter|apply)?\\s*(?:coupon|promo)?\\s*code[:\\s]+["']?${escaped}["']?`, "i");
  let cleaned = title.replace(withCodeWord, "").trim();

  // Fallback for phrasing that doesn't fit the "...code XXXX" shape (e.g.
  // "CPT10 coupon code provides..." or the code leading the title outright).
  // Prioritizes not leaking the code over a perfectly-worded title.
  const bareCode = new RegExp(`\\b${escaped}\\b`, "i");
  if (bareCode.test(cleaned)) {
    cleaned = cleaned.replace(bareCode, "").replace(/\s{2,}/g, " ").trim();
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // Lifting the code out of "…/coupon=SAVE40" or "Code：SAVE40" leaves the
  // separator dangling on the end. Trailing quotes go too, since the code is
  // usually the thing that was quoted.
  return cleaned.replace(/[\s"'“”：:=\-–—,;/|]+$/u, "").trim();
}

// Real brand logos come from a free lookup-by-domain service (Hunter.io's
// Logo API), so all we need to store is the advertiser's own domain —
// the actual image URL is built at render time on the frontend.
function extractLogoDomain(destination) {
  try {
    return new URL(destination).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Some advertisers put the code in the offer text and leave the structured
// coupon-code field empty. That's the worst of both worlds: the code is
// readable on the card without verifying, AND there's nothing for the reveal
// step to hand over afterwards, so the gate is bypassed and useless at once.
// Pulling it into the code field fixes both — stripCodeMention then takes it
// back out of the text, and the visitor gets a working code for verifying.
//
// Deliberately conservative. The captured token has to look like a code
// (carry a digit, or be written in caps) and not be an ordinary word that
// happens to follow "code", or this invents codes that don't work.
const CODE_IN_TEXT = /\b(?:coupon|promo|discount)?\s*code\s*[:=]?\s*["'\u201c]?([A-Za-z0-9][A-Za-z0-9_-]{2,19})\b/i;
// Shouted, 4-20 chars, at least one letter AND one digit, no lowercase. The
// "no lowercase" rule is doing the real work — see redactCodes.
const BARE_CODE = /\b(?=[A-Z0-9_-]{4,20}\b)(?=[A-Z0-9_-]*[A-Z])(?=[A-Z0-9_-]*\d)[A-Z][A-Z0-9_-]*\b/g;
const NOT_A_CODE = new Set([
  "the", "your", "you", "and", "for", "at", "on", "off", "use", "using", "with",
  "free", "now", "here", "below", "above", "today", "required", "needed", "applies",
  "will", "can", "any", "all", "our", "this", "that", "when", "get", "save", "is",
  "are", "not", "none", "n/a", "na", "auto", "applied", "automatically", "checkout"
]);

function extractCodeFromText(text) {
  // Normalized here too, not just by the callers: this is the function that
  // decides whether a code exists at all, and a full-width colon reaching it
  // unnormalized means the deal syncs with code = NULL and the SMS gate has
  // nothing to send. Belt and braces on the path that matters most.
  const match = CODE_IN_TEXT.exec(normalizeWidth(text));
  if (!match) return null;
  const token = match[1];
  if (NOT_A_CODE.has(token.toLowerCase())) return null;
  // A code is either alphanumeric or shouted. A lowercase all-letters token
  // after "code" is far more likely to be prose than a real coupon.
  const hasDigit = /\d/.test(token);
  const isShouted = token === token.toUpperCase() && /[A-Z]/.test(token);
  if (!hasDigit && !isShouted) return null;
  // A bare number is a quantity ("code 15 off"), not a code.
  if (/^\d+$/.test(token)) return null;
  return token;
}

// Everything that shows advertiser text to someone who hasn't verified goes
// through here: server-rendered pages, their JSON-LD, and the public catalog.
//
// stripCodeMention alone isn't enough, because it has to be told which string
// is the code. Two failure modes get past it: the structured field is empty
// and the code lives only in the text, and — worse — the structured field
// holds a DIFFERENT code than the text does (one deal carries "AFF51" while
// its title reads "Use Code:E51"). So strip the known code first, then keep
// pulling whatever still looks like a code out of the text until nothing
// does. Bounded, and stops early if a pass changes nothing, so a string
// extractCodeFromText keeps matching but stripCodeMention can't remove
// can't spin here.
function redactCodes(text, knownCode) {
  let out = normalizeWidth(text);
  if (!out) return out;
  if (knownCode) out = stripCodeMention(out, knownCode);

  for (let i = 0; i < 4; i++) {
    const found = extractCodeFromText(out);
    if (!found) break;
    const next = stripCodeMention(out, found);
    if (next === out) break;
    out = next;
  }

  // The dangerous case is the code nothing above ever identified: `code` ends
  // up NULL, so the gate has nothing to deliver AND nothing knows to strip the
  // token. Italist shipped "WELCOME5 — 5% Off" on a public card exactly this
  // way. CODE_IN_TEXT can't catch it, because it tests for the LABEL ("code:")
  // and this advertiser never wrote one — so finish with a test of the token's
  // SHAPE instead: shouted, and mixing letters with digits, which is what a
  // coupon code looks like and what prose does not.
  //
  // Rejecting anything with a lowercase letter is what makes this safe to run
  // over every card: it keeps real product names ("Falcon2", "Pearl L1") while
  // taking off WELCOME5 and OIAFF5. Model numbers like IM013 and DDL242X-15HW
  // go too, which is the right trade — losing a SKU from a title costs a word,
  // and leaving a working code on the card costs the whole business model.
  out = out.replace(BARE_CODE, "");

  // Lifting a code out of "Extra 54% OFF (code:E54)" leaves the brackets
  // behind, and those land on a deal tile. Only ever removes a bracket pair
  // that is now empty.
  // Taking a token off the FRONT of a title leaves the separator that used to
  // follow it stranded there \u2014 "WELCOME5 \u2014 5% Off" became "\u2014 5% Off", which
  // reads as a typo on the card. stripCodeMention already trims a dangling
  // separator off the end; this is the same cleanup at the other end.
  return out
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}|["\u201c]\s*["\u201d]/g, "")
    .replace(/^[\s"'\u201c\u201d:=\-\u2013\u2014,;/|_%]+/u, "")
    .replace(/[\s"'\u201c\u201d:=\-\u2013\u2014,;/|_]+$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Some advertisers occasionally leave stray markup in their description
// text (CJ's own feed, not us rendering anything) — e.g. a real Herbspro
// entry whose description was literally "<link>Special Affiliate
// Offer</link>". Strip it before this text is ever shown to a visitor.
// Advertisers paste offer text straight out of Chinese-locale tools, which
// carries full-width punctuation with it: OutIn's "...off Code：OIAFF5" uses
// U+FF1A, not a colon, and Philips writes prices as "Save ＄64.9". Every code
// pattern below keys off an ASCII ':' or '=', so that one invisible character
// defeated the detection AND the redaction at once and put a live coupon code
// on a public card. Fold the full-width block back to ASCII before any of it
// runs — and before the text is stored, so the prices render as "$64.9".
function normalizeWidth(text) {
  return String(text || "")
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[　 ]/g, " ")
    // "Save＄100" has no space because the full-width form is a wide glyph
    // that supplies its own. Once it is an ASCII '$' the words collide, so
    // give it the space back.
    .replace(/([A-Za-z])\$(?=\d)/g, "$1 $");
}

function stripHtmlTags(text) {
  return normalizeWidth(text).replace(/<\/?[^>]+>/g, "").trim();
}

// CJ's link-name is sometimes just the bare advertiser name ("Herbspro.com")
// even when the description has the actual offer ("Get 40% off all your
// orders..."). A link-name that's just a repeat of the store name is worse
// than useless as a title — it looks like a broken/placeholder card — so
// treat that the same as it being blank and fall back to the description.
function pickBestTitle(linkName, description, store) {
  const nameTrimmed = (linkName || "").trim();
  const isRedundant = !nameTrimmed || nameTrimmed.toLowerCase() === (store || "").trim().toLowerCase();
  if (!isRedundant) return nameTrimmed;
  return description || store;
}

function mapLinkToDeal(link) {
  const rawStore = link["advertiser-name"] || "";
  const store = cleanStoreName(rawStore);
  const rawDescription = stripHtmlTags(link.description || link["ad-content"] || "");
  const couponCode = link["coupon-code"];
  const code = couponCode && couponCode.trim()
    ? couponCode.trim()
    : extractCodeFromText(`${link["link-name"] || ""} ${rawDescription}`);
  // The description is shown in the deal modal ABOVE the phone gate, so a
  // code left sitting in it is readable without verifying — which is the
  // whole gate, bypassed. This ran on the title only; 21 of 80 coded deals
  // were publishing their code in the description.
  const description = redactCodes(rawDescription, code);
  const promotionType = link["promotion-type"];
  let title = cleanTitle(pickBestTitle(link["link-name"], rawDescription, rawStore), rawStore);
  title = stripUsPrefix(title);
  // redactCodes, not stripCodeMention: an advertiser can write a different
  // code in the text than the one in the structured field, and cleaning only
  // the one we were handed leaves the other sitting in the stored row.
  title = redactCodes(title, code);

  return {
    cjLinkId: String(link["link-id"]),
    title,
    brand: store,
    store,
    category: link.category || "Other",
    discount: deriveDiscount(promotionType, title, rawDescription),
    code,
    description,
    expires: parseExpires(link["promotion-end-date"]),
    link: link.clickUrl || link.clickURL,
    // The advertiser's own destination, already relied on for the logo
    // domain and guaranteed present by the filter below. The sweep checks
    // this instead of clickUrl, which counts a click every time it is
    // followed.
    checkUrl: link.destination || null,
    emoji: CATEGORY_EMOJI[link.category] || "🏷️",
    logoDomain: extractLogoDomain(link.destination)
  };
}

const RECORDS_PER_PAGE = 100;
const MAX_PAGES = 50; // safety cap — 5,000 links; avoids a runaway loop if total-matched is ever wrong

async function fetchAllCjLinks(token, websiteId) {
  const parser = new XMLParser({ ignoreAttributes: false });
  const allLinks = [];
  let page = 1;
  let totalMatched = Infinity;

  while ((page - 1) * RECORDS_PER_PAGE < totalMatched && page <= MAX_PAGES) {
    const url = `${LINK_SEARCH_URL}?website-id=${encodeURIComponent(websiteId)}&advertiser-ids=joined&records-per-page=${RECORDS_PER_PAGE}&page-number=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`CJ Link Search API returned ${res.status}: ${body.slice(0, 300)}`);
    }

    const linksNode = parser.parse(body)?.["cj-api"]?.links;
    totalMatched = Number(linksNode?.["@_total-matched"] ?? 0);
    let links = linksNode?.link || [];
    if (!Array.isArray(links)) links = [links];
    allLinks.push(...links);
    page++;
  }

  return allLinks;
}

// No single advertiser should be allowed to swamp the catalog. The Excellence
// Collection publishes one near-identical link per hotel property and grew to
// 147 deals — 60% of the entire site — against a median of 5 for everyone
// else. Hand-curating that advertiser down worked twice before and was
// outrun both times, so this is the structural version of the same call.
//
// 20 is deliberately generous: with 27 advertisers it allows a catalog of
// ~540, well clear of current volume, so it only ever bites the outliers.
const MAX_DEALS_PER_ADVERTISER = 20;

function discountRank(deal) {
  if (!deal.discount) return -1;              // code-only deals are dropped first
  const n = deal.discount.match(/(\d+(?:\.\d+)?)/);
  return n ? parseFloat(n[1]) : 0;            // a discount with no figure in it sorts last
}

// Advertisers routinely register one link per placement or property that all
// resolve to the same offer — the Excellence Collection had the same "5% OFF
// / VIP5" registered against 15+ hotels. Since a card shows store and
// discount only, those render as identical duplicates (the same way four
// SilverRushStyle "95% OFF" links once filled all four featured slots), and
// the code behind them is literally the same string, so keeping one loses
// the visitor nothing.
//
// Collapsing on (store, discount, code) deliberately does NOT merge offers
// that differ in either field — Stylevana's "20% off for members, 10% off
// for Guest shoppers" is two real, non-interchangeable offers, not a
// duplicate. Ties break toward the latest expiry, then the lowest link-id,
// so the survivor is the same one on every sync.
// Both tie-breakers below need a per-deal id that's stable between syncs, and
// the two networks name theirs differently. Falling back to the tracking link
// keeps the ordering deterministic even for a deal carrying neither.
function sourceId(deal) {
  return String(deal.cjLinkId ?? deal.impactAdId ?? deal.link ?? "");
}

function dedupeIdenticalOffers(deals) {
  const best = new Map();
  for (const deal of deals) {
    const key = `${deal.store}\u0000${deal.discount || ""}\u0000${deal.code || ""}`;
    const held = best.get(key);
    if (!held) {
      best.set(key, deal);
      continue;
    }
    const better =
      String(deal.expires || "").localeCompare(String(held.expires || "")) ||
      sourceId(held).localeCompare(sourceId(deal));
    if (better > 0) best.set(key, deal);
  }
  return [...best.values()];
}

// Which deals survive the cap is decided deterministically — real discount
// first, then size of discount, then link-id — rather than by taking the
// first N in CJ's order. CJ's ordering isn't stable between syncs, so an
// order-dependent rule would keep a different subset each day and leave the
// previous day's picks stranded in the table as orphans.
function capPerAdvertiser(deals) {
  const byStore = new Map();
  for (const deal of deals) {
    if (!byStore.has(deal.store)) byStore.set(deal.store, []);
    byStore.get(deal.store).push(deal);
  }

  const kept = [];
  for (const list of byStore.values()) {
    list.sort((a, b) =>
      discountRank(b) - discountRank(a) ||
      sourceId(a).localeCompare(sourceId(b))
    );
    kept.push(...list.slice(0, MAX_DEALS_PER_ADVERTISER));
  }
  return kept;
}

async function fetchCjDeals() {
  const token = process.env.CJ_PERSONAL_ACCESS_TOKEN;
  const websiteId = process.env.CJ_WEBSITE_ID;
  if (!token || !websiteId) {
    throw new Error("CJ_PERSONAL_ACCESS_TOKEN and CJ_WEBSITE_ID must be set in .env to sync from CJ.");
  }

  // CJ only returns 100 links per page and joined advertisers can easily have
  // 1,000+ links between them (mostly banners/product links, not deals) — has
  // to page through everything or real promotions from other advertisers get
  // silently missed once one advertiser's catalog is large.
  const allLinks = await fetchAllCjLinks(token, websiteId);

  // CJ's Link Search returns every link an advertiser has registered — banners,
  // plain product pages, tracking sub-IDs, homepage links — not just discounts.
  // promotion-type is "N/A" (or blank) on all of those; only keep links the
  // advertiser actually tagged as a real promotion.
  const deals = allLinks
    .filter(link => link && (link.clickUrl || link.clickURL) && link.destination)
    .filter(link => link["promotion-type"] && link["promotion-type"] !== "N/A")
    .filter(link => !isNonUsTargeted(link["link-name"] || link.description || ""))
    .map(mapLinkToDeal)
    // A promotion-type tag alone isn't enough — some advertisers (Marmot:
    // 23 of its 28 links) tag plain category/collection pages ("Shop Men's
    // Rain Jackets", "New Minimalist Collection") as promotional even
    // though there's no actual discount or code attached. Without either,
    // it's just a product link, not a deal.
    .filter(d => d.discount || d.code)
    .filter(d => !isBlockedAdvertiser(d.store, `${d.title} ${d.description}`, d.logoDomain));

  // ...then collapse links that are the same offer wearing different
  // link-ids, and stop any one advertiser owning the catalog. See above.
  return capPerAdvertiser(dedupeIdenticalOffers(enforceOfferQuality(deals, "cj")));
}

// Shared with impactClient.js — the two networks differ in how they deliver
// data but need identical judgement about what counts as a real offer, so
// the text-extraction and filtering helpers live here and are reused rather
// than reimplemented per network.
module.exports = {
  fetchCjDeals,
  deriveDiscount,
  isNonUsTargeted,
  stripCodeMention,
  stripHtmlTags,
  cleanStoreName,
  extractCodeFromText,
  redactCodes,
  dedupeIdenticalOffers,
  capPerAdvertiser,
  isBlockedAdvertiser,
  enforceOfferQuality,
  stripCreativeMetadata,
  BLOCKED_ADVERTISERS
};
