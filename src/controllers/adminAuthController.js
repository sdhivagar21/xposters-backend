const Admin = require("../models/Admin");
const { signAdminToken } = require("../utils/jwt");

// POST /api/admin/login
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
  if (!admin || !(await admin.comparePassword(password))) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const token = signAdminToken(admin);
  res.json({ token, admin: { id: admin._id.toString(), email: admin.email } });
}

// GET /api/admin/me — lets the frontend verify a stored token is still valid
async function me(req, res) {
  res.json({ admin: { id: req.admin._id.toString(), email: req.admin.email } });
}

module.exports = { login, me };
