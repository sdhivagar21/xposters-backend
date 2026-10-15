// XPOSTERS - sales totals and milestone celebration emails.
//
// After every order the total collected is checked against MILESTONES. Each
// milestone crossed gets a Milestone document and a one-time email to
// MILESTONE_EMAIL - see sendMilestoneEmail in utils/email.js.
//
// The owner can reset the total to zero from the admin page (resetSales);
// from then on only newer orders count, and milestones start over.

const Order = require("../models/Order");
const Milestone = require("../models/Milestone");
const SalesReset = require("../models/SalesReset");
const { sendMilestoneEmail } = require("./email");

// Rs amounts that trigger a milestone email. After the last one, every
// further Rs 1,00,000 counts too (Rs 2,00,000, Rs 3,00,000, ...).
const MILESTONES = [5000, 10000, 25000, 50000, 75000, 100000];
const STEP_AFTER_LAST = 100000;
const LAST = MILESTONES[MILESTONES.length - 1];

// Every milestone at or below `total`, smallest first.
function milestonesUpTo(total) {
  const reached = MILESTONES.filter((m) => m <= total);
  for (let m = LAST + STEP_AFTER_LAST; m <= total; m += STEP_AFTER_LAST) reached.push(m);
  return reached;
}

// The first milestone above `total`.
function nextMilestone(total) {
  const upcoming = MILESTONES.find((m) => m > total);
  if (upcoming) return upcoming;
  return LAST + (Math.floor((total - LAST) / STEP_AFTER_LAST) + 1) * STEP_AFTER_LAST;
}

// Midnight on the 1st of the current month in India (no daylight saving, so
// the +5:30 offset is fixed), so "this month" matches the owner's calendar
// rather than the server's UTC clock.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function startOfMonthIST(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}

// When the latest reset happened, or null if the total has never been reset.
async function countingSince() {
  const latest = await SalesReset.findOne({}, "at").sort({ at: -1 }).lean();
  return latest ? latest.at : null;
}

// Cancelled orders never brought money in, so they're left out of every
// total, as are orders from before the latest reset. subtotal is the final
// amount charged, after discounts.
async function getSalesTotals() {
  const since = await countingSince();
  const monthStart = startOfMonthIST();
  const inMonth = { $gte: ["$createdAt", monthStart] };
  const match = { status: { $ne: "cancelled" } };
  if (since) match.createdAt = { $gte: since };
  const [row] = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: "$subtotal" },
        orders: { $sum: 1 },
        month: { $sum: { $cond: [inMonth, "$subtotal", 0] } },
        monthOrders: { $sum: { $cond: [inMonth, 1, 0] } },
      },
    },
  ]);
  return {
    total: row ? row.total : 0,
    orders: row ? row.orders : 0,
    month: row ? row.month : 0,
    monthOrders: row ? row.monthOrders : 0,
    since,
  };
}

async function runMilestoneCheck(order) {
  const { total, orders, since } = await getSalesTotals();
  const reached = milestonesUpTo(total);
  if (reached.length === 0) return;

  // $setOnInsert leaves milestones recorded earlier exactly as they were.
  await Milestone.bulkWrite(
    reached.map((amount) => ({
      updateOne: {
        filter: { amount },
        update: { $setOnInsert: { amount, totalAtReach: total, orderId: order ? order.orderId : undefined } },
        upsert: true,
      },
    }))
  );

  // Also picks up any milestone whose email failed last time.
  const pending = await Milestone.find({ emailedAt: null }).sort({ amount: 1 });
  if (pending.length === 0) return;

  const sent = await sendMilestoneEmail({
    milestones: pending.map((m) => m.amount),
    total,
    orders,
    since,
    next: nextMilestone(total),
    order,
  });
  if (sent) {
    await Milestone.updateMany({ _id: { $in: pending.map((m) => m._id) } }, { emailedAt: new Date() });
  }
}

// Starts the total at zero from now. Milestone records are cleared so each
// one is celebrated again when the new total reaches it.
async function runReset() {
  await SalesReset.create({ at: new Date() });
  await Milestone.deleteMany({});
}

// Orders can land at almost the same moment; running the checks (and
// resets) one at a time means two of them can never both email the same
// milestone, and a check can't record old-total milestones after a reset.
let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

function checkMilestones(order) {
  return enqueue(() => runMilestoneCheck(order));
}

function resetSales() {
  return enqueue(runReset);
}

module.exports = {
  MILESTONES,
  milestonesUpTo,
  nextMilestone,
  startOfMonthIST,
  getSalesTotals,
  checkMilestones,
  resetSales,
};
