const Order = require("../models/Order");
const Milestone = require("../models/Milestone");
const { generateOrderId } = require("../utils/orderId");
const { checkMilestones, getSalesTotals, milestonesUpTo, nextMilestone, resetSales } = require("../utils/milestones");
const {
  sendOrderConfirmationToCustomer,
  sendNewOrderAlertToOwner,
  sendCustomPosterConfirmationToCustomer,
  sendCustomPosterAlertToOwner,
} = require("../utils/email");
const {
  enhanceImage,
  getAiUsage,
  makePrintFile,
  normalizeLink,
  isPinterestUrl,
  resolvePinterestImage,
  orderPrintLinks,
  validOrderSignature,
  printFileName,
  originalCloudinaryUrl,
  createZipWriter,
} = require("../utils/enhanceImage");
const cloudinary = require("../config/cloudinary");
const { getSizeBySlug, getMinPixelsForSize, computeOrderTotals, normalizeItemPrices } = require("../data/categories");
const {
  uploadBufferToCloudinary,
  uploadRemoteUrlToCloudinary,
  deleteFromCloudinary,
} = require("../utils/cloudinaryUpload");

const mongoose = require("mongoose");
const sharp = require("sharp");

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
      if (!(typeof item.sourceImage === "string" && /^https:\/\/res\.cloudinary\.com\/[\w-]+\/image\/upload\/(?:v\d+\/)?custom-orders-src\/[\w.-]+$/.test(item.sourceImage))) {
        delete item.sourceImage;
      }
    } else {
      delete item.imagePublicId;
      delete item.width;
      delete item.height;
      delete item.notes;
      delete item.sourceImage;
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
  checkMilestones(order).catch((err) => console.error("[milestones] check failed:", err.message));
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
// The image behind an uploaded file or a pasted link. Pinterest pin links
// (pin.it/..., pinterest.com/pin/...) are pages, not images - they're resolved
// to the pin's full-size original first. Any other link is fetched by
// Cloudinary, not by this server.
async function loadSourceImage({ file, imageLink }) {
  if (file) return file.buffer;
  const link = normalizeLink(imageLink);
  if (isPinterestUrl(link)) return (await resolvePinterestImage(link)).buffer;
  let remote;
  try {
    remote = await uploadRemoteUrlToCloudinary(link, { folder: "custom-orders-src" });
    return await downloadHostedImage(remote.secure_url);
  } catch (err) {
    const e = new Error("Couldn't load that image link - check the URL or upload the file instead.");
    e.status = 400;
    throw e;
  } finally {
    if (remote) deleteFromCloudinary(remote.public_id);
  }
}

async function enhanceToCloudinary({ file, imageLink, size }) {
  const sourceBuffer = await loadSourceImage({ file, imageLink });

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
  // A small image that couldn't go through the AI (monthly limit reached,
  // or AI unavailable): keep the customer's original too, so the admin can
  // make the sharp AI print file later for free on their own computer.
  let sourceUrl;
  if (enhanced.aiStatus && enhanced.aiStatus !== "used") {
    try {
      const mime = { png: "image/png", webp: "image/webp", gif: "image/gif" }[(await sharp(sourceBuffer).metadata()).format] || "image/jpeg";
      const kept = await cloudinary.uploader.upload(`data:${mime};base64,${sourceBuffer.toString("base64")}`, {
        folder: "custom-orders-src",
        resource_type: "image",
      });
      sourceUrl = kept.secure_url;
    } catch (err) {
      console.error("[custom] couldn't keep the original:", err.message);
    }
  }
  return { hosted, enhanced, sourceUrl };
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
    const { hosted, enhanced, sourceUrl } = await enhanceToCloudinary({ file: req.file, imageLink, size });
    res.json({
      sourceUrl,
      aiStatus: enhanced.aiStatus,
      url: hosted.secure_url,
      publicId: hosted.public_id,
      width: enhanced.width,
      height: enhanced.height,
      originalWidth: enhanced.originalWidth,
      originalHeight: enhanced.originalHeight,
      upscaled: enhanced.upscaled,
      ai: enhanced.ai,
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
      const { hosted, sourceUrl } = await enhanceToCloudinary({ file, imageLink, size });
      uploadResult = { ...hosted, sourceUrl };
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
        sourceImage: uploadResult.sourceUrl,
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
  checkMilestones(order).catch((err) => console.error("[milestones] check failed:", err.message));
}

// GET /api/admin/orders - each order also carries its print-file download
// links (one per poster + a ZIP of all), same as in the owner's email.
async function adminListOrders(req, res) {
  const orders = await Order.find({}).sort({ createdAt: -1 });
  res.json(orders.map((o) => ({ ...serializeOrder(o), downloads: orderPrintLinks(o) })));
}

// Print files are CPU-heavy to build, so cap them per IP as well.
const printHits = new Map();
function printLimitReached(ip, max = 40) {
  const now = Date.now();
  const recent = (printHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= max) return true;
  recent.push(now);
  printHits.set(ip, recent);
  return false;
}

// One order item's print-ready file: its image at 300 DPI for the size that
// was ordered (A3/A4/A5), enhanced if the original is smaller than that.
async function orderItemPrintFile(item) {
  const src = originalCloudinaryUrl(item.image);
  if (!src.startsWith("https://res.cloudinary.com/")) throw Object.assign(new Error("No image on this item"), { status: 404 });
  const size = getSizeBySlug(item.size) || getSizeBySlug("a4");
  return makePrintFile(await downloadHostedImage(src), size);
}

// GET /api/orders/print/:id[/:item]?sig=... - the "Download" buttons in the
// owner's order email and on the admin orders page. With an item number it
// sends that poster's print file; without one, a ZIP of every poster in the
// order. The signature (made when the email/page was built) stands in for a
// login, so the link works straight from the inbox.
async function downloadOrderPrint(req, res) {
  const { id, item: itemNo } = req.params;
  if (!mongoose.isValidObjectId(id) || !validOrderSignature(id, req.query.sig)) {
    return res.status(403).send("This download link isn't valid.");
  }
  if (printLimitReached(req.ip)) return res.status(429).send("Too many downloads - please wait a few minutes.");
  const order = await Order.findById(id);
  if (!order) return res.status(404).send("Order not found - it may have been deleted.");

  if (itemNo) {
    const index = Number(itemNo) - 1;
    const item = order.items[index];
    if (!item) return res.status(404).send("That poster isn't in this order.");
    try {
      const file = await orderItemPrintFile(item);
      res.set({
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="${printFileName(order, item, index)}"`,
        "Cache-Control": "private, max-age=3600",
      });
      return res.send(file.buffer);
    } catch (err) {
      if (err.status === 404) return res.status(404).send("This poster has no stored image to download.");
      console.error("[print] item failed:", err.message);
      return res.status(502).send("Couldn't build that print file right now - please try again.");
    }
  }

  // Whole order as one ZIP, built and streamed one poster at a time.
  res.set({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${order.orderId}_print-files.zip"`,
    "Cache-Control": "private, no-store",
  });
  const write = (chunk) =>
    new Promise((resolve) => {
      if (res.write(chunk)) resolve();
      else res.once("drain", resolve);
    });
  const zip = createZipWriter(write);
  const failed = [];
  for (let i = 0; i < order.items.length; i++) {
    if (res.destroyed) return;
    const item = order.items[i];
    try {
      const file = await orderItemPrintFile(item);
      await zip.add(printFileName(order, item, i), file.buffer);
    } catch (err) {
      if (err.status !== 404) console.error("[print] zip item failed:", err.message);
      failed.push(`${i + 1}. ${item.name} - ${item.image || "no image"}`);
    }
  }
  if (failed.length) {
    await zip.add("COULD-NOT-BUILD.txt", Buffer.from(`These posters couldn't be built - download them one by one instead:\r\n${failed.join("\r\n")}\r\n`));
  }
  await zip.finish();
  res.end();
}

// POST /api/admin/print (admin only) - the admin "Print files" tool: an
// uploaded image or pasted link (Pinterest pins too) comes back as a
// print-ready JPEG at 300 DPI for the chosen size, enhanced as needed.
// Body: size (a3/a4/a5), fit ("" keep shape | "fill" | "fit"), image or
// imageLink, ai ("local" = the browser already AI-upscaled this image on the
// admin's computer, so only finish it here).
async function adminMakePrintFile(req, res) {
  const size = getSizeBySlug(req.body.size);
  if (!size) return res.status(400).json({ message: "Choose A3, A4 or A5." });
  const fit = ["fill", "fit"].includes(req.body.fit) ? req.body.fit : undefined;
  if (!req.file && !(req.body.imageLink && req.body.imageLink.trim())) {
    return res.status(400).json({ message: "Upload an image or paste a link to one." });
  }
  const local = req.body.ai === "local";
  try {
    const source = await loadSourceImage({ file: req.file, imageLink: req.body.imageLink });
    const out = await enhanceImage(source, size, { fit, forDownload: true, ai: !local, cleanSource: local });
    res.set({
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="xposters_${size.label}_${out.width}x${out.height}.jpg"`,
      "X-Print-Info": JSON.stringify({
        size: size.slug,
        width: out.width,
        height: out.height,
        originalWidth: out.originalWidth,
        originalHeight: out.originalHeight,
        upscaled: out.upscaled,
        ai: out.ai || local,
        aiStatus: local ? "local" : out.aiStatus,
        dpi: out.dpi,
        bytes: out.buffer.length,
      }),
    });
    res.send(out.buffer);
  } catch (err) {
    if (!err.status) console.error("[print] admin tool failed:", err.message);
    res.status(err.status || 500).json({ message: err.status ? err.message : "Couldn't process that image - please try a different one." });
  }
}

// Total collected (since the last reset, and this month in Indian time) plus
// milestone progress, for the summary at the top of the admin pages.
// reachedAt is null for a milestone the server hasn't recorded yet; since is
// null if the total has never been reset.
async function salesStats() {
  const totals = await getSalesTotals();
  const reached = milestonesUpTo(totals.total);
  const records = await Milestone.find({ amount: { $in: reached } }, "amount createdAt").lean();
  const reachedAt = new Map(records.map((r) => [r.amount, r.createdAt]));
  return {
    ...totals,
    milestones: {
      reached: reached.map((amount) => ({ amount, reachedAt: reachedAt.get(amount) || null })),
      next: nextMilestone(totals.total),
    },
  };
}

// GET /api/admin/stats
async function adminSalesStats(req, res) {
  res.json(await salesStats());
}

// POST /api/admin/stats/reset { confirm: "DELETE" } - permanently deletes
// every order and starts the total (and milestones) from zero. The confirm
// word means a stray or replayed request can't wipe the order history.
async function adminResetSalesStats(req, res) {
  if (req.body?.confirm !== "DELETE") {
    return res.status(400).json({ message: 'Send { confirm: "DELETE" } to delete all orders' });
  }
  const deletedOrders = await resetSales();
  res.json({ ...(await salesStats()), deletedOrders });
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

// POST /api/admin/print/source (admin only) - the original image behind a
// link (Pinterest pins resolved to the full-size original), for the free
// AI that runs in the admin's browser. Body: imageLink.
async function adminPrintSource(req, res) {
  const link = req.body && req.body.imageLink;
  if (!link || !String(link).trim()) return res.status(400).json({ message: "Paste a link to an image." });
  try {
    const normalized = normalizeLink(link);
    const buffer = /^https:\/\/res\.cloudinary\.com\//.test(normalized)
      ? await downloadHostedImage(normalized)
      : await loadSourceImage({ imageLink: normalized });
    const format = (await sharp(buffer).metadata()).format;
    res.set({ "Content-Type": `image/${format === "jpeg" ? "jpeg" : format || "jpeg"}`, "Cache-Control": "private, no-store" });
    res.send(buffer);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.status ? err.message : "Couldn't load that image link." });
  }
}

// GET /api/admin/ai-usage - Cloudinary AI upscales used this month vs the limit.
async function adminAiUsage(req, res) {
  res.json(await getAiUsage());
}

module.exports = {
  adminPrintSource,
  adminAiUsage,
  createOrder,
  createCustomOrder,
  enhanceCustomImage,
  downloadOrderPrint,
  adminMakePrintFile,
  adminListOrders,
  adminSalesStats,
  adminResetSalesStats,
  updateOrderStatus,
};
