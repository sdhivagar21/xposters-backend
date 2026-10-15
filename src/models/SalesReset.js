const mongoose = require("mongoose");

// One document each time the owner resets the sales total to zero from the
// admin page. The newest one is where totals and milestones count from;
// earlier orders stay in the database, they just stop counting.
const salesResetSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SalesReset", salesResetSchema);
