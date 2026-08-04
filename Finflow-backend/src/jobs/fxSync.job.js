const env = require("../config/env");
const fxProviders = require("../services/fx");
const { withLock } = require("../utils/jobLock");

/**
 * Keeps stored exchange rates current.
 *
 * The failure this exists to prevent is silent: a rate entered once keeps
 * converting every total months later, and nothing about the output says it is
 * out of date. A feed plus the staleness flag on each rate turns that into
 * something visible.
 *
 * Twice a day by default. ECB reference rates publish once daily, so polling
 * harder spends calls without learning anything.
 */
const LOCK_NAME = "fx-sync";

let timer = null;
let running = false;

async function runOnce({ skipLock = false } = {}) {
  if (running) {
    console.warn("FX sync still running; skipping this tick");
    return null;
  }

  running = true;

  try {
    if (skipLock) return await fxProviders.refreshAll();

    const ttlMs = Math.max(env.fx.syncIntervalMinutes * 60 * 1000 * 2, 60000);
    const outcome = await withLock(LOCK_NAME, ttlMs, () => fxProviders.refreshAll());

    if (outcome.skipped) {
      console.log("💤 FX sync held by another instance; skipping");
      return null;
    }

    const result = outcome.result;
    if (result?.updated) {
      console.log(`💱 FX sync: ${result.updated} rate(s) across ${result.users} user(s)`);
    }
    return result;
  } catch (err) {
    console.error("FX sync failed:", err.message);
    return null;
  } finally {
    running = false;
  }
}

function start() {
  if (!env.fx.syncEnabled) return null;

  if (!fxProviders.getProvider(env.fx.provider)) {
    console.log(`💤 FX sync enabled but FX_PROVIDER="${env.fx.provider}" has no adapter`);
    return null;
  }

  timer = setInterval(runOnce, env.fx.syncIntervalMinutes * 60 * 1000);
  timer.unref();

  console.log(`💱 FX sync every ${env.fx.syncIntervalMinutes} min via ${env.fx.provider}`);
  setTimeout(runOnce, 8000).unref();

  return timer;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, runOnce };
