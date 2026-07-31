const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    description: { type: String, default: "" },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: 0,
    },
    category: {
      type: String,
      required: true,
      enum: ["spiritual", "clock", "lippan", "diya", "zharokha", "toran", "pipe-cleaner", "puja-thali", "other"],
      lowercase: true,
    },
    images: [{ type: String }],
    img: { type: String }, // main image
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sellerName: { type: String }, // denormalized for speed
    rating: { type: Number, default: 5, min: 1, max: 5 },
    numReviews: { type: Number, default: 0 },
    bestSeller: { type: Boolean, default: false },
    newArrival: { type: Boolean, default: true },
    stock: { type: Number, default: 10 },
    isActive: { type: Boolean, default: true },
    // Whether this product's photo represents its category on the homepage's
    // "Shop by Category" tile. Only one product per category can hold this.
    isCategoryImage: { type: Boolean, default: false },
    inGallery: { type: Boolean, default: false },
    // Seller-created products need admin approval before going public;
    // admin-created products are self-approved. Default true so existing
    // products (created before this field existed) don't vanish from the
    // public listing — the public query treats missing as approved too.
    isApproved: { type: Boolean, default: true },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

productSchema.index({ category: 1 });
productSchema.index({ seller: 1 });
productSchema.index({ name: "text", description: "text", sellerName: "text" });

// Setting isCategoryImage on one product demotes any other product already
// holding it for that category — keeps exactly one thumbnail per category
// regardless of which route (create or update) made the change.
productSchema.pre("save", async function () {
  if (this.isModified("isCategoryImage") && this.isCategoryImage) {
    await this.constructor.updateMany(
      { category: this.category, _id: { $ne: this._id } },
      { isCategoryImage: false }
    );
  }
});

module.exports = mongoose.model("Product", productSchema);
