// Loads .env once and exposes a validated, typed config object.
// Every other module reads config from here instead of touching process.env,
// so a missing variable fails loudly at boot rather than as `undefined` at runtime.
require("dotenv").config({ quiet: true });

const REQUIRED = ["MONGODB_URI", "JWT_ACCESS_SECRET"];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`\n❌ Missing required environment variable(s): ${missing.join(", ")}`);
  console.error("   Copy .env.example to .env and fill in the values.\n");
  process.exit(1);
}

const nodeEnv = process.env.NODE_ENV || "development";

if (nodeEnv === "production" && process.env.JWT_ACCESS_SECRET.length < 32) {
  console.error("\n❌ JWT_ACCESS_SECRET must be at least 32 characters in production.\n");
  process.exit(1);
}

const refreshTtlDays = Number(process.env.JWT_REFRESH_TTL_DAYS) || 7;

module.exports = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  isTest: nodeEnv === "test",
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI,
  clientOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL || "15m",
    refreshTtlDays,
    refreshTtlMs: refreshTtlDays * 24 * 60 * 60 * 1000,
    issuer: "finflow",
  },
  prices: {
    // How long a cached quote is served before a vendor is asked again. Free
    // price APIs rate-limit hard, so this is the main defence against a busy
    // dashboard exhausting the quota.
    cacheTtlMinutes: Number(process.env.PRICE_CACHE_TTL_MINUTES) || 15,
    // Background refresh. Off by default and always off under test: a suite
    // that reaches the network is a suite that fails on a train.
    syncEnabled: process.env.PRICE_SYNC_ENABLED === "true" && nodeEnv !== "test",
    syncIntervalMinutes: Number(process.env.PRICE_SYNC_INTERVAL_MINUTES) || 15,
    coingeckoBaseUrl: process.env.COINGECKO_BASE_URL || "https://api.coingecko.com/api/v3",
  },
};
