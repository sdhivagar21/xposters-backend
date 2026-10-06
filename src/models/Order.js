const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    image: { type: String },
    // Print size slug (a5/a4/a3) - added when per-size pricing
    // shipped. Optional so older orders placed before this field existed
    // still validate fine.
    size: { type: String },
    // The rest are only set on customizable-poster items (see
    // orderController.js's createCustomOrder) - left undefined on ordinary
    // catalog-product items.
    imagePublicId: { type: String }, // Cloudinary asset id, for the uploaded/linked image
    imageLink: { type: String }, // the original pasted URL, if that's how it came in
    width: { type: Number }, // pixel width of the submitted image
    height: { type: Number }, // pixel height of the submitted image
    notes: { type: String }, // customer's notes on their custom poster
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    customer: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, required: true, trim: true },
      address: { type: String, required: true, trim: true },
    },
    items: { type: [orderItemSchema], required: true, validate: (v) => Array.isArray(v) && v.length > 0 },
    // subtotal is the final amount charged, after any bulk-poster discount.
    // discountPercent/discountAmount record what that discount was (both 0
    // when the order didn't qualify) purely so emails and the admin orders
    // page can show it - see computeOrderTotals in data/categories.js, which
    // is what actually sets all three when an order is created.
    subtotal: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    // Saving from the pack deals (5 A4 for Rs 375, 5 A5 for Rs 225); 0 if unused.
    packDealAmount: { type: Number, default: 0 },
    // No real payment gateway yet — every order lands here as "placed".
    // The field exists so a future payment integration has somewhere to
    // record status transitions without a schema change.
    status: { type: String, enum: ["placed"], default: "placed" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
