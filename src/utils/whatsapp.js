// XPOSTERS - WhatsApp notifications via Twilio.
//
// Sends an order-confirmation message to the customer and a new-order
// alert to the store owner whenever an order is placed. See .env.example
// for the environment variables this needs (TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, OWNER_WHATSAPP_NUMBER).
//
// Safe to use before WhatsApp is set up: if those variables aren't set
// yet, this quietly skips sending instead of breaking order placement.

const twilio = require("twilio");

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, OWNER_WHATSAPP_NUMBER } = process.env;

const configured = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);
const client = configured ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

// Indian 10-digit mobile numbers (the only format the order form and
// OWNER_WHATSAPP_NUMBER use) as a WhatsApp-ready address.
function toWhatsAppAddress(tenDigitNumber) {
  return `whatsapp:+91${tenDigitNumber}`;
}

function formatItemsList(items) {
  return items.map((item) => `- ${item.name} x${item.qty} (Rs ${item.qty * item.price})`).join("\n");
}

async function sendWhatsApp(to, body) {
  if (!configured) {
    console.warn("[whatsapp] Skipped - set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM to enable.");
    return;
  }
  try {
    await client.messages.create({ from: TWILIO_WHATSAPP_FROM, to, body });
  } catch (err) {
    // A WhatsApp failure should never break order placement - just log it.
    console.error(`[whatsapp] Failed to send to ${to}:`, err.message);
  }
}

async function sendOrderConfirmationToCustomer(order) {
  const body =
    `Hi ${order.customer.name}, your XPOSTERS order ${order.orderId} is confirmed!\n\n` +
    `${formatItemsList(order.items)}\n\n` +
    `Total: Rs ${order.subtotal}\n\n` +
    `Delivering to: ${order.customer.address}\n\n` +
    `We'll update you when it ships. Thanks for shopping with XPOSTERS!`;

  await sendWhatsApp(toWhatsAppAddress(order.customer.phone), body);
}

async function sendNewOrderAlertToOwner(order) {
  if (!OWNER_WHATSAPP_NUMBER) {
    console.warn("[whatsapp] Skipped owner alert - OWNER_WHATSAPP_NUMBER is not set.");
    return;
  }
  const body =
    `New order ${order.orderId}!\n\n` +
    `${formatItemsList(order.items)}\n\n` +
    `Total: Rs ${order.subtotal}\n\n` +
    `Customer: ${order.customer.name}\n` +
    `Phone: ${order.customer.phone}\n` +
    `Address: ${order.customer.address}`;

  await sendWhatsApp(toWhatsAppAddress(OWNER_WHATSAPP_NUMBER), body);
}

module.exports = { sendOrderConfirmationToCustomer, sendNewOrderAlertToOwner };