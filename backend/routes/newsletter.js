const express = require("express");
const router = express.Router();
const Subscriber = require("../models/Subscriber");

// @POST /api/newsletter/subscribe — public
router.post("/subscribe", async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Please enter a valid email address" });
    }

    await Subscriber.findOneAndUpdate(
      { email },
      { email, unsubscribed: false },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ message: "Subscribed! Watch your inbox for weekly picks." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/newsletter/unsubscribe?email=X — public, one-click like any mailing list
router.get("/unsubscribe", async (req, res) => {
  try {
    const email = (req.query.email || "").trim().toLowerCase();
    await Subscriber.updateOne({ email }, { unsubscribed: true });
    res.json({ message: "You've been unsubscribed." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
