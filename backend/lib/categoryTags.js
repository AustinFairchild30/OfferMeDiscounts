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
  Mens: ["Men's Clothing", "Men's Shoes", "Men's Accessories"]
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
  "Gourmet": "Food & Drink"
};

// Browse groups for the filter bar. With the catalog spread across 22 raw CJ
// categories, 13 of them held two deals or fewer — so most of the filter bar
// led to a page with one card on it, which reads as broken rather than
// specific. Grouping keeps every chip worth clicking while the catalog is
// still small; it can be loosened again once individual categories are deep
// enough to stand on their own.
const CATEGORY_GROUPS = {
  "Tech": ["Computer SW", "Consumer Electronics"],
  "Home": ["Home Appliances", "Furniture", "Bed & Bath"],
  "Beauty & Health": ["Cosmetics", "Nutritional Supplements", "Wellness", "Bath & Body"],
  "Sports & Outdoors": ["Sports", "Outdoors", "Golf"],
  "Fashion": ["Apparel", "Shoes", "Womens", "Mens", "Jewelry"],
  "Food & Drink": ["Gourmet"],
  "Travel": ["Hotel"],
  "Kids & Gifts": ["Babies", "Toys", "Gifts", "Flowers", "Magazines"]
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
