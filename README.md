# CraftNext — Handmade Marketplace

A full-stack marketplace for handmade Indian artisan products (Lippan art,
mandala clocks, diyas, décor). Buyers browse and order; sellers list products,
track analytics and chat with buyers; an admin oversees users, products and
revenue. Installable as a PWA, covered by an automated API test suite.

<!-- screenshots: drop PNGs into docs/ and reference them here -->
<!-- ![Homepage](docs/screenshot-home.png) -->
<!-- ![Admin dashboard](docs/screenshot-admin.png) -->

## Tech stack

| Layer     | Tech |
|-----------|------|
| Frontend  | Vanilla HTML / CSS / JavaScript (no build step), PWA (manifest + service worker) |
| Backend   | Node.js, Express |
| Database  | MongoDB (Mongoose) |
| Auth      | JWT (Bearer tokens) + bcrypt password hashing, email OTP verification |
| Email     | Resend API for OTP + order lifecycle emails |
| AI        | Google Gemini API (free tier) for the on-site assistant chatbox |
| Payments  | Razorpay (test mode) + Cash on Delivery |
| Uploads   | Multer (image-only, 5 MB cap) + sharp recompression pipeline |
| PDF       | pdfkit — per-order invoice generation |
| Tests     | Jest + Supertest + mongodb-memory-server (in-memory replica set) |

## Features

**Shopping**
- Product catalogue with server-side text search (Mongo text index), categories, per-seller shops
- Cart (sessionStorage) + wishlist (localStorage), both crash-safe against corrupt storage
- Recently-viewed strip, low-stock ("Only X left") badges
- Checkout with guest support, coupons, saved addresses, Razorpay or COD
- **Server-side price & stock validation** — atomic stock decrement survives concurrent buyers (test-proven)
- Idempotency keys — double-submitted checkouts can't double-charge
- Order tracking timeline, buyer cancellation, **PDF invoice download**
- Product reviews & ratings (one per user, aggregate recomputed on submit)

**Sellers**
- Dashboard: product CRUD with multi-image upload, order management
- **Analytics tab** — revenue by month, order status distribution, per-seller revenue slice
- Buyer ↔ seller messaging (inbox in dashboard, chat drawer on shop page)
- Broadcasts to followers

**Platform**
- Admin dashboard: users / products / orders / revenue charts, pagination, product approval
- AI shopping assistant chat widget (Gemini-backed, rate-limited)
- Email OTP signup, forgot-password flow, JWT expiry handling
- PWA: installable, offline app shell, cache-busted assets (`?v=N`)
- Glassmorphism design system with dark mode, full animation layer, `prefers-reduced-motion` support
- Crash-proofed: process-level rejection handlers, DB retry/reconnect, graceful shutdown, guarded JSON parsing throughout

## Project structure

```
6-sem-project/
├── index.html, product.html, Collection.html, cart.html,
│   wishlist.html, checkout.html, login.html, profile.html,
│   sell.html, seller.html, seller-dashboard.html, admin.html,
│   about/contact/terms/privacy/shipping-returns.html, 404.html
├── api.js          # API client + auth helpers + imgUrl()
├── script.js       # toast, cart, wishlist, product cards, animations, PWA registration
├── style.css       # token-driven design system (light/dark), glass surfaces, motion layers
├── theme.js        # theme boot + toggle
├── manifest.json, sw.js, favicon.svg, icons/
├── Images/         # static catalogue images + placeholder.svg
└── backend/
    ├── server.js   # boot: env, DB, sweep, listen, crash-proofing
    ├── app.js      # Express app (routes/middleware) — imported by server + tests
    ├── seed.js     # seeds the artisan seller + canonical catalogue
    ├── config/db.js
    ├── middleware/ # auth.js, upload.js, optimizeImage.js (sharp)
    ├── models/     # User, Product, Order, Review, Coupon, Message, ...
    ├── routes/     # auth, products (+reviews), orders (+invoice), admin,
    │               # coupons, newsletter, chat, messages
    ├── tests/      # Jest + Supertest integration suite
    └── utils/      # mailer.js (Resend), reclaimStock.js
```

## Getting started

### 1. Backend

```bash
cd backend
cp .env.example .env        # then fill in real values (see below)
npm install
npm run seed                # inserts the artisan seller + sample products
npm run dev                 # starts the API on http://localhost:5000
```

`.env` keys (see `.env.example`):

| Key | Purpose |
|-----|---------|
| `PORT` | API port (default 5000) |
| `CLIENT_URL` | Allowed CORS origin (your frontend URL, e.g. http://localhost:5500) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random string used to sign tokens |
| `RESEND_API_KEY` | Resend API key for OTP + order emails |
| `GEMINI_API_KEYS` | API key(s) from aistudio.google.com/apikey for the assistant chatbox — comma-separated for round-robin + fallback |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay test-mode credentials |
| `SEED_SECRET` | Secret required to bootstrap the first admin |

### 2. Frontend

The frontend is plain static files. Serve the project root with any static
server — e.g. the VS Code **Live Server** extension (defaults to port 5500).
Make sure the URL matches `CLIENT_URL` in `.env` so CORS allows it.

`api.js` points at `http://localhost:5000`; change `API_ORIGIN` there if your
backend runs elsewhere.

### 3. Create the admin account (once)

`seed-admin` is gated by `SEED_SECRET` so it cannot be called by the public:

```bash
curl -X POST http://localhost:5000/api/admin/seed-admin \
  -H "Content-Type: application/json" \
  -d '{"secret":"<your SEED_SECRET>","email":"admin@craftnext.com","password":"<choose-a-strong-one>"}'
```

### Seeded accounts

`npm run seed` creates the artisan seller (override via `SEED_SELLER_EMAIL` /
`SEED_SELLER_PASSWORD`):

- **Seller:** `archana@craftnext.com` / `artisan123` — change this for anything public.

## Tests

```bash
cd backend
npm test
```

17 integration tests run the real Express app against an **in-memory MongoDB
replica set** (no Atlas, no network; email is mocked). Coverage includes:

- Auth: register → OTP verify → login round-trip, unverified login rejected,
  admin self-registration downgraded, wrong password, duplicate email
- Products: public listing hides inactive/unapproved, text search, auth-gated
  creation, seller create via multipart API
- Orders: server-side totals (client prices ignored), shipping fee threshold,
  over-stock rejection, **concurrent last-unit race (exactly one succeeds)**,
  idempotency key replay, invoice PDF generation

First run downloads a MongoDB binary (~1 min); subsequent runs take ~4 s.

## API reference

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| POST | `/api/auth/register` | public | sends OTP |
| POST | `/api/auth/verify-otp` | public | |
| POST | `/api/auth/login` | public | rate-limited |
| GET  | `/api/auth/me` | token | |
| PUT  | `/api/auth/profile` | token | |
| GET/POST/DELETE | `/api/auth/addresses` | token | saved addresses |
| POST | `/api/auth/avatar` | token | multipart, sharp-optimized |
| GET  | `/api/products` | public | `?category=&search=&seller=` (text index) |
| GET  | `/api/products/:id` | public | |
| POST | `/api/products` | seller/admin | multipart, sharp-optimized |
| PUT/DELETE | `/api/products/:id` | owner/admin | |
| GET/POST | `/api/products/:id/reviews` | public / token | one review per user |
| POST | `/api/orders` | public (guest ok) | price/stock validated server-side |
| GET  | `/api/orders/myorders` | token | |
| GET  | `/api/orders/seller` | token | |
| GET  | `/api/orders/:id` | owner/seller/admin | |
| GET  | `/api/orders/:id/invoice` | owner/seller/admin | streams PDF |
| PUT  | `/api/orders/:id/status` | seller/admin | |
| POST | `/api/orders/:id/verify-payment` | public | Razorpay signature check |
| GET  | `/api/coupons/validate` | public | |
| GET/POST | `/api/messages`, `/api/messages/conversations` | token | buyer↔seller chat |
| GET  | `/api/admin/stats\|users\|orders\|products` | admin | paginated |
| POST | `/api/chat` | public | rate-limited (20/15min), calls Gemini API |

## Security notes

- `.env` is **git-ignored** — never commit real secrets. If a secret was ever
  committed (it was, in early history), **rotate it**: MongoDB password and
  `JWT_SECRET`. Removing the file does not undo a past leak; scrub history
  with `git filter-repo` if the repo is shared/public.
- Order totals, item prices, names and sellers are always rebuilt from the DB —
  the client cannot set its own price.
- Uploads accept images only (≤ 5 MB), recompressed server-side; `/uploads` is
  served statically with helmet's cross-origin resource policy.
- Rate limits on auth (20/15min), writes (60/15min) and chat (20/15min).

## Known limitations

- Razorpay runs in test mode; no real money moves.
- No product pagination (the catalogue is intentionally small).
- Cart lives in `sessionStorage` and wishlist in `localStorage`, not synced to the account.
- Service worker caches the app shell only; API responses are never cached.
