const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set — add it to your .env (see .env.example)");
  }
  await mongoose.connect(uri);
  console.log(`[db] connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

module.exports = connectDB;
