const env = require("./config/env");

const app = require("./app");
const { connectDB, disconnectDB } = require("./config/db");
const priceSync = require("./jobs/priceSync.job");

let server;

async function start() {
  // Connect before listening, so the process never accepts a request it
  // cannot serve.
  await connectDB();

  server = app.listen(env.port, () => {
    console.log(`🚀 Server running on http://localhost:${env.port} [${env.nodeEnv}]`);
  });

  // Started after the server is up: a vendor being slow should delay prices,
  // not the port opening.
  priceSync.start();
}

async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error("Shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 10000).unref();

  try {
    priceSync.stop();

    if (server) {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
      console.log("HTTP server closed");
    }
    await disconnectDB();
    console.log("MongoDB connection closed");
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("💥 Unhandled promise rejection:", reason);
  shutdown("unhandledRejection");
});

start().catch((err) => {
  console.error("❌ Failed to start server:", err.message);
  process.exit(1);
});
