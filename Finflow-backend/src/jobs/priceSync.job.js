const env = require("../config/env");
const { PRICE_PROVIDERS } = require("../constants");
const Holding = require("../models/holding.model");
const priceService = require("../services/price");

/**
 * Periodically refreshes prices for holdings backed by a vendor.
 *
 * Runs in the background rather than on request so a page load never waits on
 * a third party, and so the number of vendor calls depends on the clock rather
 * than on how often someone opens the dashboard.
 *
 * Deliberately unsophisticated: a single interval in-process. It is the right
 * size for one server. If FinFlow ever runs more than one instance this needs
 * a real queue with a lock, otherwise every instance refreshes every symbol
 * and the rate limit arrives that much sooner.
 */
let timer = null;
let running = false;

async function runOnce() {
  // Overlap protection: a slow vendor must not stack runs on top of each other.
  if (running) {
    console.warn("Price sync still running; skipping this tick");
    return null;
  }

  running = true;
  const startedAt = Date.now();

  try {
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
  } catch (err) {
    // A failed sync must never take the process down; the cache simply goes
    // stale and the API reports it as such.
    console.error("Price sync failed:", err.message);
    return null;
  } finally {
    running = false;
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
