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