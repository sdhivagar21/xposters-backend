// XPOSTERS - reset the admin login password.
//
// Fixes "Invalid email or password" when your database still has an older
// admin login than what's currently set in Render (your database only ever
// creates the admin account once, on the very first server start - changing
// ADMIN_EMAIL/ADMIN_PASSWORD in Render later does NOT update it).
//
// Run this from inside your xposters-backend folder, with your real .env
// in place (same .env your server uses - specifically MONGODB_URI must
// point at the SAME database your live Render backend uses):
//
//   node scripts/reset-admin-password.js <email> <password>
//
// Example:
//   node scripts/reset-admin-password.js adminxposters@gmail.com 123456
//
// Use the exact email/password shown in Render's Environment tab. This
// creates the admin account if it doesn't exist, or resets its password if
// it does - either way, after this you can log in with what you typed.

require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set. Run this from inside xposters-backend with your real .env in place.");
    process.exit(1);
  }

  const [, , emailArg, passwordArg] = process.argv;
  const email = (emailArg || process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = passwordArg || process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Usage: node scripts/reset-admin-password.js <email> <password>");
    console.error("(or set ADMIN_EMAIL / ADMIN_PASSWORD in your .env and run with no arguments)");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  const Admin = require("../src/models/Admin");

  const passwordHash = await Admin.hashPassword(password);
  await Admin.findOneAndUpdate({ email }, { email, passwordHash }, { upsert: true });

  console.log("\nAdmin login reset. You can now log in with:");
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
