const Order = require("../models/Order");
const { generateOrderId } = require("../utils/orderId");
const {
  sendOrderConfirmationToCustomer,
  sendNewOrderAlertToOwner,
  sendCustomPosterConfirmationToCustomer,
  sendCustomPosterAlertToOwner,
} = require("../utils/email");
const { enhanceImage } = require("../utils/enhanceImage");
const cloudinary = require("../config/cloudinary");
const { getSizeBySlug, getMinPixelsForSize, computeOrderTotals, normalizeItemPrices } = require("../data/categories");
const {
  uploadBufferToCloudinary,
  uploadRemoteUrlToCloudinary,
  deleteFromCloudinary,
} = require("../utils/cloudinaryUpload");

const mongoose = require("mongoose");

// Cleans client-sent order items: a real product id OR a hosted custom poster
// (its Cloudinary id must live in custom-orders), never arbitrary values.
function sanitizeItems(items) {
  return items.map((raw) => {
    const item = { ...raw };
    const qty = Math.floor(Number(item.qty));
    item.qty = Number.isFinite(qty) && qty >= 1 ? Math.min(qty, 500) : 1;
    if (!mongoose.isValidObjectId(item.product)) delete item.product;
    if (typeof item.imagePublicId === "string" && /^custom-orders\/[\w-]+$/.test(item.imagePublicId)) {
      item.width = Number(item.width) > 0 ? Math.floor(Number(item.width)) : undefined;
      item.height = Number(item.height) > 0 ? Math.floor(Number(item.height)) : undefined;
      item.notes = typeof item.notes === "string" ? item.notes.slice(0, 500) : undefined;
    } else {
      delete item.imagePublicId;
      delete item.width;
      delete item.height;
      delete item.notes;
    }
    delete item.imageLink;
    if (typeof item.image !== "string" || !item.image.startsWith("https://res.cloudinary.com/")) delete item.image;
    return item;
  });
}

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
  const { customer } = req.body;
  let { items } = req.body;

  if (!customer || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "customer and a non-empty items array are required" });
  }
  const { name, email, phone, address } = customer;
  if (!name || !EMAIL_RE.test(email || "") || !PHONE_RE.test(phone || "") || !address) {
    return res.status(400).json({ message: "customer needs a valid name, email, 10-digit phone, and address" });
  }
  items = sanitizeItems(items);

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


// Downloads an image Cloudinary is hosting (we only ever fetch URLs that
// Cloudinary itself produced, never a customer-supplied host directly, so a
// pasted link can't be used to make this server request arbitrary addresses).
async function downloadHostedImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("download failed");
  return Buffer.from(await r.arrayBuffer());
}

// Shared by the live preview endpoint and the order itself: takes an
// uploaded file or a pasted link, enhances it to print quality for `size`,
// and hosts the enhanced version on Cloudinary. The raw original is only a
// temporary stepping stone for links and is deleted straight away.
async function enhanceToCloudinary({ file, imageLink, size }) {
  let sourceBuffer;
  if (file) {
    sourceBuffer = file.buffer;
  } else {
    let remote;
    try {
      remote = await uploadRemoteUrlToCloudinary(imageLink.trim(), { folder: "custom-orders-src" });
      sourceBuffer = await downloadHostedImage(remote.secure_url);
    } catch (err) {
      const e = new Error("Couldn't load that image link - check the URL or upload the file instead.");
      e.status = 400;
      throw e;
    } finally {
      if (remote) deleteFromCloudinary(remote.public_id);
    }
  }

  let enhanced;
  try {
    enhanced = await enhanceImage(sourceBuffer, size);
  } catch (err) {
    if (err.status) throw err;
    const e = new Error("Couldn't process that image - please try a different file.");
    e.status = 400;
    throw e;
  }

  const hosted = await uploadBufferToCloudinary(enhanced.buffer, { folder: "custom-orders" });
  return { hosted, enhanced };
}

// POST /api/orders/custom/enhance - the live preview step. Returns the
// enhanced image so the customer can see it before submitting; submitting
// then references it by its Cloudinary id instead of uploading again.
async function enhanceCustomImage(req, res) {
  const size = getSizeBySlug(req.body.size);
  if (!size) return res.status(400).json({ message: "Choose a valid print size." });
  const imageLink = req.body.imageLink;
  if (!req.file && !(imageLink && imageLink.trim())) {
    return res.status(400).json({ message: "Upload an image or paste a link to one." });
  }
  try {
    const { hosted, enhanced } = await enhanceToCloudinary({ file: req.file, imageLink, size });
    res.json({
      url: hosted.secure_url,
      publicId: hosted.public_id,
      width: enhanced.width,
      height: enhanced.height,
      originalWidth: enhanced.originalWidth,
      originalHeight: enhanced.originalHeight,
      upscaled: enhanced.upscaled,
      dpi: enhanced.dpi,
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Couldn't enhance that image right now." });
  }
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
  if (!file && !(imageLink && imageLink.trim()) && !req.body.enhancedPublicId) {
    return res.status(400).json({ message: "Upload an image or paste a link to one." });
  }

  // The customer normally enhanced the image in the preview step already and
  // just sends its id here. Only trust ids inside our own custom-orders
  // folder, and read the real dimensions back from Cloudinary rather than
  // from the request. If there's no enhanced id (older client, or the
  // preview was skipped), enhance now.
  let uploadResult;
  const { enhancedPublicId } = req.body;
  try {
    if (enhancedPublicId && /^custom-orders\/[\w-]+$/.test(enhancedPublicId)) {
      const r = await cloudinary.api.resource(enhancedPublicId);
      uploadResult = { secure_url: r.secure_url, public_id: r.public_id, width: r.width, height: r.height };
    } else {
      const { hosted } = await enhanceToCloudinary({ file, imageLink, size });
      uploadResult = hosted;
    }
  } catch (err) {
    return res.status(err.status || 400).json({
      message: err.status ? err.message : "Couldn't process that image - please try again.",
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
        imageLink: imageLink && imageLink.trim() ? imageLink.trim() : undefined,
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

module.exports = { createOrder, createCustomOrder, enhanceCustomImage, adminListOrders, updateOrderStatus };
