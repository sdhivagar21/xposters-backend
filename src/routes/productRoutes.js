const express = require("express");
const { listProducts, listFeatured, getProduct, getRelated, addReview } = require("../controllers/productController");

const router = express.Router();

router.get("/featured", listFeatured);
router.get("/:id/related", getRelated);
router.post("/:id/reviews", addReview);
router.get("/:id", getProduct);
router.get("/", listProducts);

module.exports = router;
