const env = require("../../config/env");
const { PRICE_PROVIDERS } = require("../../constants");
const PriceQuote = require("../../models/priceQuote.model");
const coingecko = require("./coingecko.provider");
const manual = require("./manual.provider");

/**
 * Price lookup: cache first, vendor second, stale-but-labelled third.
 *
 * Nothing here ever throws because a price is missing. A portfolio with one
 * unpriceable holding must still render — it reports that position as unpriced
 * rather than failing the whole request.
 */
const PROVIDERS = {
  [PRICE_PROVIDERS.MANUAL]: manual,
  [PRICE_PROVIDERS.COINGECKO]: coingecko,
};

const getProvider = (name) => PROVIDERS[name] ?? manual;

const cacheKey = (holding) => ({
  provider: holding.priceProvider,
  providerSymbol: (holding.providerSymbol || holding.symbol).toLowerCase(),
  currency: holding.currency,
});

const isFresh = (quote, ttlMs) => quote && Date.now() - quote.asOf.getTime() < ttlMs;

async function readCache(holding) {
  return PriceQuote.findOne(cacheKey(holding));
}

async function writeCache(holding, quote) {
  const key = cacheKey(holding);
  return PriceQuote.findOneAndUpdate(
    key,
    {
      ...key,
      priceMinor: quote.priceMinor,
      asOf: quote.asOf,
      lastError: null,
      lastErrorAt: null,
    },
    { upsert: true, returnDocument: "after" }
  );
}

async function recordFailure(holding, message) {
  const key = cacheKey(holding);
  await PriceQuote.updateOne(
    key,
    { $set: { lastError: message, lastErrorAt: new Date() } },
    { upsert: false }
  );
}

/**
 * Current price for one holding.
 *
 * @returns {{priceMinor:number|null, currency:string, asOf:Date|null,
 *   source:string, stale:boolean, error:string|null}}
 */
async function getQuote(holding, { force = false } = {}) {
  const provider = getProvider(holding.priceProvider);
  const ttlMs = env.prices.cacheTtlMinutes * 60 * 1000;

  // Manual prices live on the holding itself; caching them would just add a
  // way for the user's own edit to appear not to have taken effect.
  if (!provider.requiresNetwork) {
    const quote = await provider.fetchQuote(holding);
    return quote
      ? { ...quote, source: provider.name, stale: false, error: null }
      : unpriced(holding, "No manual price set for this holding");
  }

  const cached = await readCache(holding);
  if (!force && isFresh(cached, ttlMs)) {
    return {
      priceMinor: cached.priceMinor,
      currency: cached.currency,
      asOf: cached.asOf,
      source: provider.name,
      stale: false,
      error: null,
    };
  }

  try {
    const quote = await provider.fetchQuote(holding);
    if (quote) {
      await writeCache(holding, quote);
      return { ...quote, source: provider.name, stale: false, error: null };
    }
    await recordFailure(holding, "Provider returned no price");
  } catch (err) {
    await recordFailure(holding, err.message);
    console.warn(`Price lookup failed for ${holding.symbol}: ${err.message}`);
  }

  // Vendor unavailable: a price from an hour ago, clearly labelled stale, is
  // far more useful than refusing to value the position.
  if (cached) {
    return {
      priceMinor: cached.priceMinor,
      currency: cached.currency,
      asOf: cached.asOf,
      source: provider.name,
      stale: true,
      error: cached.lastError,
    };
  }

  // Last resort: the manual price, if the user set one before switching
  // this holding to a vendor.
  if (holding.manualPriceMinor !== null && holding.manualPriceMinor !== undefined) {
    return {
      priceMinor: holding.manualPriceMinor,
      currency: holding.currency,
      asOf: holding.updatedAt ?? null,
      source: PRICE_PROVIDERS.MANUAL,
      stale: true,
      error: "Live price unavailable; showing the manual price",
    };
  }

  return unpriced(holding, "No price available from the provider or manually");
}

const unpriced = (holding, error) => ({
  priceMinor: null,
  currency: holding.currency,
  asOf: null,
  source: holding.priceProvider,
  stale: true,
  error,
});

/** Quotes for many holdings, batched per provider. */
async function getQuotes(holdings, options = {}) {
  const results = new Map();

  await Promise.all(
    holdings.map(async (holding) => {
      results.set(String(holding._id), await getQuote(holding, options));
    })
  );

  return results;
}

/**
 * Refresh every network-backed holding. Called by the sync job, and by
 * POST /api/investments/prices/refresh.
 */
async function refreshAll(holdings) {
  const networkHoldings = holdings.filter((h) => getProvider(h.priceProvider).requiresNetwork);

  let refreshed = 0;
  let failed = 0;

  for (const holding of networkHoldings) {
    const quote = await getQuote(holding, { force: true });
    if (quote.priceMinor !== null && !quote.stale) refreshed += 1;
    else failed += 1;
  }

  return { considered: networkHoldings.length, refreshed, failed };
}

module.exports = { getQuote, getQuotes, refreshAll, getProvider, PROVIDERS };
