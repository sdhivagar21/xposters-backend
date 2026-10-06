// One-time cache-warming pass for the EXISTING catalog (new uploads already
// warm themselves - see cloudinaryUpload.js's EAGER_TRANSFORMS).
//
// Every poster already in Cloudinary was uploaded with no pre-built sizes,
// so the very first visitor to view any given poster at a given size pays
// for Cloudinary downloading + transcoding + resizing the full original on
// the spot - that's a big chunk of what makes the site feel slow right
// after a fresh deploy or for rarely-viewed posters. This script just visits
// every product's two most-used sizes (the ProductCard grid width and the
// homepage marquee width) once, so Cloudinary generates and caches them now
// instead of on a real visitor's page load.
//
// Requires Node 18+ (uses the built-in fetch). Safe to re-run - re-warming
// an already-cached size is just a fast CDN hit, not wasted work.
//
// Usage:
//   node scripts/warmImageCache.js
//   (reads BACKEND_URL from scripts/.env.import, or set it inline:)
//   BACKEND_URL=https://xposters-backend.onrender.com/api node scripts/warmImageCache.js

const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, ".env.import");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

const BACKEND_URL = process.env.BACKEND_URL;
const PAGE_SIZE = 60; // matches the backend's MAX_PAGE_SIZE
const CONCURRENCY = 8; // parallel warm-up requests in flight at once

// Must stay in sync with EAGER_TRANSFORMS in src/utils/cloudinaryUpload.js
// and the frontend's optimizedImage() util (src/utils/cloudinaryUrl.js).
const WIDTHS = [380, 320];

function optimizedUrl(url, width) {
  const marker = "/upload/";
  const index = url.indexOf(marker);
  if (index === -1) return url;
  const insertAt = index + marker.length;
  return url.slice(0, insertAt) + `f_auto,q_28,w_${width}/` + url.slice(insertAt);
}

async function fetchAllProductImages() {
  const images = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetch(`${BACKEND_URL}/products?page=${page}&limit=${PAGE_SIZE}`);
    if (!res.ok) throw new Error(`Fetching products page ${page} failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    for (const p of data.products) images.push(p.image);
    totalPages = data.totalPages;
    page++;
  } while (page <= totalPages);

  return images;
}

// Simple fixed-size worker pool instead of pulling in a dependency - run
// `limit` warm-up requests at a time until every URL in the queue is done.
async function runPool(urls, limit, worker) {
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      await worker(url);
      done++;
      if (done % 100 === 0 || done === urls.length) {
        process.stdout.write(`\rWarmed ${done}/${urls.length}`);
      }
    }
  });
  await Promise.all(workers);
}

async function main() {
  if (!BACKEND_URL) {
    console.error(
      "Missing BACKEND_URL.\n" +
        "Set it as an environment variable, or create scripts/.env.import with:\n" +
        "  BACKEND_URL=https://your-backend.onrender.com/api"
    );
    process.exit(1);
  }

  console.log(`Fetching the product catalog from ${BACKEND_URL} ...`);
  const images = await fetchAllProductImages();
  console.log(`Found ${images.length} product(s).`);

  const urls = images.flatMap((img) => WIDTHS.map((w) => optimizedUrl(img, w)));
  console.log(`Warming ${urls.length} image size(s) (${images.length} products x ${WIDTHS.length} sizes), ${CONCURRENCY} at a time...\n`);

  let failed = 0;
  const startedAt = Date.now();

  await runPool(urls, CONCURRENCY, async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) failed++;
      // Drain the body so the connection is freed for reuse, but we don't
      // need the bytes themselves - just the fact that Cloudinary generated
      // and cached this size.
      await res.arrayBuffer();
    } catch {
      failed++;
    }
  });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n\nDone in ${seconds}s. ${urls.length - failed} succeeded, ${failed} failed.`);
  if (failed > 0) {
    console.log("A few failures are fine (e.g. a since-deleted product) - re-run the script if that count looks high.");
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
