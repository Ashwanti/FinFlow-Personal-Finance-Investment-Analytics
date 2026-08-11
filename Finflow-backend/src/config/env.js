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
  // Index builds are idempotent and cheap at this size, and a *missing* unique
  // index is silent data corruption — two accounts on one email, discovered
  // much later. So this defaults on everywhere. Set MONGO_AUTO_INDEX=false and
  // manage indexes with a migration once the collections are large enough that
  // a build is not free.
  mongoAutoIndex: process.env.MONGO_AUTO_INDEX !== "false",
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
  fx: {
    // Live rate feed. "manual" means rates are only ever what the user enters.
    provider: process.env.FX_PROVIDER || "manual",
    // Beyond this, a stored rate is reported as stale. Two days covers a
    // weekend, since the ECB does not publish on one.
    maxAgeHours: Number(process.env.FX_RATE_MAX_AGE_HOURS) || 48,
    syncEnabled: process.env.FX_SYNC_ENABLED === "true" && nodeEnv !== "test",
    // Reference rates update once a day, so polling faster only wastes calls.
    syncIntervalMinutes: Number(process.env.FX_SYNC_INTERVAL_MINUTES) || 720,
    frankfurterBaseUrl: process.env.FRANKFURTER_BASE_URL || "https://api.frankfurter.app",
  },
};
