/* =============================================
   CraftNext — Frontend API Helper
   All calls to the backend go through here
   ============================================= */

// Override by setting window.CRAFTNEXT_API_ORIGIN in a <script> tag before this
// file loads (e.g. for a deployment where the API isn't same-origin/proxied).
const API_ORIGIN = window.CRAFTNEXT_API_ORIGIN || (
  ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:5000"
    : window.location.origin
);
const API_BASE = API_ORIGIN + "/api";

/* Resolve a product image to an absolute URL.
   - uploaded images come back as "/uploads/.." → served by the API origin
   - seeded/static images are frontend assets like "Images/.." → used as-is */
function imgUrl(img) {
  if (!img) return "Images/placeholder.jpg";
  if (/^https?:\/\//.test(img)) return img;
  if (img.startsWith("/uploads")) return API_ORIGIN + img;
  return img;
}

/* ——— AUTH HELPERS ——— */

function getToken() {
  return localStorage.getItem("cn_token");
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("cn_user")) || null;
  } catch {
    return null;
  }
}

function saveAuth(data) {
  localStorage.setItem("cn_token", data.token);
  localStorage.setItem("cn_user", JSON.stringify(data));
}

function clearAuth() {
  localStorage.removeItem("cn_token");
  localStorage.removeItem("cn_user");
}

function isLoggedIn() {
  return !!getToken();
}

function isRole(role) {
  const u = getUser();
  return u && u.role === role;
}

/* ——— GENERIC FETCH WRAPPER ——— */

async function apiRequest(endpoint, method = "GET", body = null, auth = false) {
  const headers = { "Content-Type": "application/json" };

  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(API_BASE + endpoint, options);
  // A dead backend / proxy can answer with HTML or an empty body —
  // fall back to a clean error object instead of a JSON SyntaxError.
  const data = await res.json().catch(() => ({ message: `Server error (${res.status})` }));

  if (!res.ok) {
    // A previously-valid session died (expired/invalid token) — clear it and
    // send the user back to login instead of leaving the page half-authed.
    if (res.status === 401 && auth && getToken() && !location.pathname.endsWith("login.html")) {
      clearAuth();
      sessionStorage.setItem("redirect_after_login", location.pathname.split("/").pop() || "index.html");
      location.href = "login.html?sessionExpired=1";
    }
    throw new Error(data.message || "Request failed");
  }
  return data;
}

/* ——— AUTH ——— */

const Auth = {
  register: (payload) => apiRequest("/auth/register", "POST", payload),
  login: (email, password) => apiRequest("/auth/login", "POST", { email, password }),
  verifyOTP: (email, otp) => apiRequest("/auth/verify-otp", "POST", { email, otp }),
  resendOTP: (email) => apiRequest("/auth/resend-otp", "POST", { email }),
  me: () => apiRequest("/auth/me", "GET", null, true),
  updateProfile: (payload) => apiRequest("/auth/profile", "PUT", payload, true),
  forgotPassword: (email) => apiRequest("/auth/forgot-password", "POST", { email }),
  resetPassword: (email, token, newPassword) => apiRequest("/auth/reset-password", "POST", { email, token, newPassword }),
  getAddresses: () => apiRequest("/auth/addresses", "GET", null, true),
  addAddress: (payload) => apiRequest("/auth/addresses", "POST", payload, true),
  deleteAddress: (id) => apiRequest(`/auth/addresses/${id}`, "DELETE", null, true),
  async uploadAvatar(file) {
    const formData = new FormData();
    formData.append("avatar", file);
    const res = await fetch(API_BASE + "/auth/avatar", {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({ message: `Server error (${res.status})` }));
    if (!res.ok) throw new Error(data.message || "Upload failed");
    return data;
  },
  logout() {
    clearAuth();
    window.location.href = "login.html";
  },
  getSeller: (id) => apiRequest("/auth/seller/" + id),
  followSeller: (id) => apiRequest("/auth/seller/" + id + "/follow", "POST", null, true),
  broadcast: (message) => apiRequest("/auth/seller/broadcast", "POST", { message }, true),
};

/* ——— PRODUCTS ——— */

const Products = {
  getAll: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/products${q ? "?" + q : ""}`);
  },
  getById: (id) => apiRequest(`/products/${id}`),
  create: (payload) => apiRequest("/products", "POST", payload, true),
  update: (id, payload) => apiRequest(`/products/${id}`, "PUT", payload, true),
  delete: (id) => apiRequest(`/products/${id}`, "DELETE", null, true),
  deleteForever: (id) => apiRequest(`/products/${id}/permanent`, "DELETE", null, true),
  reviews: (id) => apiRequest(`/products/${id}/reviews`),
  addReview: (id, payload) => apiRequest(`/products/${id}/reviews`, "POST", payload, true),
  topSeller: () => apiRequest("/products/top-seller"),
  categoryImages: () => apiRequest("/products/category-images"),
  mine: () => apiRequest("/products/mine", "GET", null, true),
  like: (id) => apiRequest("/products/" + id + "/like", "POST", null, true),
};

/* ——— MESSAGES ——— */

const Messages = {
  getConversations: () => apiRequest("/messages/conversations", "GET", null, true),
  getHistory: (userId) => apiRequest("/messages/" + userId, "GET", null, true),
  send: (receiverId, content) => apiRequest("/messages", "POST", { receiverId, content }, true),
};

/* ——— ORDERS ——— */

const Orders = {
  create: (payload) => apiRequest("/orders", "POST", payload, true),
  myOrders: () => apiRequest("/orders/myorders", "GET", null, true),
  sellerOrders: () => apiRequest("/orders/seller", "GET", null, true),
  getById: (id) => apiRequest(`/orders/${id}`, "GET", null, true),
  updateStatus: (id, status) => apiRequest(`/orders/${id}/status`, "PUT", { status }, true),
  cancel: (id) => apiRequest(`/orders/${id}/cancel`, "PUT", null, true),
  verifyPayment: (id, payload) => apiRequest(`/orders/${id}/verify-payment`, "POST", payload, true),
};

/* ——— CHAT ASSISTANT ——— */

const Chat = {
  send: (message, history, cart) => apiRequest("/chat", "POST", { message, history, cart }),
};

/* ——— NEWSLETTER ——— */

const Newsletter = {
  subscribe: (email) => apiRequest("/newsletter/subscribe", "POST", { email }),
};

/* ——— COUPONS ——— */

const Coupons = {
  validate: (code, subtotal) => apiRequest(`/coupons/validate?code=${encodeURIComponent(code)}&subtotal=${subtotal}`),
  list: () => apiRequest("/coupons", "GET", null, true),
  create: (payload) => apiRequest("/coupons", "POST", payload, true),
  update: (id, payload) => apiRequest(`/coupons/${id}`, "PUT", payload, true),
};

/* ——— ADMIN ——— */

const Admin = {
  stats: () => apiRequest("/admin/stats", "GET", null, true),
  users: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/admin/users${q ? "?" + q : ""}`, "GET", null, true);
  },
  updateUser: (id, payload) => apiRequest(`/admin/users/${id}`, "PUT", payload, true),
  deleteUser: (id) => apiRequest(`/admin/users/${id}`, "DELETE", null, true),
  orders: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/admin/orders${q ? "?" + q : ""}`, "GET", null, true);
  },
  deleteOrder: (id) => apiRequest(`/admin/orders/${id}`, "DELETE", null, true),
  clearAnalytics: () => apiRequest("/admin/clear-analytics", "DELETE", null, true),
  products: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/admin/products${q ? "?" + q : ""}`, "GET", null, true);
  },
  seedAdmin: (payload) => apiRequest("/admin/seed-admin", "POST", payload),
};

/* ——— UPDATE NAVBAR BASED ON LOGIN STATE ——— */

function updateNavbar() {
  const user = getUser();
  const loginLinks = document.querySelectorAll("a[href='login.html']");

  loginLinks.forEach((link) => {
    if (user) {
      link.textContent = user.name.split(" ")[0];
      link.href = user.role === "admin" ? "admin.html" :
                  user.role === "seller" ? "seller-dashboard.html" : "profile.html";
    }
  });

  // Show/hide sell link for buyers, or redirect to login with seller role pre-selected if not logged in
  const sellLinks = document.querySelectorAll("a[href='sell.html']");
  if (user) {
    if (user.role === "buyer") {
      sellLinks.forEach(l => l.style.display = "none");
    }
  } else {
    sellLinks.forEach(l => {
      l.href = "login.html?role=seller";
    });
  }
}

document.addEventListener("DOMContentLoaded", updateNavbar);
