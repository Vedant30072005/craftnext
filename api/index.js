/* =============================================
   Vercel Serverless Entrypoint for CraftNext API
   ============================================= */

const app = require("../backend/app");
const mongoose = require("mongoose");

let isConnected = false;

async function connectDB() {
  if (isConnected && mongoose.connection.readyState >= 1) return;
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn("MONGO_URI is not set in environment variables");
    return;
  }
  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
  } catch (err) {
    console.error("Vercel Mongo Connection Error:", err.message);
  }
}

module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (err) {
    console.error("connectDB error:", err);
  }

  const matchedPath = req.headers["x-matched-path"] || req.headers["x-forwarded-uri"] || req.headers["x-now-route-matches"];
  if (matchedPath && !matchedPath.includes("api/index")) {
    req.url = matchedPath;
  } else if (req.url && !req.url.startsWith("/api")) {
    req.url = "/api" + (req.url.startsWith("/") ? "" : "/") + req.url;
  }

  return app(req, res);
};
