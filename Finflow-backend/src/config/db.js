const mongoose = require("mongoose");

const env = require("./env");

async function connectDB() {
  // Reject writes to fields that aren't in the schema, and don't let Mongoose
  // silently drop unknown query filters.
  mongoose.set("strictQuery", true);

  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB connection error:", err.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("⚠️  MongoDB disconnected");
  });

  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: !env.isProduction, // build indexes in dev; use a migration in prod
  });

  const { host, name } = mongoose.connection;
  console.log(`✅ MongoDB connected: ${host}/${name}`);

  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
