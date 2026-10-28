const express = require("express");
const { login, me } = require("../controllers/adminAuthController");
const {
  adminListProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/adminProductController");
const {
  adminListOrders,
  adminSalesStats,
  adminResetSalesStats,
  adminMakePrintFile,
  adminPrintSource,
  adminAiUsage,
} = require("../controllers/orderController");
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
router.get("/stats", requireAdmin, adminSalesStats);
router.post("/stats/reset", requireAdmin, adminResetSalesStats);

// Print files tool: upload / link -> enhanced A3/A4/A5 JPEG to download
router.post("/print", requireAdmin, upload.large.single("image"), adminMakePrintFile);
router.post("/print/source", requireAdmin, adminPrintSource);
router.get("/ai-usage", requireAdmin, adminAiUsage);

module.exports = router;
