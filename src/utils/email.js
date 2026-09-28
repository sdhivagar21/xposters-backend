// XPOSTERS - order notifications via email, sent through Resend's HTTPS API.
//
// Sends an order-confirmation email to the customer and a new-order alert
// to the store owner whenever an order is placed. Customizable-poster
// orders get their own pair of these (see the two sendCustomPoster*
// functions below) - still regular Orders under the hood, just with one
// custom-poster item, so the wording is a little different (no exact
// product name, mentions the image is being reviewed).
// See .env.example for the environment variables this needs
// (RESEND_API_KEY, EMAIL_FROM, OWNER_EMAIL).
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

// order - a full Order document whose single item is the customizable
// poster (see orderController.js's createCustomOrder). size - the matching
// entry from data/categories.js, for its label/dimensions.
async function sendCustomPosterConfirmationToCustomer(order, size) {
  const subject = `Your XPOSTERS custom poster order ${order.orderId} is in`;
  const html = `
    <p>Hi ${order.customer.name}, we've received your customizable poster order <strong>${order.orderId}</strong>!</p>
    <p>Size: ${size.label} (${size.dimensions})<br/>
    Price: Rs ${order.subtotal}</p>
    <p>We're reviewing your image now and will reach out if we need anything else. Otherwise, sit tight - we'll get it printed and shipped to:</p>
    <p>${order.customer.address}</p>
    <p>Thanks for shopping with XPOSTERS!</p>
  `;
  const text =
    `Hi ${order.customer.name}, we've received your customizable poster order ${order.orderId}!\n\n` +
    `Size: ${size.label} (${size.dimensions})\n` +
    `Price: Rs ${order.subtotal}\n\n` +
    `We're reviewing your image now and will reach out if we need anything else. Otherwise, sit tight - we'll get it printed and shipped to:\n` +
    `${order.customer.address}\n\n` +
    `Thanks for shopping with XPOSTERS!`;

  await sendEmail(order.customer.email, subject, html, text);
}

async function sendCustomPosterAlertToOwner(order, size) {
  const ownerEmail = OWNER_EMAIL;
  if (!ownerEmail) {
    console.warn("[email] Skipped custom-poster alert - OWNER_EMAIL is not set.");
    return;
  }
  const item = order.items[0];
  const subject = `New customizable poster order ${order.orderId} - ${size.label} - Rs ${order.subtotal}`;
  const html = `
    <p><strong>New customizable poster order ${order.orderId}!</strong></p>
    <p>Size: ${size.label} (${size.dimensions})<br/>
    Price: Rs ${order.subtotal}</p>
    <p><a href="${item.image}">${item.image}</a></p>
    ${item.width && item.height ? `<p>Image: ${item.width} x ${item.height}px</p>` : ""}
    <p>Customer: ${order.customer.name}<br/>
    Phone: ${order.customer.phone}<br/>
    Email: ${order.customer.email}<br/>
    Address: ${order.customer.address}</p>
    ${item.notes ? `<p>Notes: ${item.notes}</p>` : ""}
  `;
  const text =
    `New customizable poster order ${order.orderId}!\n\n` +
    `Size: ${size.label} (${size.dimensions})\n` +
    `Price: Rs ${order.subtotal}\n\n` +
    `Image: ${item.image}\n` +
    (item.width && item.height ? `Dimensions: ${item.width} x ${item.height}px\n\n` : "\n") +
    `Customer: ${order.customer.name}\n` +
    `Phone: ${order.customer.phone}\n` +
    `Email: ${order.customer.email}\n` +
    `Address: ${order.customer.address}` +
    (item.notes ? `\nNotes: ${item.notes}` : "");

  await sendEmail(ownerEmail, subject, html, text);
}

module.exports = {
  sendOrderConfirmationToCustomer,
  sendNewOrderAlertToOwner,
  sendCustomPosterConfirmationToCustomer,
  sendCustomPosterAlertToOwner,
};
