const env = require("../config/env");
const { PRICE_PROVIDERS } = require("../constants");
const Holding = require("../models/holding.model");
const priceService = require("../services/price");
const { withLock } = require("../utils/jobLock");

/**
 * Periodically refreshes prices for holdings backed by a vendor.
 *
 * Runs in the background rather than on request so a page load never waits on
 * a third party, and so the number of vendor calls depends on the clock rather
 * than on how often someone opens the dashboard.
 *
 * Safe to run on more than one instance. Each tick takes a lease in MongoDB
 * and only the winner does the work; the others skip. Without that, every
 * instance refreshes every symbol on its own timer and the vendor sees N times
 * the traffic, so a free tier's rate limit arrives N times sooner.
 *
 * The lease is a lease and not a mutex — it expires — so an instance that dies
 * mid-run cannot wedge the job. The guarantee is "almost always one runner",
 * which is the right level for refreshing a cache of prices.
 */
const LOCK_NAME = "price-sync";

let timer = null;
let running = false;

async function runOnce({ skipLock = false } = {}) {
  // In-process guard first: it is free, and a slow vendor must not stack runs
  // on this instance even before the cross-instance lease is considered.
  if (running) {
    console.warn("Price sync still running; skipping this tick");
    return null;
  }

  running = true;

  try {
    if (skipLock) return await refresh();

    // The lease outlives the interval, so a run that overshoots its slot is
    // not immediately trampled by the next tick on another instance.
    const ttlMs = Math.max(env.prices.syncIntervalMinutes * 60 * 1000 * 2, 60000);
    const outcome = await withLock(LOCK_NAME, ttlMs, () => refresh());

    if (outcome.skipped) {
      console.log("💤 Price sync held by another instance; skipping");
      return null;
    }
    return outcome.result;
  } catch (err) {
    console.error("Price sync failed:", err.message);
    return null;
  } finally {
    running = false;
  }
}

/**
 * The work itself. Throws on failure so the lease records why; runOnce is what
 * keeps a bad vendor from taking the process down.
 */
async function refresh() {
  const startedAt = Date.now();

  {
    // Distinct instruments, not distinct holdings — ten users holding bitcoin
    // is one lookup, and the cache serves all of them.
    const holdings = await Holding.aggregate([
      {
        $match: {
          isArchived: false,
          priceProvider: { $ne: PRICE_PROVIDERS.MANUAL },
          providerSymbol: { $nin: ["", null] },
        },
      },
      {
        $group: {
          _id: { priceProvider: "$priceProvider", providerSymbol: "$providerSymbol", currency: "$currency" },
          holding: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$holding" } },
    ]);

    if (holdings.length === 0) return { considered: 0, refreshed: 0, failed: 0 };

    const result = await priceService.refreshAll(holdings);
    console.log(
      `💹 Price sync: ${result.refreshed}/${result.considered} refreshed ` +
        `(${result.failed} failed) in ${Date.now() - startedAt}ms`
    );
    return result;
  }
}

function start() {
  if (!env.prices.syncEnabled) {
    console.log("💤 Price sync disabled (set PRICE_SYNC_ENABLED=true to enable)");
    return null;
  }

  const intervalMs = env.prices.syncIntervalMinutes * 60 * 1000;

  timer = setInterval(runOnce, intervalMs);
  // Do not hold the event loop open; shutdown should not wait for a tick.
  timer.unref();

  console.log(`💹 Price sync every ${env.prices.syncIntervalMinutes} min`);

  // Prime the cache shortly after boot rather than immediately, so startup is
  // not competing with a vendor call.
  setTimeout(runOnce, 5000).unref();

  return timer;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, runOnce };
