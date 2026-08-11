const mongoose = require("mongoose");

// Retry with backoff instead of killing the process — a briefly
// unreachable Atlas cluster shouldn't take the whole API down.
const RETRY_MS = 5000;

const seedDefaults = async () => {
  try {
    const User = require("../models/User");
    const adminExists = await User.findOne({ role: "admin" });
    if (!adminExists) {
      await User.create({
        name: "CraftNext Admin",
        email: "admin@craftnext.com",
        password: "admin123",
        role: "admin",
        isVerified: true,
        isActive: true,
      });
      console.log("👑 Auto-seeded default admin: admin@craftnext.com / admin123");
    }

    const sellerExists = await User.findOne({ email: "archana@craftnext.com" });
    if (!sellerExists) {
      await User.create({
        name: "Archana Rana",
        email: "archana@craftnext.com",
        password: "artisan123",
        role: "seller",
        shopName: "Archana Handmade Arts",
        shopDescription: "Handcrafted Gujarati art — Lippan, Mandala, Diya & more.",
        location: "Valsad, Gujarat",
        phone: "+91 9876543210",
        isVerified: true,
        isActive: true,
      });
      console.log("👤 Auto-seeded default seller: archana@craftnext.com / artisan123");
    }
  } catch (err) {
    console.warn("Auto-seed notice:", err.message);
  }
};

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    const message = "MONGO_URI is not set; skipping MongoDB connection.";
    if (process.env.NODE_ENV === "production") {
      console.error(`❌ ${message}`);
      process.exit(1);
    }
    console.warn(`⚠️ ${message}`);
    return;
  }
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      family: 4
    });
    console.log("✅ MongoDB Connected");
    await seedDefaults();
  } catch (error) {
    console.error(`❌ MongoDB Error: ${error.message} — retrying in ${RETRY_MS / 1000}s`);
    setTimeout(connectDB, RETRY_MS);
  }
};

// After the initial connect, mongoose auto-reconnects on its own —
// these logs just make drops visible instead of silent.
mongoose.connection.on("disconnected", () => {
  console.error("⚠️ MongoDB disconnected — mongoose will auto-reconnect");
});
mongoose.connection.on("reconnected", () => {
  console.log("✅ MongoDB reconnected");
});

module.exports = connectDB;