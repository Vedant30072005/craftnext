const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  name: String,
  img: String,
  price: Number,
  qty: Number,
  seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  sellerName: String,
});

const orderSchema = new mongoose.Schema(
  {
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    buyerName: String,
    buyerEmail: String,

    items: [orderItemSchema],

    shipping: {
      name: String,
      email: String,
      phone: String,
      address: String,
      city: String,
      pincode: String,
    },

    shippingFee: { type: Number, default: 0 },
    couponCode: { type: String },
    discountAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },

    status: {
      type: String,
      enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"],
      default: "pending",
    },

    paymentMethod: { type: String, default: "COD" },
    isPaid: { type: Boolean, default: false },
    paidAt: Date,

    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,

    // Online orders decrement stock at creation but aren't paid until the
    // gateway callback. If the buyer abandons payment, this timestamp lets a
    // background sweep reclaim the reserved stock. Cleared once paid; unset
    // entirely for COD (which is "confirmed" immediately).
    reservationExpiresAt: { type: Date },

    // Client-generated, one per checkout attempt — lets a retried/double-submitted
    // request return the original order instead of creating (and re-charging) a duplicate.
    idempotencyKey: { type: String },
  },
  { timestamps: true }
);

orderSchema.index({ buyer: 1 });
orderSchema.index({ "items.seller": 1 });
orderSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
// Drives the abandoned-order sweep: find unpaid, still-pending orders whose
// reservation window has passed. Sparse so COD/paid orders (no field) are excluded.
orderSchema.index({ reservationExpiresAt: 1 }, { sparse: true });

module.exports = mongoose.model("Order", orderSchema);
