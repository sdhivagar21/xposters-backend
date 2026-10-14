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

// Owner alerts go to every address in OWNER_EMAIL (comma-separated is fine)
// plus a second owner inbox (OWNER_EMAIL2, or the built-in default).
// OWNER_EMAIL2 (env) overrides the built-in second address if you set it.
const EXTRA_OWNER_EMAILS = [process.env.OWNER_EMAIL2 || "anirudhsriram1014@gmail.com"];

function getOwnerRecipients() {
  const fromEnv = (OWNER_EMAIL || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (fromEnv.length === 0) return [];
  const all = [...fromEnv, ...EXTRA_OWNER_EMAILS];
  return all.filter((e, i) => all.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i);
}

// Sales-milestone emails go only to MILESTONE_EMAIL (comma-separated is
// fine), or the built-in default if it isn't set.
function getMilestoneRecipients() {
  return (process.env.MILESTONE_EMAIL || "sdhivagar21@gmail.com")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

// 123456 -> "Rs 1,23,456" (Indian digit grouping)
function formatRs(amount) {
  return `Rs ${Number(amount).toLocaleString("en-IN")}`;
}

// Small JPG thumbnail of a Cloudinary image for email. Email clients are
// picky: f_jpg (not f_auto, which can serve WebP that Outlook can't show),
// and a small width keeps the email light.
function emailImageUrl(url, width = 160) {
  if (!url) return "";
  const marker = "/upload/";
  const index = url.indexOf(marker);
  if (index === -1) return url;
  const insertAt = index + marker.length;
  return url.slice(0, insertAt) + `f_jpg,q_70,w_${width}/` + url.slice(insertAt);
}

function formatItemsListHtml(items) {
  const rows = items
    .map((item) => {
      const img = emailImageUrl(item.image);
      const thumb = img
        ? `<img src="${img}" alt="${item.name}" width="80" style="display:block;width:80px;height:auto;border-radius:6px;border:1px solid #ddd" />`
        : "";
      return `<tr>
        <td style="padding:8px 12px 8px 0;vertical-align:middle">${thumb}</td>
        <td style="padding:8px 0;vertical-align:middle"><strong>${item.name}</strong><br/>${item.size ? `Size: ${String(item.size).toUpperCase()}<br/>` : ""}Qty ${item.qty} - Rs ${item.qty * item.price}${item.width ? `<br/>Print file: ${item.width}x${item.height}px` : ""}${item.notes ? `<br/>Notes: ${String(item.notes).replace(/[<>&]/g, "")}` : ""}</td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
}

function formatItemsListText(items) {
  return items.map((item) => `- ${item.name} x${item.qty} (Rs ${item.qty * item.price})${item.notes ? ` - Notes: ${item.notes}` : ""}`).join("\n");
}

// Resolves true once Resend accepted the email, false if it was skipped or
// failed (already logged) - never throws.
async function sendEmail(to, subject, html, text) {
  if (!configured) {
    console.warn("[email] Skipped - set RESEND_API_KEY to enable.");
    return false;
  }
  try {
    const { error } = await resend.emails.send({ from: FROM_ADDRESS, to, subject, html, text });
    if (error) throw new Error(error.message || JSON.stringify(error));
    return true;
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err.message);
    return false;
  }
}

// Rendered right before the Total line whenever an order qualified for the
// bulk-poster discount (order.discountAmount > 0) - blank otherwise, so a
// non-discounted order's email looks exactly as it always has.
function formatDiscountLineHtml(order) {
  let html = "";
  if (order.discountAmount) {
    html += `<p>Bundle discount (${order.discountPercent}% off, 3+ posters): -Rs ${order.discountAmount}</p>`;
  }
  if (order.packDealAmount) {
    html += `<p>Pack deal (5 A4 for Rs 375 / 5 A5 for Rs 225): -Rs ${order.packDealAmount}</p>`;
  }
  return html;
}

function formatDiscountLineText(order) {
  let text = "";
  if (order.discountAmount) {
    text += `Bundle discount (${order.discountPercent}% off, 3+ posters): -Rs ${order.discountAmount}\n`;
  }
  if (order.packDealAmount) {
    text += `Pack deal (5 A4 for Rs 375 / 5 A5 for Rs 225): -Rs ${order.packDealAmount}\n`;
  }
  return text;
}

async function sendOrderConfirmationToCustomer(order) {
  const subject = `Your XPOSTERS order ${order.orderId} is confirmed`;
  const html = `
    <p>Hi ${order.customer.name}, your XPOSTERS order <strong>${order.orderId}</strong> is confirmed!</p>
    ${formatItemsListHtml(order.items)}
    ${formatDiscountLineHtml(order)}
    <p><strong>Total: Rs ${order.subtotal}</strong></p>
    <p>Delivering to: ${order.customer.address}</p>
    <p>We'll update you when it ships. Thanks for shopping with XPOSTERS!</p>
  `;
  const text =
    `Hi ${order.customer.name}, your XPOSTERS order ${order.orderId} is confirmed!\n\n` +
    `${formatItemsListText(order.items)}\n\n` +
    `${formatDiscountLineText(order)}` +
    `Total: Rs ${order.subtotal}\n\n` +
    `Delivering to: ${order.customer.address}\n\n` +
    `We'll update you when it ships. Thanks for shopping with XPOSTERS!`;

  await sendEmail(order.customer.email, subject, html, text);
}

async function sendNewOrderAlertToOwner(order) {
  const ownerEmail = getOwnerRecipients();
  if (ownerEmail.length === 0) {
    console.warn("[email] Skipped owner alert - OWNER_EMAIL is not set.");
    return;
  }
  const subject = `New order ${order.orderId} - Rs ${order.subtotal}`;
  const html = `
    <p><strong>New order ${order.orderId}!</strong></p>
    ${formatItemsListHtml(order.items)}
    ${formatDiscountLineHtml(order)}
    <p><strong>Total: Rs ${order.subtotal}</strong></p>
    <p>Customer: ${order.customer.name}<br/>
    Phone: ${order.customer.phone}<br/>
    Email: ${order.customer.email}<br/>
    Address: ${order.customer.address}</p>
  `;
  const text =
    `New order ${order.orderId}!\n\n` +
    `${formatItemsListText(order.items)}\n\n` +
    `${formatDiscountLineText(order)}` +
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
    ${order.items[0] && order.items[0].image ? `<p><img src="${emailImageUrl(order.items[0].image, 320)}" alt="Your poster" width="240" style="display:block;width:240px;height:auto;border-radius:6px;border:1px solid #ddd" /></p>` : ""}
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
  const ownerEmail = getOwnerRecipients();
  if (ownerEmail.length === 0) {
    console.warn("[email] Skipped custom-poster alert - OWNER_EMAIL is not set.");
    return;
  }
  const item = order.items[0];
  const subject = `New customizable poster order ${order.orderId} - ${size.label} - Rs ${order.subtotal}`;
  const html = `
    <p><strong>New customizable poster order ${order.orderId}!</strong></p>
    <p>Size: ${size.label} (${size.dimensions})<br/>
    Price: Rs ${order.subtotal}</p>
    <p><img src="${emailImageUrl(item.image, 480)}" alt="Poster image" width="320" style="display:block;width:320px;height:auto;border-radius:6px;border:1px solid #ddd" /></p>
    <p><a href="${item.image}">Open full-size image</a></p>
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

// The "special" celebration email for crossing a sales milestone (see
// utils/milestones.js). milestones - every milestone being announced,
// smallest first: usually one, more if a big order or the very first check
// jumped past several at once. order - the order that pushed the total
// over, or undefined when found on server start. Resolves true if sent.
async function sendMilestoneEmail({ milestones, total, orders, next, order }) {
  const top = milestones[milestones.length - 1];
  const earlier = milestones.slice(0, -1);
  const subject = `XPOSTERS crossed ${formatRs(top)} in sales!`;
  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0c0b09" style="background:#0c0b09;border-radius:8px">
      <tr><td align="center" style="padding:36px 24px;font-family:Arial,Helvetica,sans-serif;color:#f3ede2">
        <p style="margin:0;font-size:12px;letter-spacing:4px;color:#a49a88">XPOSTERS MILESTONE</p>
        <p style="margin:18px 0 6px;font-size:46px;font-weight:bold;color:#e2bd6c">${formatRs(top)}</p>
        <p style="margin:0;font-size:17px">collected on XPOSTERS - congratulations!</p>
        ${earlier.length ? `<p style="margin:14px 0 0;font-size:13px;color:#a49a88">Also passed: ${earlier.map(formatRs).join(", ")}</p>` : ""}
        <p style="margin:28px 0 0;font-size:15px;line-height:1.7">
          Total collected so far: <strong style="color:#e2bd6c">${formatRs(total)}</strong><br/>
          Orders so far: <strong>${orders.toLocaleString("en-IN")}</strong>
          ${order ? `<br/>Order ${order.orderId} (${formatRs(order.subtotal)}) took it over the line.` : ""}
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#a49a88">Next milestone: ${formatRs(next)} - ${formatRs(next - total)} to go.</p>
      </td></tr>
    </table>
  `;
  const text =
    `XPOSTERS MILESTONE: ${formatRs(top)} collected - congratulations!\n` +
    (earlier.length ? `Also passed: ${earlier.map(formatRs).join(", ")}\n` : "") +
    `\nTotal collected so far: ${formatRs(total)}\n` +
    `Orders so far: ${orders.toLocaleString("en-IN")}\n` +
    (order ? `Order ${order.orderId} (${formatRs(order.subtotal)}) took it over the line.\n` : "") +
    `\nNext milestone: ${formatRs(next)} - ${formatRs(next - total)} to go.`;

  return sendEmail(getMilestoneRecipients(), subject, html, text);
}

module.exports = {
  sendOrderConfirmationToCustomer,
  sendNewOrderAlertToOwner,
  sendCustomPosterConfirmationToCustomer,
  sendCustomPosterAlertToOwner,
  sendMilestoneEmail,
};
