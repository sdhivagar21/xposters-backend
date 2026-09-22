const Order = require("../models/Order");
const { generateOrderId } = require("../utils/orderId");
const { sendOrderConfirmationToCustomer, sendNewOrderAlertToOwner } = require("../utils/email");

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
    status: o.status,
    createdAt: o.createdAt,
  };
}

// POST /api/orders - the "place order" step. No real payment gateway yet;
// this is where one would be called before the order is confirmed.
async function createOrder(req, res) {
  const { customer, items, subtotal } = req.body;

  if (!customer || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "customer and a non-empty items array are required" });
  }
  const { name, email, phone, address } = customer;
  if (!name || !EMAIL_RE.test(email || "") || !PHONE_RE.test(phone || "") || !address) {
    return res.status(400).json({ message: "customer needs a valid name, email, 10-digit phone, and address" });
  }

  const order = await Order.create({
    orderId: generateOrderId(),
    customer,
    items,
    subtotal,
    status: "placed",
  });

  res.status(201).json(serializeOrder(order));

  // Fire the email notifications after responding, so a slow or failed
  // send never delays or breaks placing the order for the customer.
  sendOrderConfirmationToCustomer(order).catch(() => {});
  sendNewOrderAlertToOwner(order).catch(() => {});
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

module.exports = { createOrder, adminListOrders, updateOrderStatus };