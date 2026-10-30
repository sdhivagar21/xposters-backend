const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set — add it to your .env (see .env.example)");
  }
  // Small pool + a clear timeout: on Vercel many short-lived instances may
  // connect at once, and a wrong URI / blocked IP should fail fast.
  await mongoose.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 15000 });
  console.log(`[db] connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

module.exports = connectDB;
