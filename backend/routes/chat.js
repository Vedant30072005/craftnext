const express = require("express");
const router = express.Router();
const { GoogleGenAI, ApiError } = require("@google/genai");
const Product = require("../models/Product");

// Comma-separated keys let requests spread across each key's own free-tier
// quota — round-robin on the happy path, fall back to the next key if one
// hits a rate limit or an invalid-key error.
const API_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

let nextKey = 0;

const SYSTEM_PROMPT = `You are the CraftNext Assistant — a friendly guide embedded on the CraftNext website, a marketplace for handmade goods (categories: spiritual items, clocks, lippan art, diyas, zharokhas, torans, pipe-cleaner art, puja thalis, and other handcrafted decor).

What you know about CraftNext:
- Buyers browse products, add them to a cart or wishlist, and check out as a guest or as a logged-in buyer.
- Checkout is Cash on Delivery. Shipping is free above ₹999, otherwise a flat ₹49 fee applies. Coupon codes can be entered at checkout for a discount.
- After signup, users verify their email with a 6-digit OTP (valid 5 minutes) before they can log in. "Forgot password" sends a reset link valid for 30 minutes.
- Logged-in buyers can save multiple shipping addresses on their profile, cancel an order only while it is still "pending" (from their orders list), and leave a 1-5 star rating with a comment on products they've bought.
- Order status moves: pending → confirmed → shipped → delivered (or cancelled). Buyers get an email at each status change.
- To sell on CraftNext, a user registers as a seller (shop name, description, location) and lists products with a name, price, category, stock count, and photo from their seller dashboard.
- An admin manages users, products, orders, and coupons from an admin dashboard.

How to answer:
- Keep replies short — 2 to 4 sentences, friendly and plain-spoken.
- Only answer questions about using CraftNext (buying, selling, orders, account, shipping, returns policy). For anything else, politely say you're just here to help with the CraftNext site.
- Never invent specific order numbers or transaction logs. Point the user to the relevant page instead (their orders page, profile page, or the contact page). However, you DO have access to their active shopping cart items (listed below) and should use this data to accurately describe, review, total, or recommend items from their current cart if asked.
- If someone reports a bug or a specific problem with their account/order, tell them to reach out via the Contact page since you can't look up individual accounts.`;

// @POST /api/chat — public, stateless (client resends its own history each time)
router.post("/", async (req, res) => {
    const message = String(req.body.message || "").trim().slice(0, 1000);
    if (!message) {
      return res.status(400).json({ message: "Please enter a message." });
    }

    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];
    const history = rawHistory
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content.slice(0, 1000) }],
      }));

    history.push({ role: "user", parts: [{ text: message }] });

    // Dynamically query available products to inject context into assistant
    let productCatalogContext = "";
    try {
      const activeProducts = await Product.find({ isActive: true, isApproved: { $ne: false } })
        .select("name category sellerName price")
        .limit(30);
      productCatalogContext = activeProducts.map(p => 
        `- ${p.name} (Category: ${p.category}, Price: ₹${p.price}, ID: ${p._id.toString()})`
      ).join("\n");
    } catch (dbErr) {
      console.warn("Could not query products for chat context:", dbErr.message);
    }

    const cart = Array.isArray(req.body.cart) ? req.body.cart : [];
    let cartContext = "";
    if (cart.length > 0) {
      cartContext = cart.map(item => `- ${item.name} (Quantity: ${item.qty}, Price: ₹${item.price}, ID: ${item.id}, Image: ${item.img})`).join("\n");
    } else {
      cartContext = "The user's shopping cart is currently empty.";
    }

    const dynamicSystemPrompt = `${SYSTEM_PROMPT}

User's Current Shopping Cart:
${cartContext}

Available Product Catalog (use these exact IDs for recommendations):
${productCatalogContext || "No products currently available."}

How to link products:
- When recommending any product from the catalog, you MUST link it using markdown link format: [Product Name](product.html?id=ID). Example: "I highly recommend checking out our [Krishna Painting](product.html?id=65a3f...)."
- NEVER invent product IDs. Only link products that exist in the Available Product Catalog above.

How to display cart items:
- When listing items in the user's current shopping cart, you MUST render their image right before the item name in the list using markdown image syntax: ![Item Name](Image_Path). Example: "* ![Lippan Art](uploads/123.jpg) **Lippan Art** (Quantity: 1, Price: ₹499)"`;

    const startIdx = nextKey;
    nextKey = (nextKey + 1) % API_KEYS.length;

    let lastErr;
    for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
      const key = API_KEYS[(startIdx + attempt) % API_KEYS.length];
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: history,
          config: {
            systemInstruction: dynamicSystemPrompt,
            maxOutputTokens: 450,
          },
        });
        return res.json({ reply: response.text || "Sorry, I couldn't come up with a response." });
      } catch (err) {
        lastErr = err;
        const retryableOnNextKey = err instanceof ApiError && (err.status === 429 || err.status === 401);
        if (!retryableOnNextKey) break;
      }
    }

    if (lastErr instanceof ApiError && lastErr.status === 401) {
      console.error("Chat: invalid GEMINI_API_KEY(S)");
    } else if (lastErr instanceof ApiError && lastErr.status === 429) {
      console.error("Chat: Gemini rate limit hit on all keys");
    } else {
      console.error("Chat error:", lastErr && lastErr.message);
    }
    res.status(500).json({ message: "The assistant is temporarily unavailable. Please try again in a moment." });
});

module.exports = router;
