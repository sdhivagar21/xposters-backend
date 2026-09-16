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

productSchema.index({ category: 1 });
productSchema.index({ name: "text" });

module.exports = mongoose.model("Product", productSchema);
