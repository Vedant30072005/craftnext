require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);

// In production, an unset CLIENT_URL must not silently fall back to "*" —
// fail at startup instead of shipping an open CORS policy.
if (process.env.NODE_ENV === "production" && !process.env.CLIENT_URL) {
  console.error("❌ CLIENT_URL must be set in production (refusing to start with CORS wide open).");
  process.exit(1);
}

const connectDB = require("./config/db");
const app = require("./app");

// Connect to MongoDB
connectDB();

// Background sweep: reclaim stock from online orders whose payment window
// lapsed without completing (see utils/reclaimStock).
const { startReservationSweep } = require("./utils/reclaimStock");
if (process.env.MONGO_URI) {
  startReservationSweep();
}

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`🚀 CraftNext Server running on http://localhost:${PORT}`);
});

// ---- Crash-proofing ----------------------------------------------------
// Every route already has its own try/catch, but a missed async rejection
// on Node 15+ would kill the whole process. Log and keep serving instead.
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled promise rejection:", reason);
});

// A truly uncaught synchronous throw leaves state unknown — log it, but
// keep the process up: for this app staying degraded beats going dark.
process.on("uncaughtException", (err) => {
  console.error("⚠️ Uncaught exception:", err);
});

// Graceful shutdown: stop accepting new connections, let in-flight
// requests finish, then exit. Force-exit after 10s as a backstop.
function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
