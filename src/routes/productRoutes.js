const express = require("express");
const {
  listProducts,
  listFeatured,
  listHomeSections,
  listCollectionsSummary,
  getProduct,
  getRelated,
  addReview,
} = require("../controllers/productController");

const router = express.Router();

// Specific routes before the "/:id" catch-all.
router.get("/featured", listFeatured);
router.get("/sections", listHomeSections);
router.get("/collections-summary", listCollectionsSummary);
router.get("/:id/related", getRelated);
router.post("/:id/reviews", addReview);
router.get("/:id", getProduct);
router.get("/", listProducts);

module.exports = router;