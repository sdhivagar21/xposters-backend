const express = require("express");
const upload = require("../middleware/upload");
const { createOrder, createCustomOrder } = require("../controllers/orderController");

const router = express.Router();

router.post("/", createOrder);
router.post("/custom", upload.single("image"), createCustomOrder);

module.exports = router;
