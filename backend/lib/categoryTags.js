// Fine-grained sub-tags per real CJ advertiser category, shown in the
// preference survey so "what are you into" is more specific than the raw
// category name (e.g. "Skincare" under Cosmetics, not just "Cosmetics").
// Single source of truth for both the survey UI (GET /api/category-tags)
// and personalized deal scoring (scoreDealsForUser in claudeClient.js) —
// keeping this in one place means a declared sub-tag interest always
// matches back to its parent category correctly in both places, and
// updating this list once fixes both. A category with no entry here falls
// back to showing/matching on its own raw name.
const CATEGORY_TAGS = {
  Hotel: ["Business Travel", "Family Vacations", "Romantic Getaways", "All-Inclusive Resorts"],
  Wellness: ["Vitamins & Supplements", "Skincare", "Fitness & Recovery", "Aromatherapy"],
  Outdoors: ["Camping & Hiking", "Cycling", "Fishing & Hunting", "Outdoor Apparel"],
  Sports: ["Team Sports Gear", "Fitness Equipment", "Athletic Wear", "Outdoor Sports"],
  "Computer SW": ["Productivity Software", "Security & Antivirus", "Creative & Design Tools", "Business Software"],
  Cosmetics: ["Skincare", "Makeup", "Haircare", "K-Beauty"],
  Gourmet: ["Coffee & Tea", "Snacks & Specialty Foods", "Wine & Spirits", "Meal Kits"],
  "Home Appliances": ["Kitchen Appliances", "Vacuums & Cleaning", "Small Appliances"],
  Gifts: ["Personalized Gifts", "Gift Baskets", "Flowers & Plants", "Gift Cards"],
  Furniture: ["Living Room", "Bedroom", "Office Furniture", "Outdoor Furniture"],
  "Consumer Electronics": ["Computers & Laptops", "Audio & Headphones", "Smart Home", "TVs & Displays"],
  Golf: ["Clubs & Equipment", "Golf Apparel", "Golf Accessories"],
  "Nutritional Supplements": ["Vitamins", "Protein & Fitness Supplements", "Herbal Remedies"],
  "Bed & Bath": ["Bedding & Sheets", "Towels & Bath", "Mattresses"],
  Jewelry: ["Fine Jewelry", "Fashion Jewelry", "Watches"],
  Magazines: ["News & Business", "Lifestyle", "Hobbies & Interests"],
  Womens: ["Women's Clothing", "Women's Shoes", "Women's Accessories"],
  "Bath & Body": ["Body Care", "Bath Products", "Fragrance"],
  Babies: ["Baby Gear", "Baby Clothing", "Nursery"],
  Apparel: ["Casual Wear", "Activewear", "Outerwear"],
  Flowers: ["Bouquets", "Plants", "Same-Day Delivery"],
  Toys: ["Diecast & Collectibles", "Kids Toys", "Model Kits"],
  Mens: ["Men's Clothing", "Men's Shoes", "Men's Accessories"],
  // This list is also the menu the advertiser classifier picks from (see
  // advertiserCategories.js, which passes Object.keys of it to Haiku), so a
  // category missing here cannot be assigned to anybody. Pets was in
  // CATEGORY_GROUPS but not here, which made the Pets browse group
  // unreachable by construction: Nextrition Pet could only ever come back
  // "Other" and land in the More bucket. Adding a group now means adding its
  // category here too.
  "Pets & Pet Care": ["Dog Food & Treats", "Cat Supplies", "Pet Health", "Pet Toys & Accessories"],
  // Cosmetics reads as makeup and skincare to the classifier, so a hair
  // brand — Moresoo sells extensions and wigs — came back "Other" even
  // though Cosmetics carries a Haircare sub-tag. Its own category is what
  // gets it picked.
  "Hair Care": ["Extensions & Wigs", "Shampoo & Conditioner", "Styling Tools", "Hair Treatments"],
  // Car accessories and cordless tools. Fanttik's catalog is tire inflators,
  // jump starters, car vacuums and an electric screwdriver.
  "Automotive": ["Car Accessories", "Car Care & Cleaning", "Jump Starters & Tire Inflators", "Power Tools"],
  // Glasses had no category, so the classifier reached for the nearest thing
  // on the list and filed SizeGlasses under Consumer Electronics — putting
  // prescription eyewear in the Tech browse group. A wrong-but-valid answer
  // like that is worse than "Other", because the retry in
  // advertiserCategories only re-asks about "Other": it heals a missing
  // answer, never a confident wrong one.
  "Eyewear": ["Prescription Glasses", "Sunglasses", "Blue Light Glasses", "Reading Glasses"],
  // Outdoor lighting, garden and patio. "Home & Garden" was already listed
  // under the Home group but was never on the classifier's menu, so nothing
  // could be assigned to it — the same gap that stranded Pets.
  "Home & Garden": ["Outdoor Lighting", "Garden & Patio", "Tools & Hardware", "Home Decor"],
  // Added when two art-supply advertisers turned up in the same batch of
  // Awin invitations — Silver Brush (fine artist brushes) and Golden Maple
  // (paints, canvases, model-painting supplies). One orphan is a category
  // nobody can reach; two retailers is the threshold for a browse page, so
  // this one can earn /arts-and-crafts-deals rather than sit empty.
  "Arts & Crafts": ["Paints & Brushes", "Drawing & Sketching", "Model Making", "Craft Supplies"]
};

// CJ's category names are its own internal taxonomy, not shopper language:
// "Computer SW", bare "Mens"/"Womens", and both "Bed & Bath" and "Bath &
// Body" as separate things no visitor can tell apart. The raw value stays in
// the database (it's what the advertiser actually filed the link under);
// this is only what gets shown.
const CATEGORY_LABELS = {
  "Computer SW": "Software",
  "Consumer Electronics": "Electronics",
  "Home Appliances": "Appliances",
  "Nutritional Supplements": "Supplements",
  "Bed & Bath": "Bedding",
  "Womens": "Women's",
  "Mens": "Men's",
  "Babies": "Baby",
  "Hotel": "Hotels",
  "Gourmet": "Food & Drink",
  "Pets & Pet Care": "Pets"
};

// Browse groups for the filter bar. With the catalog spread across 22 raw CJ
// categories, 13 of them held two deals or fewer — so most of the filter bar
// led to a page with one card on it, which reads as broken rather than
// specific. Grouping keeps every chip worth clicking while the catalog is
// still small; it can be loosened again once individual categories are deep
// enough to stand on their own.
// Every category a network can emit has to land in a group, or it surfaces as
// its own chip filtering 199 deals down to one. "Childrens" and "Fragrance"
// both did exactly that once Awin's catalog arrived — they existed as raw
// categories nobody had mapped, so the browse bar grew two dead ends.
const CATEGORY_GROUPS = {
  // Automotive sits here rather than under Sports & Outdoors, where it was
  // filed and never used: the only advertiser it covers sells gadgets — a
  // car vacuum and a cordless screwdriver — and a tire inflator listed
  // beside golf clubs helps nobody. If a real parts retailer ever joins,
  // that's the moment to give Automotive a group of its own; today it would
  // be a two-deal chip, which is the dead end this grouping exists to avoid.
  "Tech": ["Computer SW", "Consumer Electronics", "Computers", "Electronic Accessories", "Software", "Automotive"],
  "Home": ["Home Appliances", "Furniture", "Bed & Bath", "Home & Garden", "Bedding", "White Goods", "Appliances"],
  "Beauty & Health": ["Cosmetics", "Nutritional Supplements", "Wellness", "Bath & Body", "Fragrance", "Health & Beauty", "Supplements", "Hair Care"],
  "Sports & Outdoors": ["Sports", "Outdoors", "Golf", "Sports Equipment"],
  "Fashion": ["Apparel", "Shoes", "Womens", "Mens", "Jewelry", "Clothing", "Clothing Accessories", "Women's", "Men's", "Eyewear"],
  "Food & Drink": ["Gourmet", "FMCG"],
  "Travel": ["Hotel", "Hotels"],
  "Pets": ["Pets & Pet Care", "Pets"],
  "Arts & Crafts": ["Arts & Crafts", "Art Supplies", "Crafts", "Hobbies"],
  "Kids & Gifts": ["Babies", "Baby", "Toys", "Toys & Games", "Gifts", "Gifts & Flowers", "Flowers", "Magazines", "Childrens", "Children's"]
};

const GROUP_BY_CATEGORY = {};
for (const [group, categories] of Object.entries(CATEGORY_GROUPS)) {
  for (const category of categories) GROUP_BY_CATEGORY[category] = group;
}

// A category CJ invents tomorrow that nobody has grouped yet still needs
// somewhere to live, or its deals would silently vanish from browse.
function groupForCategory(category) {
  return GROUP_BY_CATEGORY[category] || "More";
}

function labelForCategory(category) {
  return CATEGORY_LABELS[category] || category;
}

// True if any of a user's declared interests is either the category itself
// or one of its sub-tags — so selecting "Skincare" matches a "Cosmetics"
// deal even though the strings differ.
function categoryMatchesInterests(category, interestsLower) {
  if (!category) return false;
  const categoryLower = category.toLowerCase();
  if (interestsLower.has(categoryLower)) return true;
  const tags = CATEGORY_TAGS[category] || [];
  return tags.some(t => interestsLower.has(t.toLowerCase()));
}

module.exports = {
  CATEGORY_TAGS,
  CATEGORY_LABELS,
  CATEGORY_GROUPS,
  categoryMatchesInterests,
  groupForCategory,
  labelForCategory
};
