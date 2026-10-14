const Admin = require("../models/Admin");

// Runs on every server start and makes sure the login in ADMIN_EMAIL /
// ADMIN_PASSWORD (.env locally, the Environment tab on Render) actually
// works: creates that admin if it doesn't exist yet, or resets its password
// if ADMIN_PASSWORD was changed since. So changing either value and
// restarting/redeploying is all it takes to change the admin login. Any
// other admin accounts already in the database are left untouched.
async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    if ((await Admin.countDocuments()) === 0) {
      console.warn(
        "[seed] No admin account exists yet, and ADMIN_EMAIL/ADMIN_PASSWORD are not set — " +
          "set them in .env and restart the server to create the first admin login."
      );
    }
    return;
  }

  const existing = await Admin.findOne({ email });
  if (existing && (await existing.comparePassword(password))) return;

  const passwordHash = await Admin.hashPassword(password);
  if (existing) {
    existing.passwordHash = passwordHash;
    await existing.save();
    console.log(`[seed] Updated admin password for ${email} to match ADMIN_PASSWORD`);
  } else {
    await Admin.create({ email, passwordHash });
    console.log(`[seed] Created admin account: ${email}`);
  }
}

module.exports = seedAdmin;
