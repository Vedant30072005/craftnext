/**
 * CraftNext API integration tests.
 * Runs the real Express app against an in-memory MongoDB — no Atlas,
 * no network. Email sending is mocked out.
 */

// Tests run without .env — provide the secrets the app needs.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

jest.mock("../utils/mailer", () => ({
  sendOTPEmail: jest.fn().mockResolvedValue(true),
  sendResetEmail: jest.fn().mockResolvedValue(true),
  sendOrderConfirmationEmail: jest.fn().mockResolvedValue(true),
  sendOrderStatusEmail: jest.fn().mockResolvedValue(true),
}));

// Replica set (not standalone) because the order route uses transactions.
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  await Product.createIndexes(); // text index needed for search tests
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Product.deleteMany({}),
    Order.deleteMany({}),
  ]);
});

/* ——— helpers ——— */

async function registerAndVerify(overrides = {}) {
  const payload = {
    name: "Test User",
    email: `u${Date.now()}${Math.floor(Math.random() * 1e5)}@test.com`,
    password: "secret123",
    ...overrides,
  };
  const reg = await request(app).post("/api/auth/register").send(payload);
  expect(reg.status).toBe(201);
  const dbUser = await User.findOne({ email: payload.email }).select("+otp otp");
  await request(app).post("/api/auth/verify-otp")
    .send({ email: payload.email, otp: dbUser.otp });
  const login = await request(app).post("/api/auth/login")
    .send({ email: payload.email, password: payload.password });
  expect(login.status).toBe(200);
  return { token: login.body.token, user: login.body, payload };
}

function makeProduct(sellerId, overrides = {}) {
  return Product.create({
    name: "Lippan Mirror Art",
    description: "Handmade mirror work",
    price: 500,
    category: "lippan",
    seller: sellerId,
    sellerName: "Test Shop",
    stock: 5,
    isActive: true,
    isApproved: true,
    ...overrides,
  });
}

const shipping = {
  name: "Buyer One", email: "buyer@test.com", phone: "9999999999",
  address: "12 Craft Lane", city: "Mumbai", pincode: "400001",
};

/* ——— health ——— */

describe("health + 404", () => {
  test("GET /api/health returns ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toMatch(/running/i);
  });

  test("unknown route returns JSON 404", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Route not found");
  });
});

/* ——— auth ——— */

describe("auth", () => {
  test("register → verify → login round-trip issues a token", async () => {
    const { token, user } = await registerAndVerify();
    expect(token).toBeTruthy();
    expect(user.role).toBe("buyer");
  });

  test("login before OTP verification is rejected", async () => {
    const email = "unverified@test.com";
    await request(app).post("/api/auth/register")
      .send({ name: "U", email, password: "secret123" });
    const res = await request(app).post("/api/auth/login")
      .send({ email, password: "secret123" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("self-registration as admin is downgraded to buyer", async () => {
    const { user } = await registerAndVerify({ role: "admin" });
    expect(user.role).toBe("buyer");
  });

  test("wrong password is rejected", async () => {
    const { payload } = await registerAndVerify();
    const res = await request(app).post("/api/auth/login")
      .send({ email: payload.email, password: "wrong-password" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.token).toBeUndefined();
  });

  test("duplicate email registration is rejected", async () => {
    const { payload } = await registerAndVerify();
    const res = await request(app).post("/api/auth/register").send(payload);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already registered/i);
  });
});

/* ——— products ——— */

describe("products", () => {
  test("public listing returns only active+approved products", async () => {
    const { user } = await registerAndVerify({ role: "seller", shopName: "S1" });
    await makeProduct(user._id);
    await makeProduct(user._id, { name: "Hidden", isActive: false });
    await makeProduct(user._id, { name: "Awaiting", isApproved: false });

    const res = await request(app).get("/api/products");
    expect(res.status).toBe(200);
    expect(res.body.map(p => p.name)).toEqual(["Lippan Mirror Art"]);
  });

  test("text search finds products by word", async () => {
    const { user } = await registerAndVerify({ role: "seller", shopName: "S1" });
    await makeProduct(user._id, { name: "Peacock Mandala Clock" });
    await makeProduct(user._id, { name: "Diya Tray" });

    const res = await request(app).get("/api/products").query({ search: "mandala" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Peacock Mandala Clock");
  });

  test("creating a product requires auth", async () => {
    const res = await request(app).post("/api/products")
      .field("name", "X").field("price", "100").field("category", "lippan");
    expect(res.status).toBe(401);
  });

  test("a seller can create a product via the API", async () => {
    const { token } = await registerAndVerify({ role: "seller", shopName: "S1" });
    const res = await request(app).post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .field("name", "API Made Art")
      .field("price", "750")
      .field("category", "diya")
      .field("stock", "4");
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("API Made Art");
    expect(res.body.price).toBe(750);
  });
});

/* ——— orders ——— */

describe("orders", () => {
  test("guest COD order decrements stock and computes totals server-side", async () => {
    const { user } = await registerAndVerify({ role: "seller", shopName: "S1" });
    const product = await makeProduct(user._id, { price: 500, stock: 5 });

    const res = await request(app).post("/api/orders").send({
      items: [{ product: product._id, qty: 2, price: 1 /* client price must be ignored */ }],
      shipping,
      paymentMethod: "COD",
    });
    expect(res.status).toBe(201);
    // 2 × ₹500 = ₹1000 subtotal — above free-shipping threshold ⇒ total 1000
    expect(res.body.totalAmount).toBe(1000);

    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(3);
  });

  test("shipping fee is charged below the free-shipping threshold", async () => {
    const { user } = await registerAndVerify({ role: "seller", shopName: "S1" });
    const product = await makeProduct(user._id, { price: 100, stock: 5 });

    const res = await request(app).post("/api/orders").send({
      items: [{ product: product._id, qty: 1 }],
      shipping,
      paymentMethod: "COD",
    });
    expect(res.status).toBe(201);
    expect(res.body.shippingFee).toBeGreaterThan(0);
    expect(res.body.totalAmount).toBe(100 + res.body.shippingFee);
  });

  test("ordering more than stock is rejected and nothing is decremented", async () => {
    const { user } = await registerAndVerify({ role: "seller", shopName: "S1" });
    const product = await makeProduct(user._id, { stock: 1 });

    const res = await request(app).post("/api/orders").send({
      items: [{ product: product._id, qty: 3 }],
      shipping,
      paymentMethod: "COD",
    });
    expect(res.status).toBe(409);

    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(1);
  });

  test("two buyers racing for the last unit: exactly one succeeds", async () => {
    const { user } = await registerAndVerify({ role: "seller", shopName: "S1" });
    const product = await makeProduct(user._id, { stock: 1 });

    const order = () => request(app).post("/api/orders").send({
      items: [{ product: product._id, qty: 1 }],
      shipping,
      paymentMethod: "COD",
    });
    const [a, b] = await Promise.all([order(), order()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(0);
  });

  test("same idempotency key returns the original order, no duplicate", async () => {
    const { user } = await registerAndVerify({ role: "seller", shopName: "S1" });
    const product = await makeProduct(user._id, { stock: 5 });

    const payload = {
      items: [{ product: product._id, qty: 1 }],
      shipping,
      paymentMethod: "COD",
      idempotencyKey: "test-key-123",
    };
    const first = await request(app).post("/api/orders").send(payload);
    const second = await request(app).post("/api/orders").send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body._id).toBe(first.body._id);
    expect(await Order.countDocuments()).toBe(1);

    const fresh = await Product.findById(product._id);
    expect(fresh.stock).toBe(4); // decremented exactly once
  });

  test("invoice PDF is generated for the order's buyer", async () => {
    const seller = await registerAndVerify({ role: "seller", shopName: "S1" });
    const buyer = await registerAndVerify();
    const product = await makeProduct(seller.user._id, { stock: 5 });

    const orderRes = await request(app).post("/api/orders")
      .set("Authorization", `Bearer ${buyer.token}`)
      .send({ items: [{ product: product._id, qty: 1 }], shipping, paymentMethod: "COD" });
    expect(orderRes.status).toBe(201);

    const inv = await request(app)
      .get(`/api/orders/${orderRes.body._id}/invoice`)
      .set("Authorization", `Bearer ${buyer.token}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(inv.status).toBe(200);
    expect(inv.headers["content-type"]).toMatch(/application\/pdf/);
    expect(inv.body.slice(0, 5).toString()).toBe("%PDF-");
  });
});
