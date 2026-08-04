const env = require("../../config/env");
const { PRICE_PROVIDERS } = require("../../constants");
const PriceQuote = require("../../models/priceQuote.model");
const PriceSnapshot = require("../../models/priceSnapshot.model");
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

const startOfUtcDay = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Records a price for historical use. Called whenever a price is established,
 * from a vendor or by hand — a trend can only ever show what was written down
 * at the time.
 */
async function recordSnapshot(holding, quote) {
  const key = cacheKey(holding);

  await PriceSnapshot.updateOne(
    { ...key, date: startOfUtcDay(quote.asOf ?? new Date()) },
    { $set: { priceMinor: quote.priceMinor } },
    { upsert: true }
  );
}

async function writeCache(holding, quote) {
  const key = cacheKey(holding);

  const [saved] = await Promise.all([
    PriceQuote.findOneAndUpdate(
      key,
      {
        ...key,
        priceMinor: quote.priceMinor,
        asOf: quote.asOf,
        lastError: null,
        lastErrorAt: null,
      },
      { upsert: true, returnDocument: "after" }
    ),
    recordSnapshot(holding, quote),
  ]);

  return saved;
}

/**
 * Prices for these instruments on or after `since`, oldest first.
 *
 * Loaded in one query and walked in memory: a twelve-month trend over a dozen
 * holdings would otherwise issue hundreds of point lookups.
 */
async function loadSnapshots(holdings, until = new Date()) {
  if (holdings.length === 0) return new Map();

  const keys = holdings.map((holding) => cacheKey(holding));

  // Bounded above, not below. The lookup is "the last price at or before T", so
  // a snapshot from before the window is the one that answers the window's
  // first point — filtering it out would silently fall back to cost for every
  // instrument bought before the chart starts.
  const rows = await PriceSnapshot.find({
    $or: keys.map((key) => ({ ...key })),
    date: { $lte: until },
  }).sort({ date: 1 });

  const byKey = new Map();
  for (const row of rows) {
    const id = `${row.provider}|${row.providerSymbol}|${row.currency}`;
    if (!byKey.has(id)) byKey.set(id, []);
    byKey.get(id).push({ date: row.date, priceMinor: row.priceMinor });
  }

  return byKey;
}

/** The key `loadSnapshots` groups by, so callers can look a holding up. */
const snapshotKey = (holding) => {
  const key = cacheKey(holding);
  return `${key.provider}|${key.providerSymbol}|${key.currency}`;
};

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
    if (!quote) return lastKnown(holding, "No manual price set for this holding");

    // Still recorded for history: a manually maintained price is the only
    // record that instrument will ever have.
    await recordSnapshot(holding, quote);
    return { ...quote, source: provider.name, stale: false, error: null };
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

  // The manual price, if the user set one before switching to a vendor.
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

  return lastKnown(holding, "No price available from the provider or manually");
}

/**
 * Last resort: the most recent recorded price, whatever wrote it.
 *
 * Usually that is a trade — someone paid this much for it, which is a real
 * observation even if it is old. Valuing a position at what it last changed
 * hands for beats dropping it out of the portfolio entirely, provided the age
 * is reported so nobody mistakes it for a live mark.
 *
 * This is also what keeps the net worth trend and current net worth agreeing:
 * both fall back to the same series.
 */
async function lastKnown(holding, reason) {
  const snapshot = await PriceSnapshot.findOne(cacheKey(holding)).sort({ date: -1 });
  if (!snapshot) return unpriced(holding, reason);

  return {
    priceMinor: snapshot.priceMinor,
    currency: holding.currency,
    asOf: snapshot.date,
    source: holding.priceProvider,
    stale: true,
    error: `${reason}; valued at the last recorded price`,
  };
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

module.exports = {
  getQuote,
  getQuotes,
  refreshAll,
  getProvider,
  loadSnapshots,
  snapshotKey,
  recordSnapshot,
  PROVIDERS,
};
