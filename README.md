# XPOSTERS — Backend

Express + MongoDB API for XPOSTERS: products, checkout orders, and admin
login/product-management, with images stored on Cloudinary.

## Setup

1. **MongoDB Atlas** (free tier is enough): create an account at
   [mongodb.com/atlas](https://www.mongodb.com/atlas), create a free (M0)
   cluster, then Database → Connect → Drivers, and copy the connection
   string. Add your database user's password into it, and a database name
   (e.g. `xposters`) right before the `?`.

2. **Cloudinary** (free tier): sign up at [cloudinary.com](https://cloudinary.com),
   grab your Cloud Name, API Key, and API Secret from the dashboard.

3. Copy `.env.example` to `.env` and fill in the values from steps 1–2, plus:
   - `JWT_SECRET` — any long random string (a command to generate one is in
     the example file)
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your first admin login. The server
     creates this account automatically on first boot, only if no admin
     exists yet.
   - `CLIENT_URL` — your deployed frontend's URL (for CORS). Leave the
     default for local development.

4. Install and run:
   ```bash
   npm install
   npm run dev
   ```
   The API starts on `http://localhost:4000` (or whatever `PORT` you set).

## API overview

**Public**
- `GET /api/products?category=&sort=&q=` — list products, with optional
  category filter, sort (`price-asc` / `price-desc` / default newest), and
  search (matches product name or category name)
- `GET /api/products/featured` — admin-marked featured products (homepage wall)
- `GET /api/products/:id` — single product
- `GET /api/products/:id/related?limit=6` — other products in the same category
- `POST /api/products/:id/reviews` — add a review `{ name, rating, comment }`
- `POST /api/orders` — place an order `{ customer: { name, email, phone, address }, items, subtotal }`

**Admin** (all except `/login` require `Authorization: Bearer <token>`)
- `POST /api/admin/login` — `{ email, password }` → `{ token }`
- `GET /api/admin/me` — verify a stored token is still valid
- `GET /api/admin/products` — full product list
- `POST /api/admin/products` — create a product (multipart form: `image` file + `name`, `price`, `category`, `description`, `featured`)
- `PUT /api/admin/products/:id` — update a product (same fields; `image` optional — only send it to replace the photo)
- `DELETE /api/admin/products/:id` — delete a product (also removes its Cloudinary image)
- `GET /api/admin/orders` — all orders, newest first

## Deploying to Render

1. Push this `xposters-backend` folder to its own GitHub repo (separate from the frontend).
2. On [render.com](https://render.com), New → Web Service → connect the repo.
3. Build Command: `npm install`. Start Command: `npm start`.
4. Add all the variables from `.env.example` under the service's Environment tab — same values as your local `.env`, except set `CLIENT_URL` to your actual deployed Vercel URL.
5. Deploy. Render gives you a URL like `https://xposters-backend.onrender.com` — that's what the frontend's `VITE_API_BASE_URL` should point to.

Note: Render's free tier spins down after inactivity, so the first request
after a quiet period can take 30–60 seconds to wake back up — that's normal,
not a bug.
