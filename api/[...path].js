/* =============================================
   Vercel Serverless Catch-All Entrypoint for /api/*
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

  // Restore the original route from Vercel dynamic path parameter
  if (req.query && req.query.path) {
    const subpath = Array.isArray(req.query.path)
      ? req.query.path.join("/")
      : req.query.path;
    
    // Construct the full /api/... path while preserving other query params
    const queryParams = { ...req.query };
    delete queryParams.path;
    const qs = new URLSearchParams(queryParams).toString();
    req.url = "/api/" + subpath + (qs ? "?" + qs : "");
  }

  return app(req, res);
};
