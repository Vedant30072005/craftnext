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
  if (mongoose.connection.readyState >= 1) return;
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI environment variable is not configured in Vercel settings.");
  }
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  
  try {
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
    }
  } catch (seedErr) {
    console.warn("Auto-seed notice:", seedErr.message);
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
