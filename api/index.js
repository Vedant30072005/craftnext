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
  } catch (err) {
    console.error("Vercel Serverless Mongo Connection Error:", err.message);
  }
}

module.exports = async (req, res) => {
  await connectDB();
  return app(req, res);
};
