const Order = require("../models/Order");
const { generateOrderId } = require("../utils/orderId");
const {
  sendOrderConfirmationToCustomer,
  sendNewOrderAlertToOwner,
  sendCustomPosterConfirmationToCustomer,
  sendCustomPosterAlertToOwner,
} = require("../utils/email");
const { getSizeBySlug, getMinPixelsForSize, computeOrderTotals, normalizeItemPrices } = require("../data/categories");
const {
  uploadBufferToCloudinary,
  uploadRemoteUrlToCloudinary,
  deleteFromCloudinary,
} = require("../utils/cloudinaryUpload");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\d{10}$/;
const ORDER_STATUSES = Order.schema.path("status").enumValues;

function serializeOrder(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: o._id.toString(),
    orderId: o.orderId,
    customer: o.customer,
    items: o.items,
    subtotal: o.subtotal,
    discountPercent: o.discountPercent || 0,
    discountAmount: o.discountAmount || 0,
    packDealAmount: o.packDealAmount || 0,
    status: o.status,
    createdAt: o.createdAt,
  };
}

// POST /api/orders - the "place order" step. No real payment gateway yet;
// this is where one would be called before the order is confirmed. The
// subtotal (and any bulk-poster discount) is computed here from `items`
// rather than trusted from req.body, so a tampered request can't change
// what actually gets charged/recorded.
async function createOrder(req, res) {
  const { customer, items } = req.body;

  if (!customer || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "customer and a non-empty items array are required" });
  }
  const { name, email, phone, address } = customer;
  if (!name || !EMAIL_RE.test(email || "") || !PHONE_RE.test(phone || "") || !address) {
    return res.status(400).json({ message: "customer needs a valid name, email, 10-digit phone, and address" });
  }

  const { subtotal, discountPercent, discountAmount, packDealAmount } = computeOrderTotals(items);

  const order = await Order.create({
    orderId: generateOrderId(),
    customer,
    items: normalizeItemPrices(items),
    subtotal,
    discountPercent,
    discountAmount,
    packDealAmount,
    status: "placed",
  });

  res.status(201).json(serializeOrder(order));

  // Fire the email notifications after responding, so a slow or failed
  // send never delays or breaks placing the order for the customer.
  sendOrderConfirmationToCustomer(order).catch(() => {});
  sendNewOrderAlertToOwner(order).catch(() => {});
}

// POST /api/orders/custom - a customer uploads their own image (or pastes a
// link to one), picks a print size, and submits their details, instead of
// buying an existing product. This still creates a regular Order (with one
// item carrying the size/price/image and a few custom-poster-only fields -
// see orderItemSchema in models/Order.js) so it shows up in the same admin
// orders list as everything else. The image is re-hosted on Cloudinary
// either way, which is what gives us its real pixel dimensions to check
// against a minimum for the chosen size; too low-res and nothing is saved -
// an error is returned instead.
async function createCustomOrder(req, res) {
  const { size: sizeSlug, name, email, phone, address, notes, imageLink } = req.body;
  const file = req.file;

  const size = getSizeBySlug(sizeSlug);
  if (!size) {
    return res.status(400).json({ message: "Choose a valid print size." });
  }
  if (!name || !EMAIL_RE.test(email || "") || !PHONE_RE.test(phone || "") || !address) {
    return res.status(400).json({ message: "Enter a valid name, email, 10-digit phone, and address." });
  }
  if (!file && !(imageLink && imageLink.trim())) {
    return res.status(400).json({ message: "Upload an image or paste a link to one." });
  }

  let uploadResult;
  try {
    uploadResult = file
      ? await uploadBufferToCloudinary(file.buffer, { folder: "custom-orders" })
      : await uploadRemoteUrlToCloudinary(imageLink.trim(), { folder: "custom-orders" });
  } catch (err) {
    return res.status(400).json({
      message: file
        ? "Couldn't process that image - please try a different file."
        : "Couldn't load that image link - check the URL or upload the file instead.",
    });
  }

  const { minWidth, minHeight } = getMinPixelsForSize(size.slug);
  if (uploadResult.width < minWidth || uploadResult.height < minHeight) {
    await deleteFromCloudinary(uploadResult.public_id);
    return res.status(400).json({
      message: `Image quality is too low for a clean ${size.label} print. Please upload a higher-resolution image (at least ${minWidth}x${minHeight}px) or choose a smaller size.`,
    });
  }

  const order = await Order.create({
    orderId: generateOrderId(),
    customer: { name, email, phone, address },
    items: [
      {
        name: `Custom Poster (${size.label})`,
        price: size.price,
        image: uploadResult.secure_url,
        imagePublicId: uploadResult.public_id,
        imageLink: file ? undefined : imageLink.trim(),
        size: size.slug,
        width: uploadResult.width,
        height: uploadResult.height,
        notes: notes || "",
        qty: 1,
      },
    ],
    subtotal: size.price,
    status: "placed",
  });

  res.status(201).json(serializeOrder(order));

  // Fire both notifications after responding, same pattern as regular
  // orders - a slow or failed send should never delay or break the
  // submission. The customer gets a confirmation too, same as a regular
  // order, so they're not left wondering whether it went through.
  sendCustomPosterConfirmationToCustomer(order, size).catch(() => {});
  sendCustomPosterAlertToOwner(order, size).catch(() => {});
}

// GET /api/admin/orders
async function adminListOrders(req, res) {
  const orders = await Order.find({}).sort({ createdAt: -1 });
  res.json(orders.map(serializeOrder));
}

// PATCH /api/admin/orders/:id/status - move an order to a new stage
// (placed -> processing -> shipped -> delivered, or cancelled).
async function updateOrderStatus(req, res) {
  const { status } = req.body;
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ message: `status must be one of: ${ORDER_STATUSES.join(", ")}` });
  }

  const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }

  res.json(serializeOrder(order));
}

module.exports = { createOrder, createCustomOrder, adminListOrders, updateOrderStatus };
