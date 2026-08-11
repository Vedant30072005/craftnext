/* =============================================
   Vercel Serverless Entrypoint for CraftNext API
   ============================================= */

const path = require("path");
if (!module.paths.includes(path.join(__dirname, "../backend/node_modules"))) {
  module.paths.push(path.join(__dirname, "../backend/node_modules"));
}
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
  const matchedPath = req.headers["x-matched-path"] || req.headers["x-forwarded-uri"] || req.headers["x-now-route-matches"];
  if (matchedPath && !matchedPath.includes("api/index")) {
    req.url = matchedPath;
  } else if (req.url && !req.url.startsWith("/api")) {
    req.url = "/api" + (req.url.startsWith("/") ? "" : "/") + req.url;
  }
  return app(req, res);
};
