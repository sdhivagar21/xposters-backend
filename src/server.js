// Render's network can resolve outbound hosts to an IPv6 address it can't
// actually route to (seen with Gmail's SMTP server: ENETUNREACH / Connection
// timeout). Forcing IPv4 first for all DNS lookups avoids that - this has to
// run before anything else opens a network connection.
require("dns").setDefaultResultOrder("ipv4first");

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const compression = require("compression");

const connectDB = require("./config/db");
const seedAdmin = require("./utils/seedAdmin");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const productRoutes = require("./routes/productRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();

// CLIENT_URL is the deployed Vercel frontend origin. Also always allow
// localhost so `npm run dev` on the frontend keeps working against this
// backend during development.
const allowedOrigins = [process.env.CLIENT_URL, "http://localhost:5173", "http://127.0.0.1:5173"].filter(
  Boolean
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} is not allowed`));
    },
  })
);
// Gzip/brotli-compresses every JSON response before it goes out - product
// list/section responses are mostly repetitive text (URLs, field names),
// which compresses very well. Cuts response size a lot for free.
app.use(compression());
app.use(express.json());

app.get("/", (req, res) => res.json({ status: "ok", service: "xposters-backend" }));
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;

async function start() {
  await connectDB();
  await seedAdmin();
  app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
}

start().catch((err) => {
  console.error("[server] failed to start:", err.message);
  process.exit(1);
});

module.exports = app;