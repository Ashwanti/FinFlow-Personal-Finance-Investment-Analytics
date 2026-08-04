const env = require("../../config/env");
const Account = require("../../models/account.model");
const { RATE_SCALE } = require("../../models/exchangeRate.model");
const Holding = require("../../models/holding.model");
const User = require("../../models/user.model");
const fxService = require("../fx.service");
const frankfurter = require("./frankfurter.provider");

/**
 * Refreshing exchange rates from a feed.
 *
 * Manual entry stays the default and the fallback: a rate you typed is better
 * than no rate, and for a currency the feed does not cover it is the only
 * option. A feed removes the failure mode where a rate entered once quietly
 * misstates every converted total months later.
 */
const PROVIDERS = { frankfurter };

const getProvider = (name) => PROVIDERS[name] ?? null;

/** Which currencies a user actually holds anything in. */
async function currenciesInUse(userId, baseCurrency) {
  const [accountCurrencies, holdingCurrencies] = await Promise.all([
    Account.distinct("currency", { user: userId, isArchived: false }),
    Holding.distinct("currency", { user: userId, isArchived: false }),
  ]);

  return [...new Set([...accountCurrencies, ...holdingCurrencies])].filter(
    (code) => code && code !== baseCurrency
  );
}

/**
 * Fetch and store rates from `base` to every currency the user holds.
 *
 * Only the pairs that are actually needed: a personal portfolio touches a
 * handful of currencies, and pulling the feed's full matrix would store
 * hundreds of rows nothing reads.
 */
async function refreshForUser(user, { provider = env.fx.provider } = {}) {
  const adapter = getProvider(provider);
  if (!adapter) {
    return { provider, updated: 0, skipped: true, reason: "No live FX provider configured" };
  }

  const quotes = await currenciesInUse(user._id, user.baseCurrency);
  if (quotes.length === 0) {
    return { provider: adapter.name, updated: 0, pairs: 0 };
  }

  try {
    const rates = await adapter.fetchRates(user.baseCurrency, quotes);

    for (const rate of rates) {
      await fxService.upsert(user._id, {
        base: rate.base,
        quote: rate.quote,
        rateScaled: Math.round(rate.rate * RATE_SCALE),
        asOf: rate.asOf,
        source: adapter.name,
      });
    }

    return { provider: adapter.name, updated: rates.length, pairs: quotes.length };
  } catch (err) {
    // A feed outage must never break a request or a run. The stored rates stay
    // put and are reported as stale by their age.
    console.warn(`FX refresh failed for ${user.email}: ${err.message}`);
    return { provider: adapter.name, updated: 0, pairs: quotes.length, error: err.message };
  }
}

/** Every user with a currency other than their base. Used by the sync job. */
async function refreshAll() {
  const users = await User.find().select("_id email baseCurrency");

  let updated = 0;
  let considered = 0;

  for (const user of users) {
    const result = await refreshForUser(user);
    if (result.pairs) considered += 1;
    updated += result.updated;
  }

  return { users: considered, updated };
}

module.exports = { PROVIDERS, getProvider, currenciesInUse, refreshForUser, refreshAll };
