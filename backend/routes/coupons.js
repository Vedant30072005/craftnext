const express = require("express");
const router = express.Router();
const Coupon = require("../models/Coupon");
const { protect, adminOnly } = require("../middleware/auth");

// Shared: validate a code against subtotal, returns the discount or a reason it's invalid.
// Never trust a client-computed discount — this is the one place that decides it.
async function computeDiscount(code, subtotal) {
  if (!code) return { valid: false, message: "No code provided" };

  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase(), isActive: true });
  if (!coupon) return { valid: false, message: "Invalid or inactive coupon code" };
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return { valid: false, message: "This coupon has expired" };
  }
  if (subtotal < (coupon.minOrderAmount || 0)) {
    return { valid: false, message: `Minimum order of ₹${coupon.minOrderAmount} required for this coupon` };
  }

  const discountAmount = coupon.discountType === "percent"
    ? Math.round((subtotal * coupon.discountValue) / 100)
    : Math.min(coupon.discountValue, subtotal);

  return { valid: true, code: coupon.code, discountAmount };
}

// @GET /api/coupons/validate?code=X&subtotal=Y — public, no side effects
router.get("/validate", async (req, res) => {
  try {
    const subtotal = Number(req.query.subtotal) || 0;
    const result = await computeDiscount(req.query.code, subtotal);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/coupons — admin only, list all
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/coupons — admin only, create
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { code, discountType, discountValue, minOrderAmount, expiresAt } = req.body;

    if (!code || !code.trim()) return res.status(400).json({ message: "Code is required" });
    if (!["percent", "flat"].includes(discountType)) {
      return res.status(400).json({ message: "discountType must be 'percent' or 'flat'" });
    }
    if (!(discountValue > 0)) return res.status(400).json({ message: "Discount value must be greater than 0" });

    const coupon = await Coupon.create({
      code: code.trim().toUpperCase(),
      discountType,
      discountValue,
      minOrderAmount: minOrderAmount || 0,
      expiresAt: expiresAt || undefined,
    });

    res.status(201).json(coupon);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "A coupon with this code already exists" });
    }
    res.status(500).json({ message: err.message });
  }
});

// @PUT /api/coupons/:id — admin only, toggle active / edit
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });

    if (req.body.isActive !== undefined) coupon.isActive = req.body.isActive;
    if (req.body.discountValue !== undefined) coupon.discountValue = req.body.discountValue;
    if (req.body.minOrderAmount !== undefined) coupon.minOrderAmount = req.body.minOrderAmount;
    if (req.body.expiresAt !== undefined) coupon.expiresAt = req.body.expiresAt;

    const updated = await coupon.save();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = { router, computeDiscount };
