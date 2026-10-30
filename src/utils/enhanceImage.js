const crypto = require("crypto");
const sharp = require("sharp");
const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");

// Print-ready target: 300 DPI at the chosen poster size.
const ENHANCE_DPI = 300;
const MIN_SOURCE_PX = 48; // below this there's nothing real to enhance
const MAX_LONG_SIDE = 7000;
const CLOUDINARY_LIMIT = 9.5 * 1024 * 1024; // Cloudinary rejects files over 10MB

// Pixel size of a print at 300 DPI, e.g. A4 portrait = 2490 x 3510.
function printPixels(size, portrait = true) {
  const w = Math.round((portrait ? size.widthIn : size.heightIn) * ENHANCE_DPI);
  const h = Math.round((portrait ? size.heightIn : size.widthIn) * ENHANCE_DPI);
  return { width: w, height: h };
}

// Upright width/height of an image (phone photos are often stored sideways
// with an EXIF "rotate me" flag).
async function uprightSize(buffer) {
  const meta = await sharp(buffer, { limitInputPixels: 80e6 }).metadata();
  const swapped = meta.orientation && meta.orientation >= 5;
  return { w: swapped ? meta.height : meta.width, h: swapped ? meta.width : meta.height };
}

// How much an image must grow to print at 300 DPI for `size`: covering the
// page on both axes, or ("fit") keeping the whole image inside it.
function scaleFor(w, h, size, fit) {
  const t = printPixels(size, h >= w);
  return fit === "fit" ? Math.min(t.width / w, t.height / h) : Math.max(t.width / w, t.height / h);
}

// ---------------------------------------------------------------------------
// AI upscaling (Cloudinary's e_upscale: a super-resolution model that
// rebuilds real detail - eyes, hair, edges of text - at 4x per pass, instead
// of just smoothing pixels). Used whenever an image is well under print
// size (less than ~120 DPI for the chosen size), so even a tiny 140p image
// prints sharp. Each pass costs a few Cloudinary transformations (10 for a
// small image, 100 for a large one); results are cached by Cloudinary, so
// switching sizes on the same image doesn't pay again. If the AI step is
// unavailable for any reason, the classic enhance below still runs.
// Set AI_UPSCALE=off in the environment to turn it off.
//
// Monthly limit: at most AI_MONTHLY_LIMIT different images a month (default
// 250) go through Cloudinary's AI, so the free plan's credits can't run out
// by surprise. Past the limit, customers get the classic enhance and the
// original is kept, and the admin "Print files" page makes the sharp AI
// version for free on the admin's own computer instead.
// ---------------------------------------------------------------------------
const AI_MIN_SCALE = 2.5; // below this the classic enhance is already sharp

function aiMonthlyLimit() {
  const raw = process.env.AI_MONTHLY_LIMIT;
  if (raw === undefined || String(raw).trim() === "") return 250;
  return Math.max(0, Math.floor(Number(raw)) || 0);
}

function aiEnabled() {
  return (
    String(process.env.AI_UPSCALE || "").toLowerCase() !== "off" &&
    Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_SECRET)
  );
}

// "2026-10" in India time - the month the usage counts towards.
function usageMonth(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
}

// One small document per month in MongoDB listing the images that used the
// AI (by content hash + AI step), so the same image again - e.g. a customer
// switching between A3/A4/A5 - isn't counted twice (Cloudinary serves its
// cached copy for free).
function usageCollection() {
  return mongoose.connection.readyState === 1 ? mongoose.connection.db.collection("aiupscales") : null;
}

async function reserveAiSlot(key) {
  const col = usageCollection();
  if (!col) return true; // no database (local testing) - nothing to count against
  const month = usageMonth();
  const doc = await col.findOne({ _id: month }, { projection: { keys: 1 } });
  const keys = (doc && doc.keys) || [];
  if (keys.includes(key)) return true;
  if (keys.length >= aiMonthlyLimit()) return false;
  await col.updateOne({ _id: month }, { $addToSet: { keys: key }, $set: { updatedAt: new Date() } }, { upsert: true });
  return true;
}

async function releaseAiSlot(key) {
  const col = usageCollection();
  if (col) await col.updateOne({ _id: usageMonth() }, { $pull: { keys: key } }).catch(() => {});
}

// For the admin page: { month, used, limit, enabled }.
async function getAiUsage() {
  const col = usageCollection();
  const month = usageMonth();
  const doc = col ? await col.findOne({ _id: month }, { projection: { keys: 1 } }) : null;
  return { month, used: (doc && doc.keys && doc.keys.length) || 0, limit: aiMonthlyLimit(), enabled: aiEnabled() };
}

function aiError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
const AI_MAX_INPUT_PX = 4.1e6; // Cloudinary's limit for e_upscale input

function aiPlan(w, h, scale) {
  if (scale < AI_MIN_SCALE) return null;
  const passes = scale > 4.4 && w * h * 16 < AI_MAX_INPUT_PX ? 2 : 1;
  // Shrink first if the AI result would come out far bigger than the print
  // needs (keeps it fast and inside Cloudinary's size limits).
  const pre = Math.min(1, (1.05 * scale) / 4 ** passes);
  const inW = Math.max(1, Math.round(w * pre));
  const inH = Math.max(1, Math.round(h * pre));
  if (inW * inH >= AI_MAX_INPUT_PX) return null;
  return { passes, inW, inH };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function aiUpscale(buffer, plan) {
  if (String(process.env.AI_UPSCALE || "").toLowerCase() === "off") throw aiError("off", "turned off (AI_UPSCALE=off)");
  if (!aiEnabled()) throw aiError("off", "Cloudinary isn't configured");
  // Upright, on white, at the planned input size - so Cloudinary sees exactly
  // what we would have enlarged ourselves.
  const input = await sharp(buffer, { limitInputPixels: 80e6 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .resize(plan.inW, plan.inH, { fit: "fill", kernel: "lanczos3" })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const publicId = `print-src/${crypto.createHash("sha1").update(input).digest("hex").slice(0, 24)}`;
  const key = `${publicId}:${plan.passes}`;
  if (!(await reserveAiSlot(key))) throw aiError("limit", `monthly AI limit reached (${aiMonthlyLimit()})`);
  try {
    return await runCloudUpscale(input, publicId, plan);
  } catch (err) {
    await releaseAiSlot(key); // nothing was made, so it doesn't count
    throw err;
  }
}

async function runCloudUpscale(input, publicId, plan) {
  await cloudinary.uploader.upload(`data:image/jpeg;base64,${input.toString("base64")}`, {
    public_id: publicId,
    overwrite: false,
    resource_type: "image",
    tags: ["print-src"],
  });
  const url = cloudinary.url(publicId, {
    secure: true,
    sign_url: true,
    transformation: [...Array.from({ length: plan.passes }, () => ({ effect: "upscale" })), { quality: 95, fetch_format: "jpg" }],
  });
  // The first request starts the AI job; Cloudinary answers 423/420 until
  // it's ready.
  const deadline = Date.now() + 100000;
  while (Date.now() < deadline) {
    const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (res.ok && /^image\//.test(res.headers.get("content-type") || "")) return Buffer.from(await res.arrayBuffer());
    if (res.status === 423 || res.status === 420) {
      await sleep(2500);
      continue;
    }
    throw aiError("error", `Cloudinary said ${res.status}${res.headers.get("x-cld-error") ? ` - ${res.headers.get("x-cld-error")}` : ""}`);
  }
  throw aiError("error", "timed out waiting for the AI upscale");
}

// Takes whatever the customer gave us (any quality) and returns a JPEG at
// print resolution for `size` (an entry of SIZES). Small images first go
// through the AI upscale above; then everything is finished here: cleans up
// compression noise on small sources, resizes in gentle steps with Lanczos
// resampling (one huge jump looks much worse than several small ones), then
// sharpens in proportion to how much it was enlarged.
//
// options.fit - leave unset to keep the image's own shape (both sides at
//   least 300 DPI for the size); "fill" = exactly the paper size, edges
//   cropped to fit; "fit" = exactly the paper size, whole image kept with a
//   white border.
// options.forDownload - top JPEG quality with no 10MB cap (the file goes
//   straight to the admin, not to Cloudinary).
// options.ai - false skips the AI upscale.
async function enhanceImage(buffer, size, options = {}) {
  const { w, h } = await uprightSize(buffer);
  if (!w || !h || Math.min(w, h) < MIN_SOURCE_PX) {
    const err = new Error("That image is too small to enhance - please use a larger one.");
    err.status = 400;
    throw err;
  }
  let source = buffer;
  let ai = false;
  // aiStatus: null = not needed (image big enough), "used", or why it was
  // skipped: "limit" (monthly limit reached), "off", "error".
  let aiStatus = null;
  const plan = options.ai === false ? null : aiPlan(w, h, scaleFor(w, h, size, options.fit));
  if (plan) {
    try {
      source = await aiUpscale(buffer, plan);
      ai = true;
      aiStatus = "used";
    } catch (err) {
      aiStatus = err.code || "error";
      console.warn(`[ai-upscale] skipped, using the classic enhance (${w}x${h}): ${err.message}`);
    }
  }
  const out = await finishPrint(source, size, { ...options, cleanSource: ai || options.cleanSource });
  return { ...out, originalWidth: w, originalHeight: h, upscaled: out.upscaled || ai, ai, aiStatus };
}

// The classic (non-AI) part: resize to print size, sharpen, encode.
async function finishPrint(buffer, size, { fit, forDownload = false, cleanSource = false } = {}) {
  const { w, h } = await uprightSize(buffer);
  const portrait = h >= w;
  const { width: targetW, height: targetH } = printPixels(size, portrait);
  const exact = fit === "fill" || fit === "fit";
  let scale = scaleFor(w, h, size, fit);
  const upscaled = scale > 1.02;
  if (!upscaled && !exact) scale = Math.min(1, MAX_LONG_SIDE / Math.max(w, h)); // never shrink below what we were given, except absurd sizes

  const finalW = Math.round(w * scale);
  const finalH = Math.round(h * scale);

  // Work on raw pixels between steps - re-encoding a huge PNG each time is
  // what makes this slow, and nothing needs the encoded form until the end.
  const toRaw = (img) => img.raw().toBuffer({ resolveWithObject: true });
  const fromRaw = ({ data, info }) =>
    sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });

  let step = await toRaw(
    sharp(buffer, { limitInputPixels: 80e6 }).rotate().flatten({ background: "#ffffff" }).toColourspace("srgb")
  );

  // Light denoise for small/heavily-compressed sources before enlarging
  // (not needed after the AI upscale, which already cleans them up).
  if (upscaled && !cleanSource && Math.max(w, h) < 1400) {
    step = await toRaw(fromRaw(step).median(3));
  }

  if (upscaled) {
    while (step.info.width < finalW || step.info.height < finalH) {
      const nextW = Math.min(finalW, Math.round(step.info.width * 2));
      const nextH = Math.min(finalH, Math.round(step.info.height * 2));
      step = await toRaw(fromRaw(step).resize(nextW, nextH, { kernel: "lanczos3" }));
    }
  } else if (scale < 1) {
    step = await toRaw(fromRaw(step).resize(finalW, finalH, { kernel: "lanczos3" }));
  }

  // Exactly the paper size: crop the overflow (fill) or pad with white (fit).
  if (exact && (step.info.width !== targetW || step.info.height !== targetH)) {
    step = await toRaw(
      fromRaw(step).resize(targetW, targetH, {
        fit: fit === "fill" ? "cover" : "contain",
        position: "centre",
        background: "#ffffff",
        kernel: "lanczos3",
      })
    );
  }

  const strength = upscaled ? Math.min(scale, 5) : cleanSource ? 0.6 : 1;
  // If a very detailed image comes out bigger than Cloudinary allows at top
  // quality, step the JPEG quality down until it fits.
  let out;
  for (const quality of forDownload ? [95] : [92, 86, 80, 74, 68]) {
    out = await fromRaw(step)
      .sharpen({ sigma: 0.8 + strength * 0.25, m1: 0.6, m2: 1.8 })
      .modulate({ saturation: 1.04 })
      .jpeg({ quality, chromaSubsampling: quality > 80 ? "4:4:4" : "4:2:0" })
      .withMetadata({ density: ENHANCE_DPI })
      .toBuffer();
    if (forDownload || out.length <= CLOUDINARY_LIMIT) break;
  }

  return {
    buffer: out,
    width: step.info.width,
    height: step.info.height,
    originalWidth: w,
    originalHeight: h,
    upscaled,
    dpi: ENHANCE_DPI,
  };
}

// Print file for an admin download. An image that's already print-ready for
// the size (e.g. a customer's poster we enhanced at checkout) is handed back
// untouched instead of being sharpened a second time.
async function makePrintFile(buffer, size, { fit } = {}) {
  if (!fit) {
    const meta = await sharp(buffer, { limitInputPixels: 80e6 }).metadata().catch(() => null);
    if (meta && meta.format === "jpeg" && meta.width && meta.height) {
      const swapped = meta.orientation && meta.orientation >= 5;
      const w = swapped ? meta.height : meta.width;
      const h = swapped ? meta.width : meta.height;
      const t = printPixels(size, h >= w);
      if (w >= t.width * 0.98 && h >= t.height * 0.98) {
        return { buffer, width: w, height: h, originalWidth: w, originalHeight: h, upscaled: false, dpi: ENHANCE_DPI };
      }
    }
  }
  return enhanceImage(buffer, size, { fit, forDownload: true });
}

// ---------------------------------------------------------------------------
// Loading a source image from a link.
//
// Pinterest: a pin link (pinterest.com/pin/..., in.pinterest.com/pin/...,
// or the short pin.it/... share link) is a web page, not an image, so it's
// resolved here to the pin's full-size original on i.pinimg.com. Only
// Pinterest's own hosts are ever requested (every redirect is checked too),
// so a pasted link can't make this server fetch anything else.
// ---------------------------------------------------------------------------
const PINTEREST_TLDS = [
  "com", "ca", "co.uk", "ie", "fr", "de", "at", "ch", "es", "it", "pt", "nl", "se", "dk", "no", "fi",
  "com.au", "nz", "co.nz", "jp", "co.kr", "kr", "com.mx", "cl", "co", "ph", "ru", "in", "com.br",
];
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

function isPinterestHost(host) {
  host = String(host || "").toLowerCase();
  if (host === "pin.it" || host === "i.pinimg.com") return true;
  return PINTEREST_TLDS.some((tld) => host === `pinterest.${tld}` || host.endsWith(`.pinterest.${tld}`));
}

// Accepts what people actually paste: missing "https://", stray spaces, or a
// whole share message ("Check this out! https://pin.it/abc").
function normalizeLink(raw) {
  let s = String(raw || "").trim();
  const inText = s.match(/https?:\/\/\S+/i);
  if (inText) s = inText[0];
  else if (/^(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?$/i.test(s)) s = `https://${s}`;
  return s.replace(/[)\].,'"]+$/, "");
}

function isPinterestUrl(link) {
  try {
    const u = new URL(normalizeLink(link));
    return /^https?:$/.test(u.protocol) && isPinterestHost(u.hostname);
  } catch {
    return false;
  }
}

function linkError(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

// fetch() that follows redirects by hand, refusing any hop off Pinterest.
async function pinterestFetch(url, accept) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const u = new URL(current);
    if (!/^https?:$/.test(u.protocol) || !isPinterestHost(u.hostname)) {
      throw linkError("That Pinterest link points somewhere else - open the pin and copy its link again.");
    }
    const res = await fetch(u.href, {
      redirect: "manual",
      headers: { Accept: accept, "Accept-Language": "en-IN,en;q=0.9" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), u).href;
      continue;
    }
    return { res, finalUrl: u.href };
  }
  throw linkError("That Pinterest link redirects too many times.");
}

async function readCapped(res, max = MAX_SOURCE_BYTES) {
  const len = Number(res.headers.get("content-length"));
  if (len && len > max) throw linkError("That image is too large (over 40MB).");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw linkError("That image is too large (over 40MB).");
  return buf;
}

async function downloadPinImage(url) {
  const { res } = await pinterestFetch(url, "image/*");
  if (!res.ok || !/^image\//.test(res.headers.get("content-type") || "")) return null;
  return readCapped(res);
}

// The pin's own picture: og:image is the pin (736px), and the page also lists
// the same picture's full-size "originals" copy - matched by its file id so
// a "more like this" pin further down the page is never picked by mistake.
function pinImageCandidates(html) {
  const og =
    html.match(/<meta[^>]+property="og:image"[^>]*content="([^"]+)"/i) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]*property="og:image"/i);
  if (!og) return [];
  const ogUrl = og[1].replace(/&amp;/g, "&");
  const key = ogUrl.match(/i\.pinimg\.com\/[^/]+\/((?:[0-9a-f]{2}\/){3}[0-9a-f]+)\.(\w+)/i);
  if (!key) return [ogUrl];
  const [, id, ext] = key;
  const found = html.match(new RegExp(`https://i\\.pinimg\\.com/originals/${id}\\.(jpg|jpeg|png|webp|gif)`, "i"));
  const list = [];
  if (found) list.push(found[0]);
  list.push(`https://i.pinimg.com/originals/${id}.${ext}`, `https://i.pinimg.com/originals/${id}.png`);
  list.push(`https://i.pinimg.com/1200x/${id}.${ext}`, ogUrl);
  return [...new Set(list)];
}

// Pinterest link -> { buffer, url } of the pin's biggest available image.
async function resolvePinterestImage(link) {
  const start = normalizeLink(link);
  const host = new URL(start).hostname.toLowerCase();
  try {
    if (host === "i.pinimg.com") {
      const id = start.match(/i\.pinimg\.com\/[^/]+\/((?:[0-9a-f]{2}\/){3}[0-9a-f]+)\.(\w+)/i);
      const tries = id ? [`https://i.pinimg.com/originals/${id[1]}.${id[2]}`, start] : [start];
      for (const url of tries) {
        const buffer = await downloadPinImage(url);
        if (buffer) return { buffer, url };
      }
      throw linkError("Couldn't load that Pinterest image.");
    }
    const { res, finalUrl } = await pinterestFetch(start, "text/html,application/xhtml+xml");
    if (/^image\//.test(res.headers.get("content-type") || "")) return { buffer: await readCapped(res), url: finalUrl };
    if (!res.ok) throw linkError("Couldn't open that Pinterest pin - check the link, or download the image and upload it.");
    if (!/\/pin\//.test(new URL(finalUrl).pathname)) {
      throw linkError("That Pinterest link isn't a single pin - open the pin itself, tap Share > Copy link, and paste that.");
    }
    const html = (await readCapped(res, 8 * 1024 * 1024)).toString("utf8");
    const candidates = pinImageCandidates(html);
    if (!candidates.length) throw linkError("Couldn't find an image on that Pinterest pin - it may be a video or private.");
    for (const url of candidates) {
      const buffer = await downloadPinImage(url).catch(() => null);
      if (buffer) return { buffer, url };
    }
    throw linkError("Couldn't download the image from that Pinterest pin - try downloading it and uploading the file.");
  } catch (err) {
    if (err.status) throw err;
    throw linkError("Couldn't reach Pinterest just now - try again, or download the image and upload it.");
  }
}

// ---------------------------------------------------------------------------
// Signed print-file links (in the owner's order email and the admin orders
// page). The signature means only someone with the email/admin page can
// trigger the (CPU-heavy) print-file build for an order.
// ---------------------------------------------------------------------------
function linkSecret() {
  return process.env.PRINT_LINK_SECRET || process.env.JWT_SECRET || process.env.CLOUDINARY_API_SECRET || "xposters";
}

function orderSignature(orderMongoId) {
  return crypto.createHmac("sha256", linkSecret()).update(`print:${orderMongoId}`).digest("hex").slice(0, 32);
}

function validOrderSignature(orderMongoId, sig) {
  const want = Buffer.from(orderSignature(orderMongoId));
  const got = Buffer.from(String(sig || ""));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// The backend's own public address (Vercel sets VERCEL_PROJECT_PRODUCTION_URL,
// Render sets RENDER_EXTERNAL_URL).
function apiBaseUrl() {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const base =
    process.env.PUBLIC_API_URL || vercel || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 4000}`;
  return base.replace(/\/+$/, "").replace(/\/api$/, "");
}

// { all, items: [url per item] } - all = one ZIP with every print file.
function orderPrintLinks(order) {
  const id = String(order._id || order.id);
  const sig = orderSignature(id);
  const base = `${apiBaseUrl()}/api/orders/print/${id}`;
  return { all: `${base}?sig=${sig}`, items: (order.items || []).map((_, i) => `${base}/${i + 1}?sig=${sig}`) };
}

// File name like "XP-AB12CD_02_A4_Leo-Das.jpg".
function printFileName(order, item, index) {
  const safe = (s) => String(s || "").normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const name = safe(item.name).slice(0, 40) || "poster";
  const qty = item.qty > 1 ? `_x${item.qty}` : "";
  return `${safe(order.orderId) || "order"}_${String(index + 1).padStart(2, "0")}_${String(item.size || "a4").toUpperCase()}_${name}${qty}.jpg`;
}

// The untouched original of a Cloudinary image (strips any resize/format
// transformation from the URL), so print files start from the best copy.
function originalCloudinaryUrl(url) {
  return String(url || "").replace(/\/upload\/(?:[a-z]{1,3}_[^/]*\/)+(?=v\d+\/)/i, "/upload/");
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (stored entries - JPEGs don't compress anyway), streamed
// one file at a time so a big order never sits in memory all at once.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function createZipWriter(write) {
  const entries = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  return {
    async add(name, data) {
      const nameBuf = Buffer.from(name, "utf8");
      const crc = crc32(data);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(0x0800, 6); // UTF-8 names
      head.writeUInt16LE(0, 8); // stored
      head.writeUInt16LE(dosTime, 10);
      head.writeUInt16LE(dosDate, 12);
      head.writeUInt32LE(crc, 14);
      head.writeUInt32LE(data.length, 18);
      head.writeUInt32LE(data.length, 22);
      head.writeUInt16LE(nameBuf.length, 26);
      head.writeUInt16LE(0, 28);
      entries.push({ nameBuf, crc, size: data.length, offset });
      await write(Buffer.concat([head, nameBuf]));
      await write(data);
      offset += 30 + nameBuf.length + data.length;
    },
    async finish() {
      const parts = entries.map((e) => {
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0);
        c.writeUInt16LE(20, 4);
        c.writeUInt16LE(20, 6);
        c.writeUInt16LE(0x0800, 8);
        c.writeUInt16LE(0, 10);
        c.writeUInt16LE(dosTime, 12);
        c.writeUInt16LE(dosDate, 14);
        c.writeUInt32LE(e.crc, 16);
        c.writeUInt32LE(e.size, 20);
        c.writeUInt32LE(e.size, 24);
        c.writeUInt16LE(e.nameBuf.length, 28);
        c.writeUInt32LE(e.offset, 42);
        return Buffer.concat([c, e.nameBuf]);
      });
      const dir = Buffer.concat(parts);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(entries.length, 8);
      end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(dir.length, 12);
      end.writeUInt32LE(offset, 16);
      await write(Buffer.concat([dir, end]));
    },
  };
}

module.exports = {
  enhanceImage,
  getAiUsage,
  makePrintFile,
  printPixels,
  ENHANCE_DPI,
  normalizeLink,
  isPinterestUrl,
  resolvePinterestImage,
  orderPrintLinks,
  validOrderSignature,
  printFileName,
  originalCloudinaryUrl,
  createZipWriter,
};
