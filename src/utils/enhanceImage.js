const sharp = require("sharp");

// Print-ready target: 300 DPI at the chosen poster size.
const ENHANCE_DPI = 300;
const MIN_SOURCE_PX = 48; // below this there's nothing real to enhance
const MAX_LONG_SIDE = 7000;

// Takes whatever the customer gave us (any quality) and returns a JPEG at
// print resolution for `size` (an entry of SIZES): cleans up compression
// noise on small sources, upscales in gentle steps with Lanczos resampling
// (one huge jump looks much worse than several small ones), then sharpens in
// proportion to how much it was enlarged. This can't invent real detail that
// was never in the file, but it makes low-res images print far cleaner.
async function enhanceImage(buffer, size) {
  const meta = await sharp(buffer, { limitInputPixels: 80e6 }).metadata();
  const swapped = meta.orientation && meta.orientation >= 5;
  const w = swapped ? meta.height : meta.width;
  const h = swapped ? meta.width : meta.height;
  if (!w || !h || Math.min(w, h) < MIN_SOURCE_PX) {
    const err = new Error("That image is too small to enhance - please use a larger one.");
    err.status = 400;
    throw err;
  }

  const portrait = h >= w;
  const targetW = Math.round((portrait ? size.widthIn : size.heightIn) * ENHANCE_DPI);
  const targetH = Math.round((portrait ? size.heightIn : size.widthIn) * ENHANCE_DPI);
  // Cover the target on both axes so neither side ends up under 300 DPI.
  let scale = Math.max(targetW / w, targetH / h);
  const upscaled = scale > 1.02;
  if (!upscaled) scale = Math.min(1, MAX_LONG_SIDE / Math.max(w, h)); // never shrink below what we were given, except absurd sizes

  let finalW = Math.round(w * scale);
  let finalH = Math.round(h * scale);

  // Work on raw pixels between steps - re-encoding a huge PNG each time is
  // what makes this slow, and nothing needs the encoded form until the end.
  const toRaw = (img) => img.raw().toBuffer({ resolveWithObject: true });
  const fromRaw = ({ data, info }) =>
    sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });

  let step = await toRaw(
    sharp(buffer, { limitInputPixels: 80e6 }).rotate().removeAlpha().toColourspace("srgb")
  );

  // Light denoise for small/heavily-compressed sources before enlarging.
  if (upscaled && Math.max(w, h) < 1400) {
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

  const strength = upscaled ? Math.min(scale, 5) : 1;
  // Cloudinary rejects files over 10MB, so if a very detailed image comes out
  // bigger than that at top quality, step the JPEG quality down until it fits.
  let out;
  for (const quality of [92, 86, 80, 74, 68]) {
    out = await fromRaw(step)
      .sharpen({ sigma: 0.8 + strength * 0.25, m1: 0.6, m2: 1.8 })
      .modulate({ saturation: 1.04 })
      .jpeg({ quality, chromaSubsampling: quality > 80 ? "4:4:4" : "4:2:0" })
      .withMetadata({ density: ENHANCE_DPI })
      .toBuffer();
    if (out.length <= 9.5 * 1024 * 1024) break;
  }

  return {
    buffer: out,
    width: finalW,
    height: finalH,
    originalWidth: w,
    originalHeight: h,
    upscaled,
    dpi: ENHANCE_DPI,
  };
}

module.exports = { enhanceImage, ENHANCE_DPI };
