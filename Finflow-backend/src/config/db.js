const mongoose = require("mongoose");

const env = require("./env");

// Reused across calls. A long-running server connects once at boot, but a
// serverless invocation re-enters this module on every warm request, and
// dialling MongoDB each time would exhaust the connection pool long before it
// exhausted anyone's patience. Holding the in-flight promise also means N
// concurrent requests on a cold instance share one handshake instead of racing.
let connecting = null;
let listenersBound = false;

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;

  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB connection error:", err.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("⚠️  MongoDB disconnected");
  });
}

async function connectDB() {
  // Already up: nothing to do.
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connecting) return connecting;

  // Reject writes to fields that aren't in the schema, and don't let Mongoose
  // silently drop unknown query filters.
  mongoose.set("strictQuery", true);
  bindListeners();

  connecting = mongoose
    .connect(env.mongoUri, {
      serverSelectionTimeoutMS: 10000,
      autoIndex: env.mongoAutoIndex,
    })
    .then((result) => {
      const { host, name } = mongoose.connection;
      console.log(`✅ MongoDB connected: ${host}/${name}`);
      return result;
    })
    .catch((err) => {
      // Clear the cache so the next request retries rather than replaying a
      // rejected promise for the lifetime of the instance.
      connecting = null;
      throw err;
    });

  return connecting;
}

async function disconnectDB() {
  connecting = null;
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
