const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { protect, adminOnly } = require("../middleware/auth");


// Seed first admin account. Gated by SEED_SECRET so it cannot be called by the public.
// Usage (once): POST /api/admin/seed-admin { secret, name, email, password }
router.post("/seed-admin", async (req, res) => {
  try {
    if (!process.env.SEED_SECRET || req.body.secret !== process.env.SEED_SECRET) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const exists = await User.findOne({ role: "admin" });
    if (exists) return res.status(400).json({ message: "Admin already exists" });

    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const admin = await User.create({
      name: name || "Admin",
      email,
      password,
      role: "admin",
      isVerified: true,
    });

    res.json({ message: "Admin created", email: admin.email });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// All routes below require admin authentication
router.use(protect, adminOnly);


// @GET /api/admin/stats
router.get("/stats", async (req, res) => {
  try {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Every number here comes from a count or an aggregation — never a full
    // Order.find() pulled into memory, so this stays cheap as orders grow.
    const [
      totalUsers,
      totalBuyers,
      totalSellers,
      totalProducts,
      totalOrders,
      pendingOrders,
      deliveredOrders,
      revenueAgg,
      monthlyAgg,
      categoryData,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "buyer" }),
      User.countDocuments({ role: "seller" }),
      Product.countDocuments({ isActive: true }),
      Order.countDocuments(),
      Order.countDocuments({ status: "pending" }),
      Order.countDocuments({ status: "delivered" }),
      Order.aggregate([{ $group: { _id: null, total: { $sum: "$totalAmount" } } }]),
      Order.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            total: { $sum: "$totalAmount" },
          },
        },
      ]),
      Product.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ]),
    ]);

    const totalRevenue = revenueAgg[0]?.total || 0;

    // Zero-filled last-6-months scaffold, then overlay the aggregation results.
    const monthlyRevenue = {};
    const monthKeys = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleString("default", { month: "short", year: "2-digit" });
      monthlyRevenue[key] = 0;
      monthKeys.push({ year: d.getFullYear(), month: d.getMonth() + 1, key });
    }
    monthlyAgg.forEach((m) => {
      const match = monthKeys.find((mk) => mk.year === m._id.year && mk.month === m._id.month);
      if (match) monthlyRevenue[match.key] = m.total;
    });

    res.json({
      totalUsers,
      totalBuyers,
      totalSellers,
      totalProducts,
      totalOrders,
      totalRevenue,
      pendingOrders,
      deliveredOrders,
      monthlyRevenue,
      categoryData,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @GET /api/admin/users
router.get("/users", async (req, res) => {
  try {
    const { role, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = {};

    if (role) filter.role = role;

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    res.json({ items: users, total, page, pages: Math.max(1, Math.ceil(total / limit)) });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @PUT /api/admin/users/:id
router.put("/users/:id", async (req, res) => {
  try {

    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: "User not found" });

    if (req.body.isActive !== undefined) user.isActive = req.body.isActive;
    if (req.body.role) user.role = req.body.role;

    const updated = await user.save();

    res.json({
      _id: updated._id,
      name: updated.name,
      role: updated.role,
      isActive: updated.isActive,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res) => {
  try {

    await User.findByIdAndDelete(req.params.id);

    res.json({ message: "User deleted" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @GET /api/admin/orders
router.get("/orders", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const [orders, total] = await Promise.all([
      Order.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Order.countDocuments(),
    ]);

    res.json({ items: orders, total, page, pages: Math.max(1, Math.ceil(total / limit)) });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @DELETE /api/admin/clear-analytics
router.delete("/clear-analytics", async (req, res) => {
  try {
    await Order.deleteMany({});
    res.json({ message: "Analytics data cleared (all orders deleted)" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @DELETE /api/admin/orders/:id
router.delete("/orders/:id", async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Order deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @GET /api/admin/products
router.get("/products", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const [products, total] = await Promise.all([
      Product.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Product.countDocuments(),
    ]);

    res.json({ items: products, total, page, pages: Math.max(1, Math.ceil(total / limit)) });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


module.exports = router;