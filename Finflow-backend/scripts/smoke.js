/* eslint-disable no-console */
/**
 * End-to-end smoke test for the whole API.
 *
 *   npm run smoke
 *
 * Boots an in-memory MongoDB **replica set** — transactions need one, and
 * transfers need transactions — then runs the real Express app on an ephemeral
 * port and walks every feature including the failure paths.
 *
 * Set MONGODB_URI beforehand to run against a real database instead.
 */

// Must be set before src/config/env.js is loaded.
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "smoke-test-access-secret-0123456789abcdef";
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || "4";

const providedUri = process.env.MONGODB_URI;

const SUITES = [
  ["Phase 1 — Auth", require("./suites/auth")],
  ["Phase 2 — Accounts, Categories, Transactions, Transfers", require("./suites/ledger")],
  ["Phase 3 — Analytics", require("./suites/analytics")],
  ["Phase 4 — Budgets", require("./suites/budgets")],
  ["Phase 5 — Investments", require("./suites/investments")],
];

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
    const { MongoMemoryReplSet } = require("mongodb-memory-server");
    console.log("Starting in-memory MongoDB replica set (first run downloads a binary)...");
    memoryServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
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

      // The ledger and analytics suites share one clean account so their
      // balances stay exact and hand-checkable.
      if (!ctx.token) {
        const owner = await call("POST", "/api/auth/register", {
          body: {
            name: "Ledger Owner",
            email: `ledger+${Date.now()}@smoke.test`,
            password: "Passw0rd123",
          },
        });
        if (owner.status === 201) ctx.token = owner.json.data.accessToken;
      }

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
