/* eslint-disable no-console */
/**
 * End-to-end smoke test for the API.
 *
 *   npm run smoke
 *
 * Boots an in-memory MongoDB, runs the real Express app on an ephemeral port,
 * and walks every feature including the failure paths.
 *
 * Set MONGODB_URI beforehand to run against a real database instead.
 */

// Must be set before src/config/env.js is loaded.
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "smoke-test-access-secret-0123456789abcdef";
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || "4";

const providedUri = process.env.MONGODB_URI;

const SUITES = [["Phase 1 — Auth", require("./suites/auth")]];

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ❌ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const section = (name) => console.log(`\n▶ ${name}`);

async function main() {
  let memoryServer;

  if (!providedUri) {
    const { MongoMemoryServer } = require("mongodb-memory-server");
    console.log("Starting in-memory MongoDB (first run downloads a binary)...");
    memoryServer = await MongoMemoryServer.create();
    process.env.MONGODB_URI = memoryServer.getUri("finflow_smoke");
  } else {
    console.log("Using provided MONGODB_URI");
  }

  const app = require("../src/app");
  const { connectDB, disconnectDB } = require("../src/config/db");
  const User = require("../src/models/user.model");

  await connectDB();

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { body, token } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
  };

  const ctx = { call, check, section, base, state: {} };

  try {
    for (const [title, suite] of SUITES) {
      console.log(`\n${"═".repeat(64)}\n${title}\n${"═".repeat(64)}`);
      await suite(ctx);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /@smoke\.test$/ });
    await disconnectDB();
    if (memoryServer) await memoryServer.stop();
  }

  console.log(`\n${"═".repeat(64)}`);
  if (failures.length === 0) {
    console.log(`✅ ${passed} passed, 0 failed`);
  } else {
    console.log(`❌ ${passed} passed, ${failures.length} failed:`);
    for (const failure of failures) console.log(`   • ${failure}`);
  }
  console.log("");

  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n💥 Smoke run crashed:", err);
  process.exit(1);
});
