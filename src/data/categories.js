// Must stay in sync with the frontend's src/data/categories.js — these are
// the only valid `category` values a Product can have.
const CATEGORIES = [
  { slug: "tamil-movies", name: "Tamil Movies" },
  { slug: "english-movies", name: "English Movies" },
  { slug: "cars-bikes", name: "Cars & Bikes" },
  { slug: "marvel-dc", name: "Marvel & DC" },
  { slug: "anime", name: "Anime" },
  { slug: "cartoon", name: "Cartoon" },
  { slug: "motivational", name: "Motivational" },
  { slug: "sports", name: "Sports" },
  { slug: "split-posters", name: "Split Posters" },
];

const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

// Print sizes available for every poster (including customizable-poster
// uploads, which aren't a real Product category above - they're handled as
// regular Orders, see orderController.js's createCustomOrder). One fixed
// price per size across the entire catalog, so this is the single source of
// truth for pricing rather than a per-product field. Must stay in sync with
// the frontend's src/data/categories.js.
//
// widthIn/heightIn are used by the image-quality check on custom uploads to
// work out the minimum pixel dimensions needed for a clean print at
// PRINT_DPI.
const SIZES = [
  { slug: "a5", label: "A5", dimensions: '5.8" x 8.3"', price: 60, widthIn: 5.8, heightIn: 8.3 },
  { slug: "a4", label: "A4", dimensions: '8.3" x 11.7"', price: 95, widthIn: 8.3, heightIn: 11.7 },
  { slug: "a3", label: "A3", dimensions: '11.7" x 16.5"', price: 130, widthIn: 11.7, heightIn: 16.5 },
];

const SIZE_SLUGS = SIZES.map((s) => s.slug);

function getSizeBySlug(slug) {
  return SIZES.find((s) => s.slug === slug) || null;
}

// Minimum wall-poster print quality - 150 DPI is the standard rule of thumb
// for large prints viewed from a normal distance (a few feet away), vs the
// 300 DPI needed for something held close like a photo print. Below this,
// prints start looking visibly soft/pixelated at the chosen size.
const PRINT_DPI = 150;

function getMinPixelsForSize(slug) {
  const size = getSizeBySlug(slug);
  if (!size) return null;
  return {
    minWidth: Math.round(size.widthIn * PRINT_DPI),
    minHeight: Math.round(size.heightIn * PRINT_DPI),
  };
}

// Buy 3 or more posters in one order and this percentage comes off the raw
// subtotal automatically - a bundle deal to encourage bigger carts. Kept
// here alongside SIZES since it's another cart-wide pricing rule. Computed
// server-side in orderController.js (via computeOrderTotals below) rather
// than trusted from whatever the frontend sends, so it can't be spoofed by
// a tampered request - the frontend has its own copy of these same numbers
// (src/data/categories.js) purely to preview the discount live in the cart
// before the order is placed.
const BULK_DISCOUNT = { minQty: 3, percent: 23.08 };

// Pack deals: every full set of `qty` posters of one size costs a flat price
// instead of qty x that size's price (5 A4 for Rs 375, 5 A5 for Rs 225).
// Posters in a deal size are NOT part of the 3+ bundle discount above - the
// pack deal is their only discount; posters in other sizes still earn the
// bundle discount (counted among themselves). The frontend keeps a copy of
// these numbers (src/data/categories.js) only to preview the totals live in
// the cart.
const PACK_DEALS = [
  { size: "a4", qty: 5, price: 375 },
  { size: "a5", qty: 5, price: 225 },
];

// Customers' carts live in their own browser, so an item can carry an old
// price from before a price change (or a tampered one). Whenever the item's
// size is a known print size, the price comes from SIZES instead.
function normalizeItemPrices(items) {
  return items.map((item) => {
    const size = getSizeBySlug(item.size);
    return size ? { ...item, price: size.price } : item;
  });
}

// items - the order's item array, each with `price` and `qty`. Returns the
// raw (pre-discount) subtotal, whether this order qualifies, and the final
// numbers to store on the Order (see models/Order.js's discountPercent/
// discountAmount/packDealAmount/subtotal fields).
function computeOrderTotals(rawItems) {
  const items = normalizeItemPrices(rawItems);
  const rawSubtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);

  let packDealAmount = 0;
  for (const deal of PACK_DEALS) {
    const qty = items.filter((i) => i.size === deal.size).reduce((sum, i) => sum + i.qty, 0);
    const unit = (getSizeBySlug(deal.size) || {}).price || 0;
    packDealAmount += Math.max(0, Math.floor(qty / deal.qty) * (deal.qty * unit - deal.price));
  }

  const dealSizes = PACK_DEALS.map((d) => d.size);
  const otherItems = items.filter((item) => !dealSizes.includes(item.size));
  const otherQty = otherItems.reduce((sum, item) => sum + item.qty, 0);
  const otherSubtotal = otherItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const eligible = otherQty >= BULK_DISCOUNT.minQty;
  const discountAmount = eligible ? Math.round(otherSubtotal * (BULK_DISCOUNT.percent / 100)) : 0;

  return {
    rawSubtotal,
    totalQty,
    discountPercent: eligible ? BULK_DISCOUNT.percent : 0,
    discountAmount,
    packDealAmount,
    subtotal: rawSubtotal - discountAmount - packDealAmount,
  };
}

module.exports = {
  CATEGORIES,
  CATEGORY_SLUGS,
  SIZES,
  SIZE_SLUGS,
  getSizeBySlug,
  PRINT_DPI,
  getMinPixelsForSize,
  BULK_DISCOUNT,
  PACK_DEALS,
  normalizeItemPrices,
  computeOrderTotals,
};
