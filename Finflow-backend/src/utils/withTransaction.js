const mongoose = require("mongoose");

/**
 * Runs `fn` inside a MongoDB transaction when the deployment supports one.
 *
 * A transfer writes two transaction rows and adjusts two account balances. If
 * that work is interrupted halfway, money vanishes or is duplicated — so it has
 * to be atomic.
 *
 * Multi-document transactions require a replica set or Atlas. A standalone
 * local `mongod` rejects them, which is a very common dev setup, so the first
 * rejection flips this module into a degraded mode that still runs the work,
 * just without atomicity. The warning is printed once so the trade-off is
 * visible rather than silent.
 */
let transactionsSupported = null;

const UNSUPPORTED_PATTERNS = [
  /transaction numbers are only allowed on a replica set/i,
  /transactions are not supported/i,
  /illegal operation/i,
  /replica set/i,
];

const isUnsupported = (err) =>
  err?.code === 20 || UNSUPPORTED_PATTERNS.some((re) => re.test(err?.message || ""));

function warnOnce() {
  console.warn(
    "⚠️  MongoDB transactions unavailable (standalone server). Multi-step writes " +
      "will run non-atomically. Use a replica set or Atlas in production."
  );
}

async function withTransaction(fn) {
  if (transactionsSupported === false) {
    return fn(null);
  }

  const session = await mongoose.startSession();

  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    transactionsSupported = true;
    return result;
  } catch (err) {
    if (transactionsSupported === null && isUnsupported(err)) {
      transactionsSupported = false;
      warnOnce();
      return fn(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

module.exports = { withTransaction };
