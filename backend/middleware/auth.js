const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Helper to parse cookies from headers without dependency
const parseCookies = (cookieHeader) => {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    list[parts.shift().trim()] = decodeURIComponent(parts.join("="));
  });
  return list;
};

// Protect routes - verify JWT
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies.cn_token;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select("-password");

      // Token is valid but the account is gone or suspended — reject now
      // instead of honoring a still-unexpired token for a disabled user.
      if (!req.user) {
        return res.status(401).json({ message: "Account no longer exists" });
      }
      if (req.user.isActive === false) {
        return res.status(403).json({ message: "Account suspended. Contact support." });
      }
      return next();
    } catch (error) {
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  }

  return res.status(401).json({ message: "Not authorized, no token" });
};

// Populates req.user if a valid token is present, but never blocks the
// request — used by routes that support both guest and logged-in flows
// (e.g. checkout).
const optionalProtect = async (req, res, next) => {
  let token;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer")) {
    token = auth.split(" ")[1];
  } else if (req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies.cn_token;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("-password");
      // Only attach a live, non-suspended account. A suspended or deleted
      // user simply proceeds as a guest here (this route supports guests).
      if (user && user.isActive !== false) req.user = user;
    } catch (error) {
      // invalid/expired token on an optional route — proceed as guest
    }
  }
  next();
};

// Admin only
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied: Admins only" });
  }
};

// Seller or Admin
const sellerOrAdmin = (req, res, next) => {
  if (req.user && (req.user.role === "seller" || req.user.role === "admin")) {
    next();
  } else {
    res.status(403).json({ message: "Access denied: Sellers only" });
  }
};

module.exports = { protect, adminOnly, sellerOrAdmin, optionalProtect };
