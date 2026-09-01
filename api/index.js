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

  // Restore the original requested URL from Vercel rewrite parameter or headers
  try {
    const rawUrl = req.url || "/";
    const parsed = new URL(rawUrl, "http://localhost");
    if (parsed.searchParams.has("__url")) {
      const targetPath = parsed.searchParams.get("__url");
      parsed.searchParams.delete("__url");
      const remainingQuery = parsed.searchParams.toString();
      req.url = targetPath + (remainingQuery ? "?" + remainingQuery : "");
    } else {
      const matched = req.headers["x-matched-path"] || req.headers["x-forwarded-uri"];
      if (matched && !matched.includes("api/index")) {
        req.url = matched;
      }
    }
  } catch (e) {
    console.error("URL resolution error:", e);
  }

  return app(req, res);
};
