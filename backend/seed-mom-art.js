/* =============================================================
   CraftNext — seed mom's Drive art
   One-off import of Archana's product photos pulled from Google
   Drive into Images/<Category>/ (see conversation for the mapping).
   Idempotent: upserts by name+seller, safe to re-run.
   Run:  node seed-mom-art.js   (from the backend/ folder)
   ============================================================= */

require("dotenv").config();
const mongoose = require("mongoose");
const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
const User = require("./models/User");
const Product = require("./models/Product");

const SELLER_EMAIL = process.env.SEED_SELLER_EMAIL || "archana@craftnext.com";

// Diyas are intentionally priced far below everything else — small,
// quick-to-make pieces sold in higher volume around festivals.
const CATEGORY_PRICES = {
  lippan: 450,
  clock: 650,
  zharokha: 550,
  diya: 75,
  toran: 350,
  "pipe-cleaner": 150,
  "puja-thali": 300,
};

// Rotated per item (by index) so products in the same category don't all
// carry an identical description.
const CATEGORY_DESCRIPTIONS = {
  lippan: [
    "Authentic Gujarati Lippan art created with clay and mirrors. Adds a vibrant cultural touch to your home décor.",
    "Hand-molded Lippan mural work with inlaid mirror pieces, finished in traditional motifs.",
    "One-of-a-kind Lippan mirror art, hand-shaped and painted — no two pieces are exactly alike.",
  ],
  clock: [
    "Hand-painted mandala wall clock that combines artistic design with functionality.",
    "Mirror-inlaid mandala wall clock, hand-painted petal by petal for a striking centerpiece.",
    "Statement wall clock with hand-detailed mandala artwork and a working quartz movement.",
  ],
  zharokha: [
    "Hand-painted zharokha mirror-work frame with intricate patterns, perfect for wall décor.",
    "Traditional Rajasthani-style zharokha frame, hand-painted with mirror inlay detailing.",
    "Ornate zharokha wall art piece, handcrafted to bring a palace-window look to any room.",
  ],
  diya: [
    "Traditional hand-decorated diya, ideal for festive and everyday display.",
    "Hand-painted clay diya with mirror and bead detailing — a festive table or shelf accent.",
    "Small-batch handmade diya, individually decorated for Diwali and year-round display.",
  ],
  toran: [
    "Handcrafted door toran made with traditional Gujarati techniques — a festive touch for any entrance.",
    "Hand-strung decorative toran for doorways, made with traditional mirror-work and beadwork.",
    "Festive door hanging toran, handcrafted with vibrant traditional patterns.",
  ],
  "pipe-cleaner": [
    "Colorful handcrafted pipe-cleaner art, a playful and unique decorative piece.",
    "Hand-shaped pipe-cleaner craft art, bright and whimsical — great for shelves or gifting.",
    "Handmade pipe-cleaner sculpture art with careful detailing in every twist and coil.",
  ],
  "puja-thali": [
    "Beautifully decorated puja thali, handcrafted for daily rituals and festive occasions.",
    "Hand-painted puja thali with mirror and bead work, made for everyday worship and festive pujas.",
  ],
};

const CATEGORY_LABELS = {
  lippan: "Lippan Art",
  clock: "Mandala Wall Clock",
  zharokha: "Zharokha Mirror Frame",
  diya: "Decorative Diya",
  toran: "Handcrafted Toran",
  "pipe-cleaner": "Pipe Cleaner Craft",
  "puja-thali": "Decorated Puja Thali",
};

// [category, folder, count, filenamePrefix]
const BATCHES = [
  ["lippan", "Lippan Art", 9, "lippan"],
  ["clock", "Clock", 4, "clock-mom"],
  ["zharokha", "Zharokha Art", 4, "zharokha-mom"],
  ["diya", "Diya Art", 6, "diya-mom"],
  ["toran", "Toran", 7, "toran"],
  ["pipe-cleaner", "Pipe Cleaner", 7, "pipe-cleaner"],
  ["puja-thali", "Puja Thali", 1, "puja-thali"],
];

const EXT_BY_INDEX = {
  lippan: ["png", "png", "png", "jpg", "png", "jpeg", "jpeg", "jpeg", "png"],
  "clock-mom": ["png", "png", "png", "png"],
  "zharokha-mom": ["jpeg", "jpeg", "jpeg", "jpeg"],
  "diya-mom": ["jpeg", "jpeg", "jpeg", "jpeg", "jpeg", "jpeg"],
  toran: ["png", "png", "png", "png", "png", "png", "png"],
  "pipe-cleaner": ["jpg", "png", "jpeg", "jpeg", "jpeg", "jpeg", "jpeg"],
  "puja-thali": ["png"],
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { family: 4 });
    console.log("✅ MongoDB connected");

    const seller = await User.findOne({ email: SELLER_EMAIL });
    if (!seller) {
      throw new Error(`Seller ${SELLER_EMAIL} not found — run seed.js first.`);
    }
    console.log(`👤 Using seller: ${seller.email}`);

    let created = 0;
    for (const [category, folder, count, prefix] of BATCHES) {
      const exts = EXT_BY_INDEX[prefix];
      for (let i = 1; i <= count; i++) {
        const ext = exts[i - 1];
        const img = `Images/${folder}/${prefix}-${i}.${ext}`;
        const name = `${CATEGORY_LABELS[category]} ${i}`;
        const descPool = CATEGORY_DESCRIPTIONS[category];
        const description = descPool[(i - 1) % descPool.length];

        await Product.findOneAndUpdate(
          { name, seller: seller._id },
          {
            name,
            price: CATEGORY_PRICES[category],
            category,
            img,
            images: [img],
            description,
            newArrival: true,
            seller: seller._id,
            sellerName: seller.shopName || seller.name,
            stock: 10,
            isActive: true,
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        created++;
        console.log(`🛍  upserted: ${name} (${img})`);
      }
    }

    console.log(`✅ Seed complete — ${created} products upserted`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
})();
