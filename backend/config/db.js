const mongoose = require("mongoose");

// Retry with backoff instead of killing the process — a briefly
// unreachable Atlas cluster shouldn't take the whole API down.
const RETRY_MS = 5000;

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