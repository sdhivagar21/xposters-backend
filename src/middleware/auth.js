const { verifyToken } = require("../utils/jwt");
const Admin = require("../models/Admin");

async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: "Not authorized — missing token" });
    }

    const payload = verifyToken(token);
    const admin = await Admin.findById(payload.sub).select("_id email");
    if (!admin) {
      return res.status(401).json({ message: "Not authorized — admin no longer exists" });
    }

    req.admin = admin;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Not authorized — invalid or expired token" });
  }
}

module.exports = { requireAdmin };
