/* =============================================
   Vercel Serverless Entrypoint for CraftNext API
   ============================================= */

const app = require("../backend/app");
const mongoose = require("mongoose");

let isConnected = false;

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) return;
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn("MONGO_URI environment variable not configured.");
    return;
  }
  try {
    await mongoose.connect(mongoUri);
    isConnected = true;
    
    // Auto-seed admin/seller if database is fresh/empty
    const User = require("../backend/models/User");
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
  } catch (err) {
    console.error("Vercel Serverless Mongo Connection Error:", err.message);
  }
}

module.exports = async (req, res) => {
  await connectDB();
  return app(req, res);
};
