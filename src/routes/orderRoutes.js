const express = require("express");
const upload = require("../middleware/upload");
const { createOrder, createCustomOrder, enhanceCustomImage } = require("../controllers/orderController");

const router = express.Router();

router.post("/", createOrder);
// Enhancing is CPU-heavy, so cap it per IP (in memory - fine for one server).
const hits = new Map();
function limitEnhance(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 15) {
    return res.status(429).json({ message: "Too many enhance requests - please wait a few minutes." });
  }
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}

router.post("/custom/enhance", limitEnhance, upload.single("image"), enhanceCustomImage);
router.post("/custom", upload.single("image"), createCustomOrder);

module.exports = router;
