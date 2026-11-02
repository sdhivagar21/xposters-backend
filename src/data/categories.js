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

// Buy 2 Get 1: in every group of 3 posters the cheapest one is free. The
// order's posters are lined up from most to least expensive and every 3rd
// one is free (the standard way shops run it). Returns the saving and how
// many posters were free.
const BUY2GET1 = { groupSize: 3 };

function computeBuy2Get1(items) {
  const units = [];
  for (const item of items) {
    for (let n = 0; n < item.qty; n += 1) units.push(item.price);
  }
  units.sort((a, b) => b - a);
  let amount = 0;
  let freeCount = 0;
  for (let i = BUY2GET1.groupSize - 1; i < units.length; i += BUY2GET1.groupSize) {
    amount += units[i];
    freeCount += 1;
  }
  return { amount, freeCount };
}

// The older deals together: pack deals (5 A4 for Rs 375, 5 A5 for Rs 225)
// plus the 3+ bundle discount on the other sizes.
function computeComboDeals(items) {
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
    discountPercent: eligible ? BULK_DISCOUNT.percent : 0,
    discountAmount,
    packDealAmount,
    amount: discountAmount + packDealAmount,
  };
}

// Two ways to get the posters home:
//  - standard: free delivery anywhere in Tamil Nadu, 3-5 days
//  - instant: within 59 minutes anywhere in Chennai. The fee depends on the
//    posters' total after discounts - Rs 150 under Rs 200, Rs 100 from
//    Rs 200 to Rs 300, free above Rs 300.
// The frontend keeps a copy of these rules to show the fee before ordering.
const DELIVERY_OPTIONS = {
  standard: { slug: "standard", label: "Free delivery (3-5 days, all Tamil Nadu)" },
  instant: { slug: "instant", label: "Instant delivery (59 min, Chennai)" },
};

function instantDeliveryFee(itemsTotal) {
  if (itemsTotal > 300) return 0;
  if (itemsTotal >= 200) return 100;
  return 150;
}

function deliveryFeeFor(option, itemsTotal) {
  return option === "instant" ? instantDeliveryFee(itemsTotal) : 0;
}

// items - the order's item array, each with `price` and `qty`. Works out
// both kinds of deal - Buy 2 Get 1, and the pack deals + bundle discount
// together - and gives the customer whichever saves more (never both).
// Then adds the delivery fee for the chosen option. Returns the final
// numbers to store on the Order (see models/Order.js); `subtotal` is the
// amount actually charged, delivery included.
function computeOrderTotals(rawItems, deliveryOption = "standard") {
  const items = normalizeItemPrices(rawItems);
  const rawSubtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);

  const combo = computeComboDeals(items);
  const b2g1 = computeBuy2Get1(items);
  const useB2g1 = b2g1.amount > combo.amount;
  const dealType = useB2g1 ? "b2g1" : combo.amount > 0 ? "combo" : "";

  const discountPercent = useB2g1 ? 0 : combo.discountPercent;
  const discountAmount = useB2g1 ? 0 : combo.discountAmount;
  const packDealAmount = useB2g1 ? 0 : combo.packDealAmount;
  const b2g1Amount = useB2g1 ? b2g1.amount : 0;
  const itemsTotal = rawSubtotal - discountAmount - packDealAmount - b2g1Amount;

  const option = DELIVERY_OPTIONS[deliveryOption] ? deliveryOption : "standard";
  const deliveryFee = deliveryFeeFor(option, itemsTotal);

  return {
    rawSubtotal,
    totalQty,
    dealType,
    discountPercent,
    discountAmount,
    packDealAmount,
    b2g1Amount,
    b2g1FreeCount: useB2g1 ? b2g1.freeCount : 0,
    itemsTotal,
    deliveryOption: option,
    deliveryFee,
    subtotal: itemsTotal + deliveryFee,
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
  BUY2GET1,
  DELIVERY_OPTIONS,
  instantDeliveryFee,
  deliveryFeeFor,
  normalizeItemPrices,
  computeBuy2Get1,
  computeOrderTotals,
};
