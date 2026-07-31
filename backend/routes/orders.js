const mongoose = require("mongoose");
const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");
const { protect, adminOnly, optionalProtect } = require("../middleware/auth");
const { computeDiscount } = require("./coupons");
const { sendOrderConfirmationEmail, sendOrderStatusEmail } = require("../utils/mailer");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_dummykey123",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "dummysecret123"
});

const FREE_SHIPPING_THRESHOLD = 999;
const SHIPPING_FEE = 49;

// Restore stock for items already decremented earlier in a failed order attempt.
async function restock(decremented) {
  for (const d of decremented) {
    await Product.updateOne({ _id: d.id }, { $inc: { stock: d.qty } });
  }
}

// @POST /api/orders  — create order (buyer or guest)
router.post("/", optionalProtect, async (req, res) => {
  let session = null;
  let transactionActive = false;
  const decremented = [];

  try {
    const { items, shipping, paymentMethod, couponCode, idempotencyKey } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items in order" });
    }
    if (!req.user && (!shipping || !shipping.name || !shipping.email)) {
      return res.status(400).json({ message: "Name and email are required for guest checkout" });
    }

    // A retried/double-submitted request with the same key returns the
    // original order instead of creating (and re-charging) a duplicate.
    if (idempotencyKey) {
      const existing = await Order.findOne({ idempotencyKey });
      if (existing) return res.status(200).json(existing);
    }

    // Initialize transaction session if supported by environment
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      transactionActive = true;
    } catch (sessionErr) {
      session = null;
      transactionActive = false;
    }

    // Rebuild every line item from the DB — never trust client-supplied
    // prices, names, or sellers.
    const orderItems = [];
    let subtotal = 0;

    for (const i of items) {
      if (!i.product) {
        if (transactionActive && session) {
          await session.abortTransaction();
          session.endSession();
        } else {
          await restock(decremented);
        }
        return res.status(400).json({ message: "Each item must reference a product id" });
      }

      const qty = Math.max(1, parseInt(i.qty, 10) || 1);

      // Atomic: the stock>=qty check and the decrement happen as a single
      // document operation, so two buyers racing for the last unit can't
      // both succeed — the second one simply won't match.
      const query = { _id: i.product, isActive: true, stock: { $gte: qty } };
      const update = { $inc: { stock: -qty } };
      const options = session ? { session, new: false } : { new: false };

      const product = await Product.findOneAndUpdate(query, update, options);

      if (!product) {
        if (transactionActive && session) {
          await session.abortTransaction();
          session.endSession();
        } else {
          await restock(decremented);
        }
        const existing = await Product.findById(i.product);
        if (!existing || !existing.isActive) {
          return res.status(404).json({ message: `Product not available: ${i.product}` });
        }
        return res.status(409).json({ message: `Only ${existing.stock} left of "${existing.name}"` });
      }

      if (!transactionActive) {
        decremented.push({ id: product._id, qty });
      }

      orderItems.push({
        product: product._id,
        name: product.name,
        img: product.img,
        price: product.price,
        qty,
        seller: product.seller,
        sellerName: product.sellerName,
      });
      subtotal += product.price * qty;
    }

    const shippingFee = subtotal > FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;

    // Coupon — validated and priced server-side; a client-sent discount is never trusted.
    let discountAmount = 0;
    let appliedCoupon;
    if (couponCode) {
      const result = await computeDiscount(couponCode, subtotal);
      if (!result.valid) {
        if (transactionActive && session) {
          await session.abortTransaction();
          session.endSession();
        } else {
          await restock(decremented);
        }
        return res.status(400).json({ message: result.message });
      }
      discountAmount = result.discountAmount;
      appliedCoupon = result.code;
    }

    // Normalize + whitelist the payment method (case-insensitive) so it can't
    // be an arbitrary persisted string, and so "online" vs "Online" agree.
    const ONLINE_METHODS = { card: "Card", upi: "UPI", online: "Online" };
    const rawMethod = String(paymentMethod || "COD").trim();
    const isOnlinePayment = Object.prototype.hasOwnProperty.call(ONLINE_METHODS, rawMethod.toLowerCase());
    const normalizedMethod = isOnlinePayment ? ONLINE_METHODS[rawMethod.toLowerCase()]
      : (rawMethod.toLowerCase() === "cod" ? "COD" : "COD");
    const totalAmount = Math.max(0, subtotal + shippingFee - discountAmount);

    // Online orders hold their decremented stock only for this window; the
    // sweep reclaims it if payment never completes. COD reserves nothing.
    const RESERVATION_MINUTES = 15;

    const orderData = {
      buyer: req.user ? req.user._id : undefined,
      buyerName: req.user ? req.user.name : shipping.name,
      buyerEmail: req.user ? req.user.email : shipping.email,
      items: orderItems,
      shipping,
      shippingFee,
      couponCode: appliedCoupon,
      discountAmount,
      totalAmount,
      paymentMethod: normalizedMethod,
      idempotencyKey,
      isPaid: false,
      ...(isOnlinePayment && {
        reservationExpiresAt: new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000),
      }),
    };

    let order;
    try {
      if (session) {
        const created = await Order.create([orderData], { session });
        order = created[0];
      } else {
        order = await Order.create(orderData);
      }
    } catch (err) {
      // Two identical requests raced past the findOne check above — the unique
      // index caught it. Return the order that won instead of erroring or overselling.
      if (err.code === 11000 && idempotencyKey) {
        if (transactionActive && session) {
          await session.abortTransaction();
          session.endSession();
        } else {
          await restock(decremented);
        }
        const winner = await Order.findOne({ idempotencyKey });
        return res.status(200).json(winner);
      }
      throw err;
    }

    // Commit the DB writes (stock decrement + order) BEFORE touching Razorpay.
    // The external gateway call must not run inside an open transaction — it
    // would hold row locks + a pooled connection open across a multi-second
    // network round-trip and serialize checkouts under load.
    if (transactionActive && session) {
      await session.commitTransaction();
      session.endSession();
      session = null;
      transactionActive = false;
    }

    // Now that the order is durable, mint the Razorpay order (online only).
    // A gateway failure falls back to a dummy id so local/offline dev still
    // works; the dummy id is only ever *honored* outside production.
    if (isOnlinePayment) {
      let rzpOrderId;
      try {
        const rzpOrder = await razorpay.orders.create({
          amount: Math.round(totalAmount * 100), // paise
          currency: "INR",
          receipt: String(order._id),
        });
        rzpOrderId = rzpOrder.id;
      } catch (rzpErr) {
        console.warn("Razorpay order creation failed:", rzpErr.message);
        rzpOrderId = "order_dummy_" + crypto.randomBytes(8).toString("hex");
      }
      order.razorpayOrderId = rzpOrderId;
      await Order.updateOne({ _id: order._id }, { razorpayOrderId: rzpOrderId });
    }

    res.status(201).json(order);

    // Fire-and-forget confirmation for COD/non-online orders — off the request
    // path so SMTP latency never inflates checkout time. Online orders defer
    // their email to /verify-payment (after payment is confirmed).
    if (!isOnlinePayment) {
      sendOrderConfirmationEmail(order.buyerEmail, order)
        .catch((mailErr) => console.warn("Order confirmation email failed:", mailErr.message));
    }
  } catch (err) {
    if (transactionActive && session) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {}
      session.endSession();
    } else {
      await restock(decremented);
    }
    // Two checkouts hitting the same product doc inside concurrent
    // transactions abort one with a transient WriteConflict — that's
    // contention, not a server fault. Tell the buyer to retry (409)
    // instead of surfacing a 500.
    const transient =
      err.code === 112 ||
      (err.errorLabels && err.errorLabels.includes("TransientTransactionError")) ||
      /write conflict/i.test(err.message || "");
    if (transient) {
      return res.status(409).json({ message: "That item is in high demand — please try again." });
    }
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/orders/myorders  — buyer's own orders
router.get("/myorders", protect, async (req, res) => {
  try {
    const orders = await Order.find({ buyer: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/orders/seller  — seller's orders
router.get("/seller", protect, async (req, res) => {
  try {
    const orders = await Order.find({
      "items.seller": req.user._id,
    }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/orders/:id  — the buyer who owns it, a seller in it, or an admin
router.get("/:id", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const uid = req.user._id.toString();
    const isOwner = order.buyer && order.buyer.toString() === uid;
    const isSeller = order.items.some((it) => it.seller && it.seller.toString() === uid);
    if (!isOwner && !isSeller && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized" });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/orders/:id/invoice — streams a PDF invoice (buyer/seller/admin)
router.get("/:id/invoice", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const uid = req.user._id.toString();
    const isOwner = order.buyer && order.buyer.toString() === uid;
    const isSeller = order.items.some((it) => it.seller && it.seller.toString() === uid);
    if (!isOwner && !isSeller && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized" });
    }

    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    const shortId = order._id.toString().slice(-8).toUpperCase();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=CraftNext-Invoice-${shortId}.pdf`);
    doc.pipe(res);

    const TERRACOTTA = "#b3491f";
    const INK = "#1d1d1f";
    const MUTED = "#6e6e73";
    const rupee = (n) => `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;

    // Header
    doc.fontSize(24).fillColor(TERRACOTTA).font("Helvetica-Bold").text("CraftNext");
    doc.fontSize(9).fillColor(MUTED).font("Helvetica").text("Handmade Marketplace", { continued: false });
    doc.moveUp(2);
    doc.fontSize(16).fillColor(INK).font("Helvetica-Bold").text("INVOICE", { align: "right" });
    doc.fontSize(9).fillColor(MUTED).font("Helvetica")
      .text(`#${shortId}`, { align: "right" })
      .text(new Date(order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), { align: "right" });

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#e5e5e7").stroke();
    doc.moveDown(1);

    // Bill to
    const s = order.shipping || {};
    doc.fontSize(10).fillColor(MUTED).text("BILLED TO");
    doc.fontSize(11).fillColor(INK).font("Helvetica-Bold").text(s.name || order.buyerName || "Customer");
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    if (s.address) doc.text(`${s.address}, ${s.city || ""} ${s.pincode || ""}`);
    if (s.phone) doc.text(`Phone: ${s.phone}`);
    if (s.email || order.buyerEmail) doc.text(`Email: ${s.email || order.buyerEmail}`);

    doc.moveDown(1.5);

    // Items table
    const tableTop = doc.y;
    const col = { name: 50, qty: 330, price: 390, total: 470 };
    doc.fontSize(9).fillColor(MUTED).font("Helvetica-Bold");
    doc.text("ITEM", col.name, tableTop);
    doc.text("QTY", col.qty, tableTop);
    doc.text("PRICE", col.price, tableTop);
    doc.text("TOTAL", col.total, tableTop);
    doc.moveTo(50, tableTop + 14).lineTo(545, tableTop + 14).strokeColor("#e5e5e7").stroke();

    let y = tableTop + 22;
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    order.items.forEach((it) => {
      doc.text(it.name || "Item", col.name, y, { width: 260 });
      doc.text(String(it.qty), col.qty, y);
      doc.text(rupee(it.price), col.price, y);
      doc.text(rupee(it.price * it.qty), col.total, y);
      y += 20;
    });

    doc.moveTo(50, y + 4).lineTo(545, y + 4).strokeColor("#e5e5e7").stroke();
    y += 14;

    // Totals
    const itemsSubtotal = order.items.reduce((sum, it) => sum + it.price * it.qty, 0);
    const line = (label, value, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 10)
        .fillColor(bold ? TERRACOTTA : INK);
      doc.text(label, 350, y, { width: 110 });
      doc.text(value, col.total, y);
      y += bold ? 22 : 17;
    };
    line("Subtotal", rupee(itemsSubtotal));
    if (order.discountAmount) line(`Coupon (${order.couponCode || "-"})`, `- ${rupee(order.discountAmount)}`);
    line("Shipping", order.shippingFee ? rupee(order.shippingFee) : "FREE");
    line("Grand Total", rupee(order.totalAmount), true);

    // Footer
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    doc.text(`Payment: ${order.paymentMethod}${order.isPaid ? " (Paid)" : order.paymentMethod === "COD" ? " (Pay on delivery)" : " (Pending)"}`, 50, y + 10);
    doc.text(`Status: ${order.status}`, 50, y + 26);
    doc.fontSize(8).fillColor(MUTED)
      .text("Thank you for supporting handmade. — CraftNext", 50, 780, { align: "center", width: 495 });

    doc.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @PUT /api/orders/:id/status  — a seller in the order, or an admin
// (buyers must not be able to mark their own order delivered/paid)
router.put("/:id/status", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const uid = req.user._id.toString();
    const isSeller = order.items.some((it) => it.seller && it.seller.toString() === uid);
    if (!isSeller && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized" });
    }

    const allowed = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
    if (!allowed.includes(req.body.status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    order.status = req.body.status;
    if (req.body.status === "delivered") {
      order.isPaid = true;
      order.paidAt = new Date();
    }

    const updated = await order.save();

    try {
      await sendOrderStatusEmail(updated.buyerEmail, updated);
    } catch (mailErr) {
      console.warn("Order status email failed:", mailErr.message);
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @PUT /api/orders/:id/cancel  — buyer cancels their own order while still pending
router.put("/:id/cancel", protect, async (req, res) => {
  try {
    // Atomic guard: flip pending→cancelled in one operation, scoped to the
    // owner. If two cancels race, only one matches — so stock is restored
    // exactly once instead of double-incremented (phantom inventory).
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, buyer: req.user._id, status: "pending" },
      { status: "cancelled" },
      { new: true }
    );

    if (!order) {
      // Distinguish "not yours / doesn't exist" from "not cancellable" so the
      // client can show the right message.
      const existing = await Order.findById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Order not found" });
      if (!existing.buyer || existing.buyer.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Not authorized" });
      }
      return res.status(400).json({ message: "Only pending orders can be cancelled" });
    }

    for (const item of order.items) {
      if (item.product) {
        await Product.updateOne({ _id: item.product }, { $inc: { stock: item.qty } });
      }
    }

    res.json(order);

    sendOrderStatusEmail(order.buyerEmail, order)
      .catch((mailErr) => console.warn("Order cancellation email failed:", mailErr.message));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/orders/:id/verify-payment — verify online signature and mark order paid
router.post("/:id/verify-payment", async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Idempotent + replay-safe: an already-paid order returns success without
    // re-marking or re-emailing. Blocks the "verify the same order twice" replay.
    if (order.isPaid) {
      return res.json({ success: true, order, alreadyPaid: true });
    }

    // The client-submitted order id MUST match the one the server minted for
    // this order at creation. Without this, the id is attacker-controlled and
    // the whole verification means nothing.
    if (!order.razorpayOrderId || razorpay_order_id !== order.razorpayOrderId) {
      return res.status(400).json({ message: "Payment order mismatch" });
    }

    // "Dummy" is decided from SERVER state (the id we stored), never from the
    // client body — and never in production. Previously any request could set
    // razorpay_order_id="order_dummy_x" and mark any order paid for free.
    const isDummy = order.razorpayOrderId.startsWith("order_dummy_");

    let paidPaymentId, paidSignature;
    if (isDummy) {
      if (process.env.NODE_ENV === "production") {
        return res.status(400).json({ message: "Payment verification failed" });
      }
      paidPaymentId = razorpay_payment_id || "pay_dummy_123456";
      paidSignature = razorpay_signature || "sig_dummy_123456";
    } else {
      // Real Razorpay HMAC verification.
      if (!razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: "Payment details missing" });
      }
      if (!process.env.RAZORPAY_KEY_SECRET) {
        // No secret configured — refuse rather than verify against a known
        // placeholder (which an attacker could sign against).
        return res.status(500).json({ message: "Payment gateway not configured" });
      }
      const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
      hmac.update(order.razorpayOrderId + "|" + razorpay_payment_id);
      const generated = hmac.digest("hex");

      // Constant-time compare — avoids a timing side-channel on the signature.
      const sigBuf = Buffer.from(razorpay_signature, "utf8");
      const genBuf = Buffer.from(generated, "utf8");
      if (sigBuf.length !== genBuf.length || !crypto.timingSafeEqual(sigBuf, genBuf)) {
        return res.status(400).json({ message: "Invalid payment signature" });
      }

      paidPaymentId = razorpay_payment_id;
      paidSignature = razorpay_signature;
    }

    // Atomic mark-paid: only if the order is still unpaid AND hasn't been
    // cancelled by the reservation sweep in the meantime. Clears the
    // reservation so the sweep never touches a paid order.
    const paid = await Order.findOneAndUpdate(
      { _id: order._id, isPaid: false, status: { $ne: "cancelled" } },
      {
        isPaid: true,
        paidAt: new Date(),
        razorpayPaymentId: paidPaymentId,
        razorpaySignature: paidSignature,
        $unset: { reservationExpiresAt: "" },
      },
      { new: true }
    );

    if (!paid) {
      // Lost the race: the payment window expired and the sweep already
      // cancelled + restocked this order. In a real gateway this is where a
      // refund would be triggered.
      return res.status(409).json({
        message: "This order's payment window expired and it was cancelled. Please order again.",
      });
    }

    // Respond first; email is best-effort and must not delay the response.
    res.json({ success: true, order: paid });
    sendOrderConfirmationEmail(paid.buyerEmail, paid)
      .catch((mailErr) => console.warn("Order confirmation email failed:", mailErr.message));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
