const Order = require("../models/Order");
const Product = require("../models/Product");

// Reclaims stock from abandoned online orders: unpaid, still-pending orders
// whose reservation window (set at creation) has passed. Each order is claimed
// with an atomic conditional update, so this is safe to run concurrently with
// /verify-payment — whichever operation commits first wins, the other's guard
// (isPaid:false / status:pending) no longer matches. Returns the count reclaimed.
async function reclaimAbandonedOrders() {
  let reclaimed = 0;

  for (;;) {
    const order = await Order.findOneAndUpdate(
      { isPaid: false, status: "pending", reservationExpiresAt: { $lte: new Date() } },
      { status: "cancelled", $unset: { reservationExpiresAt: "" } },
      { new: true }
    );
    if (!order) break;

    for (const item of order.items) {
      if (item.product) {
        await Product.updateOne({ _id: item.product }, { $inc: { stock: item.qty } });
      }
    }
    reclaimed++;
  }

  return reclaimed;
}

// Runs the sweep on an interval. `unref()` keeps the timer from holding the
// process open on its own. Returns handles so callers can trigger/stop it.
function startReservationSweep(intervalMs = 5 * 60 * 1000) {
  const run = () =>
    reclaimAbandonedOrders()
      .then((n) => { if (n) console.log(`♻️  Reclaimed stock from ${n} abandoned order(s)`); })
      .catch((err) => console.warn("Reservation sweep failed:", err.message));

  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { run, stop: () => clearInterval(timer) };
}

module.exports = { reclaimAbandonedOrders, startReservationSweep };
