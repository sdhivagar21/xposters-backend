# XPOSTERS BACKEND - performance fix (pagination + lightweight homepage/collections endpoints)
# Run this from INSIDE your project folder (same place you'd run 'npm install').
# It overwrites the listed files with the updated versions, nothing else.

try {
    $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $ProjectDir = (Get-Location).Path
    Write-Host "Working in: $ProjectDir" -ForegroundColor Cyan

    $target = Join-Path $ProjectDir "src\controllers\productController.js"
    Write-Host "Writing src\controllers\productController.js ..." -ForegroundColor Yellow
    $content = @'
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
'@
    $targetDir = Split-Path $target -Parent
    if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
    [System.IO.File]::WriteAllText($target, $content, $Utf8NoBom)

    $target = Join-Path $ProjectDir "src\routes\productRoutes.js"
    Write-Host "Writing src\routes\productRoutes.js ..." -ForegroundColor Yellow
    $content = @'
const express = require("express");
const {
  listProducts,
  listFeatured,
  listHomeSections,
  listCollectionsSummary,
  getProduct,
  getRelated,
  addReview,
} = require("../controllers/productController");

const router = express.Router();

// Specific routes before the "/:id" catch-all.
router.get("/featured", listFeatured);
router.get("/sections", listHomeSections);
router.get("/collections-summary", listCollectionsSummary);
router.get("/:id/related", getRelated);
router.post("/:id/reviews", addReview);
router.get("/:id", getProduct);
router.get("/", listProducts);

module.exports = router;
'@
    $targetDir = Split-Path $target -Parent
    if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
    [System.IO.File]::WriteAllText($target, $content, $Utf8NoBom)

    $target = Join-Path $ProjectDir "src\controllers\adminProductController.js"
    Write-Host "Writing src\controllers\adminProductController.js ..." -ForegroundColor Yellow
    $content = @'
const Product = require("../models/Product");
const { CATEGORY_SLUGS } = require("../data/categories");
const { uploadBufferToCloudinary, deleteFromCloudinary } = require("../utils/cloudinaryUpload");
const { serializeProduct } = require("./productController");

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// GET /api/admin/products?category=&q=&page=&limit=
// Paginated + filterable so the dashboard stays usable with a large catalog.
async function adminListProducts(req, res) {
  const { category, q, page, limit } = req.query;
  const filter = {};

  if (category) {
    if (!CATEGORY_SLUGS.includes(category)) {
      return res.status(400).json({ message: `Unknown category: ${category}` });
    }
    filter.category = category;
  }

  if (q && q.trim()) {
    filter.name = { $regex: q.trim(), $options: "i" };
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const skip = (pageNum - 1) * pageSize;

  const [products, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize),
    Product.countDocuments(filter),
  ]);

  res.json({
    products: products.map(serializeProduct),
    total,
    page: pageNum,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

// POST /api/admin/products  (multipart/form-data: image file + fields)
async function createProduct(req, res) {
  const { name, price, category, description, featured } = req.body;

  if (!name || !price || !category) {
    return res.status(400).json({ message: "name, price, and category are required" });
  }
  if (!CATEGORY_SLUGS.includes(category)) {
    return res.status(400).json({ message: `Unknown category: ${category}` });
  }
  if (!req.file) {
    return res.status(400).json({ message: "An image file is required" });
  }

  const uploaded = await uploadBufferToCloudinary(req.file.buffer, { folder: `xposters/${category}` });

  const product = await Product.create({
    name,
    price: Number(price),
    category,
    description: description || "",
    featured: featured === "true" || featured === true,
    image: uploaded.secure_url,
    imagePublicId: uploaded.public_id,
  });

  res.status(201).json(serializeProduct(product));
}

// PUT /api/admin/products/:id  (multipart/form-data; image file optional)
async function updateProduct(req, res) {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found" });

  const { name, price, category, description, featured } = req.body;

  if (category && !CATEGORY_SLUGS.includes(category)) {
    return res.status(400).json({ message: `Unknown category: ${category}` });
  }

  if (name !== undefined) product.name = name;
  if (price !== undefined) product.price = Number(price);
  if (category !== undefined) product.category = category;
  if (description !== undefined) product.description = description;
  if (featured !== undefined) product.featured = featured === "true" || featured === true;

  if (req.file) {
    const oldPublicId = product.imagePublicId;
    const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
      folder: `xposters/${product.category}`,
    });
    product.image = uploaded.secure_url;
    product.imagePublicId = uploaded.public_id;
    await deleteFromCloudinary(oldPublicId);
  }

  await product.save();
  res.json(serializeProduct(product));
}

// DELETE /api/admin/products/:id
async function deleteProduct(req, res) {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found" });

  await deleteFromCloudinary(product.imagePublicId);
  await product.deleteOne();

  res.json({ message: "Product deleted" });
}

module.exports = { adminListProducts, createProduct, updateProduct, deleteProduct };
'@
    $targetDir = Split-Path $target -Parent
    if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
    [System.IO.File]::WriteAllText($target, $content, $Utf8NoBom)

    Write-Host ""
    Write-Host "Done - 3 file(s) updated." -ForegroundColor Green
    Write-Host ""
    Write-Host "Now review with: git status" -ForegroundColor Cyan
    Write-Host "Then commit and push with:" -ForegroundColor Cyan
    Write-Host "  git add ." -ForegroundColor Cyan
    Write-Host '  git commit -m "Fix slow loading - add pagination"' -ForegroundColor Cyan
    Write-Host "  git push" -ForegroundColor Cyan
} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Write-Host ""
    Read-Host "Press Enter to close this window"
}
