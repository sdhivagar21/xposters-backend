const Product = require("../models/Product");
const { CATEGORY_SLUGS } = require("../data/categories");

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

// GET /api/products?category=&sort=&q=
async function listProducts(req, res) {
  const { category, sort, q } = req.query;
  const filter = {};

  if (category) {
    if (!CATEGORY_SLUGS.includes(category)) {
      return res.status(400).json({ message: `Unknown category: ${category}` });
    }
    filter.category = category;
  }

  if (q && q.trim()) {
    // Matches by product name OR category display name (e.g. "tamil" finds
    // everything in Tamil Movies), same behavior the frontend relied on
    // with the old local-file search.
    const needle = q.trim();
    const matchingCategories = require("../data/categories")
      .CATEGORIES.filter((c) => c.name.toLowerCase().includes(needle.toLowerCase()))
      .map((c) => c.slug);

    filter.$or = [
      { name: { $regex: needle, $options: "i" } },
      ...(matchingCategories.length ? [{ category: { $in: matchingCategories } }] : []),
    ];
  }

  let query = Product.find(filter);

  if (sort === "price-asc") query = query.sort({ price: 1 });
  else if (sort === "price-desc") query = query.sort({ price: -1 });
  else query = query.sort({ createdAt: -1 }); // "newest" default

  const products = await query.exec();
  res.json(products.map(serializeProduct));
}

// GET /api/products/featured
async function listFeatured(req, res) {
  const products = await Product.find({ featured: true }).sort({ createdAt: -1 });
  res.json(products.map(serializeProduct));
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
  }).limit(limit);

  res.json(related.map(serializeProduct));
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

module.exports = { listProducts, listFeatured, getProduct, getRelated, addReview, serializeProduct };
