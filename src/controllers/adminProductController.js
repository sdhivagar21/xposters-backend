const Product = require("../models/Product");
const { CATEGORY_SLUGS } = require("../data/categories");
const { uploadBufferToCloudinary, deleteFromCloudinary } = require("../utils/cloudinaryUpload");
const { serializeProduct } = require("./productController");

// GET /api/admin/products — same data as public list, but unfiltered/unsorted
// by default so the dashboard can show everything at once.
async function adminListProducts(req, res) {
  const products = await Product.find({}).sort({ createdAt: -1 });
  res.json(products.map(serializeProduct));
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
