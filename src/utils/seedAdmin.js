const Admin = require("../models/Admin");

// Runs on every server start. If no admin exists yet, creates one from
// ADMIN_EMAIL / ADMIN_PASSWORD in .env — so the first deploy has a working
// login without needing to touch the database by hand. Safe to run every
// boot: it's a no-op once an admin already exists.
async function seedAdmin() {
  const existing = await Admin.countDocuments();
  if (existing > 0) return;

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn(
      "[seed] No admin account exists yet, and ADMIN_EMAIL/ADMIN_PASSWORD are not set — " +
        "set them in .env and restart the server to create the first admin login."
    );
    return;
  }

  const passwordHash = await Admin.hashPassword(password);
  await Admin.create({ email: email.toLowerCase().trim(), passwordHash });
  console.log(`[seed] Created initial admin account: ${email}`);
}

module.exports = seedAdmin;
