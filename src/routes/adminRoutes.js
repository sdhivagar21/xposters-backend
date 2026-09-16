const express = require("express");
const { login, me } = require("../controllers/adminAuthController");
const {
  adminListProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/adminProductController");
const { adminListOrders } = require("../controllers/orderController");
const { requireAdmin } = require("../middleware/auth");
const upload = require("../middleware/upload");

const router = express.Router();

// Auth
router.post("/login", login);
router.get("/me", requireAdmin, me);

// Products (all protected)
router.get("/products", requireAdmin, adminListProducts);
router.post("/products", requireAdmin, upload.single("image"), createProduct);
router.put("/products/:id", requireAdmin, upload.single("image"), updateProduct);
router.delete("/products/:id", requireAdmin, deleteProduct);

// Orders (protected, read-only for now)
router.get("/orders", requireAdmin, adminListOrders);

module.exports = router;
