// XPOSTERS - order notifications via email, sent through Resend's HTTPS API.
//
// Sends an order-confirmation email to the customer and a new-order alert
// to the store owner whenever an order is placed. See .env.example for the
// environment variables this needs (RESEND_API_KEY, EMAIL_FROM, OWNER_EMAIL).
//
// Uses an HTTPS API instead of raw SMTP because Render's free tier blocks
// or throttles outbound SMTP connections (port 465/587), which made direct
// Gmail SMTP time out no matter what. HTTPS (port 443) isn't affected.
//
// Safe to use before email is set up: if RESEND_API_KEY isn't set yet, this
// quietly skips sending instead of breaking order placement.

const { Resend } = require("resend");

const { RESEND_API_KEY, EMAIL_FROM, OWNER_EMAIL } = process.env;

const configured = Boolean(RESEND_API_KEY);
const resend = configured ? new Resend(RESEND_API_KEY) : null;

// Falls back to Resend's shared test sender if EMAIL_FROM isn't set. That
// sender only delivers to the email address on your Resend account until
// you verify your own domain - see .env.example.
const FROM_ADDRESS = EMAIL_FROM || "XPOSTERS <onboarding@resend.dev>";

function formatItemsListHtml(items) {
  return items
    .map((item) => `<li>${item.name} x${item.qty} - Rs ${item.qty * item.price}</li>`)
    .join("");
}

function formatItemsListText(items) {
  return items.map((item) => `- ${item.name} x${item.qty} (Rs ${item.qty * item.price})`).join("\n");
}

async function sendEmail(to, subject, html, text) {
  if (!configured) {
    console.warn("[email] Skipped - set RESEND_API_KEY to enable.");
    return;
  }
  try {
    const { error } = await resend.emails.send({ from: FROM_ADDRESS, to, subject, html, text });
    if (error) throw new Error(error.message || JSON.stringify(error));
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err.message);
  }
}

async function sendOrderConfirmationToCustomer(order) {
  const subject = `Your XPOSTERS order ${order.orderId} is confirmed`;
  const html = `
    <p>Hi ${order.customer.name}, your XPOSTERS order <strong>${order.orderId}</strong> is confirmed!</p>
    <ul>${formatItemsListHtml(order.items)}</ul>
    <p><strong>Total: Rs ${order.subtotal}</strong></p>
    <p>Delivering to: ${order.customer.address}</p>
    <p>We'll update you when it ships. Thanks for shopping with XPOSTERS!</p>
  `;
  const text =
    `Hi ${order.customer.name}, your XPOSTERS order ${order.orderId} is confirmed!\n\n` +
    `${formatItemsListText(order.items)}\n\n` +
    `Total: Rs ${order.subtotal}\n\n` +
    `Delivering to: ${order.customer.address}\n\n` +
    `We'll update you when it ships. Thanks for shopping with XPOSTERS!`;

  await sendEmail(order.customer.email, subject, html, text);
}

async function sendNewOrderAlertToOwner(order) {
  const ownerEmail = OWNER_EMAIL;
  if (!ownerEmail) {
    console.warn("[email] Skipped owner alert - OWNER_EMAIL is not set.");
    return;
  }
  const subject = `New order ${order.orderId} - Rs ${order.subtotal}`;
  const html = `
    <p><strong>New order ${order.orderId}!</strong></p>
    <ul>${formatItemsListHtml(order.items)}</ul>
    <p><strong>Total: Rs ${order.subtotal}</strong></p>
    <p>Customer: ${order.customer.name}<br/>
    Phone: ${order.customer.phone}<br/>
    Email: ${order.customer.email}<br/>
    Address: ${order.customer.address}</p>
  `;
  const text =
    `New order ${order.orderId}!\n\n` +
    `${formatItemsListText(order.items)}\n\n` +
    `Total: Rs ${order.subtotal}\n\n` +
    `Customer: ${order.customer.name}\n` +
    `Phone: ${order.customer.phone}\n` +
    `Email: ${order.customer.email}\n` +
    `Address: ${order.customer.address}`;

  await sendEmail(ownerEmail, subject, html, text);
}

module.exports = { sendOrderConfirmationToCustomer, sendNewOrderAlertToOwner };