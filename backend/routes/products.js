const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const Review = require("../models/Review");
const User = require("../models/User");
const { protect, sellerOrAdmin, adminOnly } = require("../middleware/auth");
const optimizeImages = require("../middleware/optimizeImage");
const { body, validationResult } = require("express-validator");

const multer = require("multer");
const path = require("path");
const fs = require("fs");

/* ================= MULTER CONFIG ================= */

const storage = multer.diskStorage({

  destination: function (req, file, cb) {

    const category = req.body.category || "other";

    const uploadPath = path.join(__dirname, `../uploads/${category}`);

    // create folder if not exists
    fs.mkdirSync(uploadPath, { recursive: true });

    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {

    // Random suffix (not just Date.now()) — multiple files in one multi-image
    // upload can land in the same millisecond and would otherwise collide.
    const uniqueName =
      Date.now() + "-" + Math.round(Math.random() * 1e9) + "-" + file.originalname.replace(/\s+/g, "_");

    cb(null, uniqueName);
  },

});

// Accept images only, cap at 5 MB — uploads are served statically, so reject anything executable.
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|gif|avif)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error("Only image files are allowed");
      err.status = 400;
      cb(err);
    }
  },
});


/* ================= GET PRODUCTS ================= */

// @GET /api/products — public
router.get("/", async (req, res) => {
  try {

    const { category, search, seller, inGallery } = req.query;

    // isApproved: { $ne: false } treats missing (pre-approval-feature) products
    // as approved, and hides only products explicitly awaiting/denied approval.
    const filter = { isActive: true, isApproved: { $ne: false } };

    if (category) filter.category = category;

    if (seller) filter.seller = seller;

    if (inGallery) filter.inGallery = inGallery === "true";

    if (search) {
      // Uses the text index on name/description/sellerName instead of a
      // full-collection regex scan.
      filter.$text = { $search: search };
    }

    const products = await Product.find(filter).sort({ createdAt: -1 });

    res.json(products);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ================= TOP SELLER ================= */

// @GET /api/products/top-seller — public. Ranked by average product rating
// (weighted by review count as a tiebreaker) among sellers with active listings.
router.get("/top-seller", async (req, res) => {
  try {
    const agg = await Product.aggregate([
      { $match: { isActive: true, seller: { $ne: null } } },
      {
        $group: {
          _id: "$seller",
          avgRating: { $avg: "$rating" },
          totalReviews: { $sum: "$numReviews" },
          productCount: { $sum: 1 },
        },
      },
      { $sort: { avgRating: -1, totalReviews: -1 } },
      { $limit: 1 },
    ]);

    if (!agg.length) return res.json(null);

    const seller = await User.findById(agg[0]._id).select("name shopName location phone avatar shopDescription");
    if (!seller) return res.json(null);

    res.json({
      name: seller.shopName || seller.name,
      location: seller.location || "",
      phone: seller.phone || "",
      avatar: seller.avatar || "",
      description: seller.shopDescription || "",
      rating: Math.round((agg[0].avgRating || 5) * 10) / 10,
      numReviews: agg[0].totalReviews || 0,
      productCount: agg[0].productCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ================= CATEGORY IMAGES ================= */

// @GET /api/products/category-images — public. Returns { category: imgUrl }
// for every category that has a product marked isCategoryImage. Categories
// with no marked product are simply absent — frontend keeps its default art.
router.get("/category-images", async (req, res) => {
  try {
    const marked = await Product.find({ isCategoryImage: true, isActive: true }).select("category img");
    const map = {};
    marked.forEach((p) => { map[p.category] = p.img; });
    res.json(map);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ================= MY PRODUCTS ================= */

// @GET /api/products/mine — seller/admin, own listings regardless of
// approval/active status (the public "/" route hides pending ones).
router.get("/mine", protect, sellerOrAdmin, async (req, res) => {
  try {
    const products = await Product.find({ seller: req.user._id }).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ================= GET SINGLE PRODUCT ================= */

// @GET /api/products/:id — public
router.get("/:id", async (req, res) => {
  try {

    const product = await Product.findById(req.params.id).populate(
      "seller",
      "name shopName location avatar phone shopDescription"
    );

    if (!product)
      return res.status(404).json({ message: "Product not found" });

    res.json(product);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ================= CREATE PRODUCT ================= */

// @POST /api/products — seller/admin
router.post(
  "/",
  protect,
  sellerOrAdmin,
  upload.array("images", 5),
  optimizeImages(1200),
  [
    body("name").trim().notEmpty().withMessage("Product name is required"),
    body("price").isFloat({ gt: 0 }).withMessage("Price must be greater than 0"),
    body("category").isIn(["spiritual", "clock", "lippan", "diya", "zharokha", "toran", "pipe-cleaner", "puja-thali", "other"]).withMessage("Invalid category"),
    body("stock").optional({ values: "falsy" }).isInt({ min: 0 }).withMessage("Stock cannot be negative"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: errors.array()[0].msg });
      }

      const { name, description, price, category, stock, bestSeller, newArrival, isCategoryImage, inGallery } = req.body;

      // First uploaded image is the main/cover photo; all of them go into the gallery.
      const imagePaths = (req.files || []).map((f) => `/uploads/${category}/${f.filename}`);

      const product = await Product.create({
        name,
        description,
        price,
        category,
        img: imagePaths[0] || "",
        images: imagePaths,
        stock: stock || 10,
        seller: req.user._id,
        sellerName: req.user.shopName || req.user.name,
        ...(bestSeller !== undefined && { bestSeller: bestSeller === "true" }),
        ...(newArrival !== undefined && { newArrival: newArrival === "true" }),
        ...(isCategoryImage !== undefined && { isCategoryImage: isCategoryImage === "true" }),
        ...(inGallery !== undefined && { inGallery: inGallery === "true" }),
        // Admin-added products are self-approved; seller-added ones wait for review.
        isApproved: req.user.role === "admin",
      });

      res.status(201).json(product);

    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);


/* ================= UPDATE PRODUCT ================= */

// @PUT /api/products/:id — seller (own) or admin
router.put("/:id", protect, sellerOrAdmin, async (req, res) => {
  try {

    const product = await Product.findById(req.params.id);

    if (!product)
      return res.status(404).json({ message: "Product not found" });

    if (
      req.user.role !== "admin" &&
      product.seller.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    Object.assign(product, req.body);

    const updated = await product.save();

    res.json(updated);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ================= DELETE PRODUCT ================= */

// @DELETE /api/products/:id — seller/admin
router.delete("/:id", protect, sellerOrAdmin, async (req, res) => {
  try {

    const product = await Product.findById(req.params.id);

    if (!product)
      return res.status(404).json({ message: "Product not found" });

    if (
      req.user.role !== "admin" &&
      product.seller.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    product.isActive = false;

    await product.save();

    res.json({ message: "Product removed" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @DELETE /api/products/:id/permanent — admin only. Actually removes the
// document (the route above just deactivates it). Orders keep their own
// copy of product name/price/img, so past orders are unaffected.
router.delete("/:id/permanent", protect, adminOnly, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product permanently deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ================= REVIEWS ================= */

// @GET /api/products/:id/reviews — public
router.get("/:id/reviews", async (req, res) => {
  try {
    const reviews = await Review.find({ product: req.params.id }).sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/products/:id/reviews — logged-in users; one review each (upsert)
router.post("/:id/reviews", protect, async (req, res) => {
  try {
    const rating = parseInt(req.body.rating, 10);
    if (!(rating >= 1 && rating <= 5)) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    await Review.findOneAndUpdate(
      { product: product._id, user: req.user._id },
      {
        product: product._id,
        user: req.user._id,
        name: req.user.name,
        rating,
        comment: (req.body.comment || "").trim(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Recompute the product's aggregate rating
    const reviews = await Review.find({ product: product._id });
    product.numReviews = reviews.length;
    product.rating = reviews.length
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
      : 5;
    await product.save();

    res.status(201).json({ rating: product.rating, numReviews: product.numReviews });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @POST /api/products/:id/like — protect
router.post("/:id/like", protect, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const userId = req.user._id;
    const isLiked = product.likes.includes(userId);

    if (isLiked) {
      product.likes = product.likes.filter((id) => id.toString() !== userId.toString());
    } else {
      product.likes.push(userId);
    }

    await product.save();
    res.json({
      liked: !isLiked,
      likesCount: product.likes.length,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


module.exports = router;