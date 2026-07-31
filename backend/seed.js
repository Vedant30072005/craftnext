/* =============================================================
   CraftNext — DB seed
   Inserts the artisan seller + the canonical handmade catalog.
   Idempotent: safe to run multiple times (upserts by name+seller).
   Run:  node seed.js   (from the backend/ folder)
   ============================================================= */

require("dotenv").config();
const mongoose = require("mongoose");
const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]); // matches server.js — some networks can't resolve the Atlas SRV record otherwise
const User = require("./models/User");
const Product = require("./models/Product");

const SELLER = {
  name: "Archana Rana",
  email: process.env.SEED_SELLER_EMAIL || "archana@craftnext.com",
  password: process.env.SEED_SELLER_PASSWORD || "artisan123",
  role: "seller",
  shopName: "Archana Handmade Arts",
  shopDescription: "Handcrafted Gujarati art — Lippan, Mandala, Diya & more.",
  location: "Valsad, Gujarat",
  phone: "+91 9876543210",
  isVerified: true,
};

const PRODUCTS = [
  {
    name: "Krishna Painting",
    price: 450,
    category: "spiritual",
    img: "Images/Spiritual Art/krishna-1.jpeg",
    bestSeller: true,
    description:
      "Hand-painted Krishna devotional artwork, crafted using traditional Indian art techniques. Perfect for spiritual home décor.",
  },
  {
    name: "Lippan Art",
    price: 450,
    category: "lippan",
    img: "Images/Lippan Art/best1.jpeg",
    newArrival: true,
    description:
      "Authentic Gujarati Lippan art created with clay and mirrors. Adds a vibrant cultural touch to your home décor.",
  },
  {
    name: "Mandala Clock",
    price: 650,
    category: "clock",
    img: "Images/Clock/Clock.jpeg",
    bestSeller: true,
    description:
      "Hand-painted mandala wall clock that combines artistic design with functionality.",
  },
  {
    name: "Kodi Art",
    price: 75,
    category: "diya",
    img: "Images/Diya Art/1.jpeg",
    newArrival: true,
    description:
      "Traditional Kodi-shell decorated diya, hand-painted and ideal for festive and everyday display.",
  },
  {
    name: "Decorative Vase",
    price: 550,
    category: "zharokha",
    img: "Images/Zharokha Art/1.jpeg",
    newArrival: true,
    description:
      "Hand-painted decorative vase with intricate patterns, perfect for modern or traditional interiors.",
  },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { family: 4 });
    console.log("✅ MongoDB connected");

    // Seller — created via .create() so the password gets hashed by the pre-save hook
    let seller = await User.findOne({ email: SELLER.email });
    if (!seller) {
      seller = await User.create(SELLER);
      console.log(`👤 Seller created: ${seller.email}  (password: ${SELLER.password})`);
    } else {
      console.log(`👤 Seller already exists: ${seller.email}`);
    }

    for (const p of PRODUCTS) {
      await Product.findOneAndUpdate(
        { name: p.name, seller: seller._id },
        {
          ...p,
          images: [p.img],
          seller: seller._id,
          sellerName: seller.shopName || seller.name,
          stock: 10,
          isActive: true,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log(`🛍  upserted: ${p.name}`);
    }

    console.log("✅ Seed complete");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
})();
