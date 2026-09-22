// XPOSTERS - order notifications via email (Gmail SMTP through Nodemailer).
//
// Sends an order-confirmation email to the customer and a new-order alert
// to the store owner whenever an order is placed. See .env.example for the
// environment variables this needs (EMAIL_USER, EMAIL_APP_PASSWORD, OWNER_EMAIL).
//
// Safe to use before email is set up: if those variables aren't set yet,
// this quietly skips sending instead of breaking order placement.

const nodemailer = require("nodemailer");

const { EMAIL_USER, EMAIL_APP_PASSWORD, OWNER_EMAIL } = process.env;

const configured = Boolean(EMAIL_USER && EMAIL_APP_PASSWORD);
// Using the explicit host/port instead of the "gmail" shorthand, plus
// family: 4, so this always connects over IPv4. Some hosts (Render
// included) advertise an IPv6 route to Gmail's SMTP server that isn't
// actually reachable, which fails with ENETUNREACH/Connection timeout -
// forcing IPv4 avoids that entirely.
const transporter = configured
  ? nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      family: 4,
      auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
    })
  : null;

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
    console.warn("[email] Skipped - set EMAIL_USER / EMAIL_APP_PASSWORD to enable.");
    return;
  }
  try {
    await transporter.sendMail({
      from: `"XPOSTERS" <${EMAIL_USER}>`,
      to,
      subject,
      html,
      text,
    });
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