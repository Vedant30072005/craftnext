const mongoose = require("mongoose");

const subscriberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    unsubscribed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Subscriber", subscriberSchema);
