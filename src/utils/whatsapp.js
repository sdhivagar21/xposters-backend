const twilio = require("twilio");

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  OWNER_WHATSAPP_NUMBER,
  TWILIO_CUSTOMER_TEMPLATE_SID,
  TWILIO_OWNER_TEMPLATE_SID,
} = process.env;

const configured = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);
const client = configured ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

function toWhatsAppAddress(tenDigitNumber) {
  return `whatsapp:+91${tenDigitNumber}`;
}

function formatItemsList(items) {
  return items.map((item) => `${item.name} x${item.qty} (Rs ${item.qty * item.price})`).join(", ");
}

async function sendTemplate(to, contentSid, contentVariables) {
  if (!configured) {
    console.warn("[whatsapp] Skipped - set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM to enable.");
    return;
  }
  if (!contentSid) {
    console.warn("[whatsapp] Skipped - a Content Template SID is not set. See .env.example.");
    return;
  }
  try {
    await client.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to,
      contentSid,
      contentVariables: JSON.stringify(contentVariables),
    });
  } catch (err) {
    console.error(`[whatsapp] Failed to send to ${to}:`, err.message);
  }
}

async function sendOrderConfirmationToCustomer(order) {
  await sendTemplate(toWhatsAppAddress(order.customer.phone), TWILIO_CUSTOMER_TEMPLATE_SID, {
    1: order.customer.name,
    2: order.orderId,
    3: formatItemsList(order.items),
    4: String(order.subtotal),
  });
}

async function sendNewOrderAlertToOwner(order) {
  if (!OWNER_WHATSAPP_NUMBER) {
    console.warn("[whatsapp] Skipped owner alert - OWNER_WHATSAPP_NUMBER is not set.");
    return;
  }
  await sendTemplate(toWhatsAppAddress(OWNER_WHATSAPP_NUMBER), TWILIO_OWNER_TEMPLATE_SID, {
    1: order.orderId,
    2: order.customer.name,
    3: order.customer.phone,
    4: String(order.subtotal),
    5: order.customer.address,
  });
}

module.exports = { sendOrderConfirmationToCustomer, sendNewOrderAlertToOwner };