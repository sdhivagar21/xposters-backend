// Must stay in sync with the frontend's src/data/categories.js — these are
// the only valid `category` values a Product can have.
const CATEGORIES = [
  { slug: "tamil-movies", name: "Tamil Movies" },
  { slug: "english-movies", name: "English Movies" },
  { slug: "cars-bikes", name: "Cars & Bikes" },
  { slug: "marvel-dc", name: "Marvel & DC" },
  { slug: "anime", name: "Anime" },
  { slug: "cartoon", name: "Cartoon" },
  { slug: "motivational", name: "Motivational" },
  { slug: "sports", name: "Sports" },
  { slug: "split-posters", name: "Split Posters" },
];

const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

module.exports = { CATEGORIES, CATEGORY_SLUGS };
