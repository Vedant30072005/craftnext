const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const User = require("../models/User");
const { protect } = require("../middleware/auth");

// @POST /api/messages - send a message
router.post("/", protect, async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    if (!receiverId || !content) {
      return res.status(400).json({ message: "Receiver ID and content are required" });
    }

    // Verify receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ message: "Receiver not found" });
    }

    const msg = await Message.create({
      sender: req.user._id,
      receiver: receiverId,
      content,
    });

    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/messages/conversations - get unique conversations list
router.get("/conversations", protect, async (req, res) => {
  try {
    const userId = req.user._id;
    // Find all messages involving this user
    const messages = await Message.find({
      $or: [{ sender: userId }, { receiver: userId }]
    }).sort({ createdAt: -1 });

    // Deduplicate by conversation partner
    const conversations = [];
    const seenUsers = new Set();

    for (const msg of messages) {
      const partnerId = msg.sender.toString() === userId.toString() ? msg.receiver : msg.sender;
      const partnerIdStr = partnerId.toString();

      if (!seenUsers.has(partnerIdStr)) {
        seenUsers.add(partnerIdStr);
        // Fetch partner details
        const partner = await User.findById(partnerId).select("name shopName role avatar");
        if (partner) {
          conversations.push({
            partner,
            lastMessage: msg.content,
            updatedAt: msg.createdAt,
          });
        }
      }
    }

    res.json(conversations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/messages/:userId - get message history with a user
router.get("/:userId", protect, async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const partnerId = req.params.userId;

    const messages = await Message.find({
      $or: [
        { sender: currentUserId, receiver: partnerId },
        { sender: partnerId, receiver: currentUserId }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
