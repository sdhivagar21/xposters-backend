const Product = require("../models/Product");
const { CATEGORIES, CATEGORY_SLUGS } = require("../data/categories");

function serializeProduct(doc) {
  const p = doc.toObject ? doc.toObject() : doc;
  return {
    id: p._id.toString(),
    name: p.name,
    price: p.price,
    category: p.category,
    image: p.image,
    description: p.description || "",
    featured: p.featured,
    reviews: (p.reviews || []).map((r) => ({
      id: r._id.toString(),
      name: r.name,
      rating: r.rating,
      comment: r.comment,
    })),
    createdAt: p.createdAt,
  };
}

// Lighter shape for list/grid views - no reviews array, no description.
// With 1500+ products this cuts the payload size a lot.
function serializeCard(doc) {
  const p = doc.toObject ? doc.toObject() : doc;
  return {
    id: p._id.toString(),
    name: p.name,
    price: p.price,
    category: p.category,
    image: p.image,
    featured: p.featured,
    createdAt: p.createdAt,
  };
}

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;

// GET /api/products?category=&sort=&q=&page=&limit=
async function listProducts(req, res) {
  const { category, sort, q, page, limit } = req.query;
  const filter = {};

  if (category) {
    if (!CATEGORY_SLUGS.includes(category)) {
      return res.status(400).json({ message: `Unknown category: ${category}` });
    }
    filter.category = category;
  }

  if (q && q.trim()) {
    // Matches by product name OR category display name (e.g. "tamil" finds
    // everything in Tamil Movies), same behavior the frontend relies on.
    const needle = q.trim();
    const matchingCategories = CATEGORIES.filter((c) =>
      c.name.toLowerCase().includes(needle.toLowerCase())
    ).map((c) => c.slug);

    filter.$or = [
      { name: { $regex: needle, $options: "i" } },
      ...(matchingCategories.length ? [{ category: { $in: matchingCategories } }] : []),
    ];
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const skip = (pageNum - 1) * pageSize;

  let query = Product.find(filter).select("-reviews -description");

  if (sort === "price-asc") query = query.sort({ price: 1 });
  else if (sort === "price-desc") query = query.sort({ price: -1 });
  else query = query.sort({ createdAt: -1 }); // "newest" default

  const [products, total] = await Promise.all([
    query.skip(skip).limit(pageSize).exec(),
    Product.countDocuments(filter),
  ]);

  res.json({
    products: products.map(serializeCard),
    total,
    page: pageNum,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

// GET /api/products/featured
async function listFeatured(req, res) {
  const products = await Product.find({ featured: true })
    .select("-reviews -description")
    .sort({ createdAt: -1 })
    .limit(60);
  res.json(products.map(serializeCard));
}

// GET /api/products/sections?limit=10
// Up to `limit` newest products per category, grouped server-side, for the
// homepage. Replaces fetching the entire catalog and filtering in React.
async function listHomeSections(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 20);

  const grouped = await Product.aggregate([
    { $sort: { createdAt: -1 } },
    { $project: { name: 1, price: 1, category: 1, image: 1, featured: 1, createdAt: 1 } },
    { $group: { _id: "$category", products: { $push: "$$ROOT" } } },
    { $project: { products: { $slice: ["$products", limit] } } },
  ]);

  const sections = {};
  for (const group of grouped) {
    sections[group._id] = group.products.map(serializeCard);
  }
  res.json(sections);
}

// GET /api/products/collections-summary
// One cover image + total count per category, for the /collections tile grid.
async function listCollectionsSummary(req, res) {
  const grouped = await Product.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$category", count: { $sum: 1 }, cover: { $first: "$image" } } },
  ]);

  const summary = {};
  for (const group of grouped) {
    summary[group._id] = { count: group.count, cover: group.cover || null };
  }
  res.json(summary);
}

// GET /api/products/:id
async function getProduct(req, res) {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found" });
  res.json(serializeProduct(product));
}

// GET /api/products/:id/related?limit=6
async function getRelated(req, res) {
  const limit = Math.min(Number(req.query.limit) || 6, 12);
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found" });

  const related = await Product.find({
    category: product.category,
    _id: { $ne: product._id },
  })
    .select("-reviews -description")
    .limit(limit);

  res.json(related.map(serializeCard));
}

// POST /api/products/:id/reviews
async function addReview(req, res) {
  const { name, rating, comment } = req.body;
  if (!name || !rating || !comment) {
    return res.status(400).json({ message: "name, rating, and comment are all required" });
  }

  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found" });

  product.reviews.push({ name, rating: Number(rating), comment });
  await product.save();

  res.status(201).json(serializeProduct(product));
}

module.exports = {
  listProducts,
  listFeatured,
  listHomeSections,
  listCollectionsSummary,
  getProduct,
  getRelated,
  addReview,
  serializeProduct,
  serializeCard,
};