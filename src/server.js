// Some hosts' networks (seen on Render) resolve outbound hosts to an IPv6
// address they can't actually route to (seen with Gmail's SMTP server: ENETUNREACH / Connection
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
app.set("trust proxy", 1); // the host sits behind a proxy - needed so req.ip is the real visitor

// The shop's own addresses (both xposter.in and www), anything in CLIENT_URL
// (comma-separated is fine), and localhost so `npm run dev` on the frontend
// keeps working against this backend during development.
const allowedOrigins = new Set(
  [
    ...String(process.env.CLIENT_URL || "").split(","),
    "https://xposter.in",
    "https://www.xposter.in",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
  ]
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean)
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} is not allowed`));
    },
    // Lets the admin "Print files" tool read the size/quality details that
    // come back alongside the image.
    exposedHeaders: ["X-Print-Info"],
  })
);
// Gzip/brotli-compresses every JSON response before it goes out - product
// list/section responses are mostly repetitive text (URLs, field names),
// which compresses very well. Cuts response size a lot for free.
app.use(compression());
app.use(express.json());

app.get("/", (req, res) => res.json({ status: "ok", service: "xposters-backend" }));
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// Database connection + admin login sync, started once per server instance.
// Requests wait for it (on Vercel the app runs as a function that can start
// cold at any request); if it fails, the next request tries again instead of
// the whole server exiting.
let ready = null;
function whenReady() {
  if (!ready) {
    ready = connectDB()
      .then(seedAdmin)
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}
app.use(async (req, res, next) => {
  try {
    await whenReady();
    next();
  } catch (err) {
    console.error("[server] database not ready:", err.message);
    res.status(503).json({ message: "The shop is starting up - please try again in a moment." });
  }
});

app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

// On Vercel the exported app is the request handler; anywhere else (Render,
// local `npm run dev`) it listens on PORT as usual.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 4000;
  whenReady().catch((err) => console.error("[server] database not ready yet:", err.message));
  app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
}

module.exports = app;
