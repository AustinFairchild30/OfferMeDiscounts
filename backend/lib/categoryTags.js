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

module.exports = { CATEGORY_TAGS, categoryMatchesInterests };
