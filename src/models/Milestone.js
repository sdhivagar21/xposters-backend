const mongoose = require("mongoose");

// One document per sales milestone the store has crossed (Rs 5,000,
// Rs 10,000, ... - see utils/milestones.js). Its existence is what stops the
// same milestone being celebrated twice; emailedAt stays null until the
// milestone email actually goes out, so a failed send is retried on the next
// order.
const milestoneSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, unique: true },
    totalAtReach: { type: Number, required: true }, // total collected when it was first noticed
    orderId: { type: String }, // the order that pushed the total over, if any
    emailedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Milestone", milestoneSchema);
