const mongoose = require("mongoose");
const { CATEGORY_SLUGS } = require("../data/categories");

const reviewSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, required: true, enum: CATEGORY_SLUGS },
    image: { type: String, required: true }, // Cloudinary secure_url
    imagePublicId: { type: String }, // Cloudinary public_id, needed to delete/replace the image later
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    featured: { type: Boolean, default: false },
    reviews: [reviewSchema],
  },
  { timestamps: true }
);

// Every product list is sorted by createdAt (newest first) and often
// filtered by category or featured - these compound indexes let MongoDB
// satisfy the filter AND the sort from the index directly, instead of
// scanning matches and sorting them in memory. With 1500+ products this is
// the difference between a fast indexed lookup and a slow full scan.
productSchema.index({ category: 1, createdAt: -1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ featured: 1, createdAt: -1 });
productSchema.index({ name: "text" });

module.exports = mongoose.model("Product", productSchema);